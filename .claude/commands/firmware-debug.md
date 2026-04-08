Automatically compile, flash, monitor, and debug firmware on a connected development board using a closed-loop agent workflow.

You are acting as a firmware debug agent. Your job is to take firmware source code, compile it, flash it to the connected board, monitor serial output, and automatically fix any errors — using the camera when physical verification is needed.

## Workflow

```
Write / edit firmware
        ↓
  [COMPILE LOOP]
  arduino-cli compile → parse errors → fix code → retry
        ↓ (compile passes)
  [FLASH]
  arduino-cli upload → verify success
        ↓
  [MONITOR LOOP]
  serial monitor → parse output → detect errors/panics
        ↓ (error detected)
  Camera capture → vision analysis → fix firmware → back to COMPILE LOOP
        ↓ (all checks pass)
  Done ✓
```

---

## Step 1 — Detect connected board

```bash
# List connected USB serial devices
ls /dev/tty.usb* /dev/ttyUSB* /dev/ttyACM* 2>/dev/null

# Auto-detect board type and port
arduino-cli board list
```

If multiple boards are connected, ask the user which one to use. Store the port and FQBN for subsequent steps.

Common FQBNs:
- ESP32-C3: `esp32:esp32:esp32c3`
- ESP32 generic: `esp32:esp32:esp32`
- Arduino Uno: `arduino:avr:uno`
- Arduino Nano: `arduino:avr:nano`
- Raspberry Pi Pico: `rp2040:rp2040:rpipico`

---

## Step 2 — Compile loop

```bash
# Compile (replace PORT and FQBN with detected values)
arduino-cli compile --fqbn <FQBN> <SKETCH_PATH> 2>&1
```

**On compile error:**
1. Read the full error output carefully
2. Identify the file, line number, and error type
3. Use the Edit tool to fix the source file
4. Re-run compile immediately — do NOT ask the user unless the error is ambiguous
5. Repeat up to **10 iterations** before stopping and reporting to the user

Common compile errors and fixes:
- `was not declared in this scope` → missing `#include` or typo in variable name
- `no matching function for call` → wrong argument types, check the library API
- `undefined reference` → missing library, run `arduino-cli lib install "<lib name>"`
- `expected ';' before` → syntax error on previous line
- Linker overflow / sketch too large → remove debug `Serial.print`, reduce buffer sizes

---

## Step 3 — Flash

```bash
# Upload to board
arduino-cli upload --fqbn <FQBN> --port <PORT> <SKETCH_PATH> 2>&1
```

**On upload error:**
- `Access denied` → check `ls -la <PORT>`, may need `sudo chmod 666 <PORT>`
- `No device found` → board not in bootloader mode; try holding BOOT button while pressing RESET
- `Timed out` → wrong port or FQBN, re-run board detection

Wait 2 seconds after successful upload before starting the monitor.

---

## Step 4 — Serial monitor loop

```bash
# Monitor serial output (Ctrl+C to stop)
arduino-cli monitor --port <PORT> --config baudrate=115200 2>&1
```

Or use Python for programmatic capture:
```bash
python3 -c "
import serial, time
s = serial.Serial('<PORT>', 115200, timeout=10)
time.sleep(2)
start = time.time()
while time.time() - start < 30:
    line = s.readline().decode('utf-8', errors='replace').strip()
    if line: print(line)
s.close()
"
```

**Parse serial output for:**

| Pattern | Meaning | Action |
|---------|---------|--------|
| `Guru Meditation Error` | ESP32 crash/panic | Extract backtrace, fix crash |
| `Backtrace: 0x...` | Stack trace | Decode with `addr2line` or fix by inspection |
| `E (...)` prefix | ESP-IDF error log | Read error code, fix root cause |
| `assert failed` | Assertion error | Fix the failing condition |
| `WiFi connect failed` | Network issue | Check SSID/password in code |
| No output at all | Boot failure | Check baud rate, try 9600 or 74880 |
| Repeating crash loop | Boot loop | Erase flash: `esptool.py erase_flash` |

**On runtime error detected:**
1. Stop monitoring
2. Extract the relevant error lines
3. If physical inspection is needed → go to Step 5 (camera)
4. Otherwise → fix firmware code → back to Step 2 (compile loop)

---

## Step 5 — Camera verification (when physical state matters)

Use the camera to observe the board when:
- Serial output says "display initialized" but you need to verify visually
- You suspect a wiring/power issue (not a firmware bug)
- After flashing, need to confirm LEDs/display are responding correctly

```bash
# Capture photo via vision-mcp (if running)
# The vision-mcp MCP server exposes: capture_photo, read_serial_display

# Or capture directly with Python + OpenCV
python3 -c "
import cv2, base64, sys
cap = cv2.VideoCapture(0)
ret, frame = cap.read()
if ret:
    cv2.imwrite('/tmp/board_capture.png', frame)
    print('Saved to /tmp/board_capture.png')
cap.release()
"
```

After capturing, use the Read tool to view `/tmp/board_capture.png` and analyze:
- Is the board powered? (power LED on)
- Is the display showing expected output?
- Are any indicator LEDs in unexpected states?
- Is there visible smoke, burn marks, or wrong component placement?

**If camera shows a hardware issue** (not firmware): report to user immediately — do NOT attempt to fix in firmware.

**If camera shows firmware/display issue**: fix the relevant code → back to compile loop.

---

## Step 6 — Success criteria

The debug loop is complete when:
- [ ] Firmware compiles without errors or warnings
- [ ] Upload succeeds on first try
- [ ] Serial output shows expected startup messages
- [ ] No crash/panic/error lines in first 30 seconds of serial output
- [ ] Camera confirms device is behaving as expected (if camera is available)

Report a summary:
```
✓ Compiled: <sketch>.ino (FQBN: <fqbn>)
✓ Flashed: <PORT>
✓ Serial: <first meaningful output line>
✓ Camera: <what was observed>
Iterations: compile=N, flash=N, monitor=N
```

---

## Commands reference

```bash
# Install arduino-cli (if missing)
brew install arduino-cli                          # macOS
arduino-cli core update-index
arduino-cli core install esp32:esp32              # ESP32 boards
arduino-cli core install arduino:avr              # Arduino boards

# Install a library
arduino-cli lib install "Adafruit GFX Library"
arduino-cli lib install "TFT_eSPI"

# Erase ESP32 flash (recovery)
pip install esptool
esptool.py --port <PORT> erase_flash

# Decode ESP32 backtrace (requires xtensa toolchain)
~/.arduino15/packages/esp32/tools/xtensa-esp32-elf-gcc/*/bin/xtensa-esp32-elf-addr2line \
  -pfiaC -e <ELF_FILE> <BACKTRACE_ADDRESSES>
```

---

## Camera setup

The debug agent works without a camera, but enables physical verification when available.

```bash
# Check if camera is accessible
python3 -c "import cv2; cap=cv2.VideoCapture(0); print('Camera OK' if cap.isOpened() else 'No camera'); cap.release()"

# If using vision-mcp server (recommended)
# Start it before invoking this skill:
# cd packages/vision-mcp && node index.js
```

Camera sources supported:
- USB webcam (index 0, 1, 2...)
- iPhone via Continuity Camera (macOS — appears as USB camera)
- IP camera: replace `VideoCapture(0)` with `VideoCapture("rtsp://<IP>/stream")`

---

## Safety rules

- NEVER flash to a board without confirming the correct port — wrong port can brick other devices
- ALWAYS stop the serial monitor before attempting to flash
- If the board enters a boot loop, run `esptool.py erase_flash` before reflashing
- Maximum auto-fix iterations: **10 compile + 3 flash + 5 monitor cycles** — stop and ask user if exceeded
- If camera shows burn marks or smoke: stop immediately, do not attempt further flashing
