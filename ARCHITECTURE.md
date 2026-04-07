# Architecture

## System Overview

Hardware Agent SDK is designed as a layered system. Each layer adds a new feedback channel between the agent and the physical world.

```
┌──────────────────────────────────────────────────────────────┐
│                      AI Agent (Claude)                        │
│              reasons, plans, generates code                   │
└──────────┬───────────────────────────────────────────────────┘
           │  calls tools
┌──────────▼───────────────────────────────────────────────────┐
│                   Tool Layer                                  │
│   Skills          MCP Servers         CLI                     │
│   ─────────       ───────────         ───                     │
│   cad-skill       vision-mcp          hw-cli                  │
│   firmware-loop   assembly-viewer                             │
└──────────┬───────────────────────────────────────────────────┘
           │  controls
┌──────────▼───────────────────────────────────────────────────┐
│                  Physical Adapters                            │
│   Build123d    arduino-cli    Camera    Wokwi    Bambu/OctoPrint │
└──────────────────────────────────────────────────────────────┘
           │  produces
┌──────────▼───────────────────────────────────────────────────┐
│                  Physical World                               │
│        PCB          Firmware        Enclosure                 │
└──────────────────────────────────────────────────────────────┘
```

---

## Package Details

### `cad-skill` — CAD Code Generation Loop

The agent writes Python code using Build123d. The skill provides the execution and feedback infrastructure.

```
Agent writes Build123d code
        ↓
cad-skill executes in Docker container
        ↓
Returns: PNG renders (isometric, front, side, top)
         + printability report (watertight, overhangs, thin walls)
         + bounding box + volume
        ↓
Agent inspects renders with vision
        ↓
Agent corrects code if needed → repeat
        ↓
Export STL / STEP / 3MF
```

**Key design decision:** Build123d over OpenSCAD or CadQuery.
- Pure Python → LLM has strong priors from training data
- Better API ergonomics for LLM code generation
- Active development (vs CadQuery's slower pace)

**Key design decision:** Docker for execution.
- Isolated, reproducible environment
- Build123d + OCP dependencies are complex to install
- Container returns renders over HTTP — no display dependency

---

### `hw-cli` — Component Sourcing

A unified CLI for hardware procurement. Agent calls it directly.

```
hw-cli search "ST7789 1.54 inch display" --sources lcsc,waveshare,jd
```

Returns structured JSON:

```json
{
  "query": "ST7789 1.54 inch display",
  "results": [
    {
      "source": "lcsc",
      "part_number": "C5199601",
      "name": "ST7789V2 240x240 1.54\" TFT Module",
      "price_breaks": [{"qty": 1, "price": 12.50}, {"qty": 10, "price": 10.20}],
      "stock": 450,
      "url": "https://www.lcsc.com/product/..."
    },
    {
      "source": "waveshare",
      "part_number": "1.54inch-LCD-Module",
      "name": "1.54inch LCD Display Module",
      "price": 29.90,
      "url": "https://www.waveshare.net/shop/..."
    }
  ]
}
```

**Supported sources (planned):**
- LCSC / 立创商城 — components (official API)
- Waveshare / 微雪电子 — modules and dev boards (reverse-engineered API)
- JD.com / 京东 — general electronics (union API)
- 1688 — bulk wholesale pricing

**BOM integration:**

```
hw-cli bom resolve ./bom.json --budget 200 --prefer lcsc
```

Resolves each BOM line item to the cheapest matching component across sources, respects budget constraints, and outputs a purchase list.

---

### `vision-mcp` — Physical World Perception

Connects a camera (USB webcam or IP camera) to the agent as an MCP server.

**Tools exposed:**

| Tool | Description |
|------|-------------|
| `capture_photo` | Take a photo, return base64 image |
| `measure_object` | Measure dimensions using reference object (e.g., ruler in frame) |
| `verify_assembly` | Compare current state to reference STL render |
| `check_solder_joint` | Capture close-up, return quality assessment |
| `read_serial_display` | Photograph a running device display and extract text |

**Feedback loop with assembly:**

```
Agent: "Verify that the display module is seated correctly"
vision-mcp: capture_photo()
           → returns image
Agent: vision model compares against assembly_display.stl render
      → "Pin header is offset 2mm to the left — reseat and retry"
```

**Camera sources supported:**
- USB webcam (via OpenCV)
- iPhone via Continuity Camera (macOS)
- IP camera (RTSP stream)
- Raspberry Pi camera module

---

### `assembly-viewer` — Guided Assembly

A Three.js web app that generates step-by-step assembly instructions from STL files and BOM data.

```
Input:  STL files (per component) + assembly positions (JSON) + BOM
Output: Interactive 3D step-by-step guide in browser
```

**Features:**
- Exploded view animation showing each assembly step
- Highlight current component in bright color, ghost others
- Show required tools (screwdriver, tweezers) per step
- Verify each step via camera (calls `vision-mcp` when available)
- Export as PDF instruction sheet

**Agent-generated assembly sequence:**

```json
{
  "steps": [
    {
      "step": 1,
      "description": "Insert display module into front panel recess",
      "component": "st7789_display.stl",
      "target_position": {"x": 0, "y": 3, "z": -5},
      "verify": true
    },
    {
      "step": 2,
      "description": "Connect display to ESP32 via SPI cable",
      "components": ["st7789_display.stl", "esp32c3_board.stl"],
      "highlight_pins": ["CLK", "MOSI", "CS", "DC", "RST"]
    }
  ]
}
```

---

### `firmware-loop` — Embedded Development Loop

Closes the firmware development cycle without touching physical hardware.

```
Agent writes firmware code (.ino / .c)
        ↓
firmware-loop: compile with arduino-cli
               check for errors → return to agent if failed
        ↓
firmware-loop: run in Wokwi simulator
               capture serial output for N seconds
               capture display screenshot
        ↓
Returns: serial log + display PNG to agent
        ↓
Agent checks output against spec
        ↓
If passing: firmware-loop flashes to physical device
            captures serial output from real hardware
            vision-mcp photographs display
        ↓
Compare simulation vs physical — flag discrepancies
```

**Key insight:** Simulation and physical outputs should match. If they don't, it's a hardware problem (wiring, power, component failure) not a firmware bug.

---

## Data Flow Between Packages

```
cad-skill ──→ STL files ──→ assembly-viewer
                    ↓
              vision-mcp (compare renders vs physical)

hw-cli ──→ BOM + prices ──→ assembly-viewer (parts list)
                ↓
          purchase confirmation

firmware-loop ──→ verified firmware ──→ flash to device
                       ↓
                 vision-mcp (verify display output)
```

---

## Integration with Claude Code

All packages integrate as Claude Code skills or MCP servers.

**Skills** (invoked with `/skill-name` in Claude Code):
- `/cad` — start a CAD generation session
- `/bom` — generate BOM from current design context
- `/assemble` — launch assembly viewer for current project

**MCP Servers** (running in background, tools available to agent):
- `vision-mcp` — camera tools
- `firmware-loop` — compile/simulate/flash tools

**CLI** (called directly by agent via Bash tool):
- `hw-cli search ...`
- `hw-cli bom resolve ...`
- `hw-cli order ...`

---

## Technology Choices

| Concern | Choice | Reason |
|---------|--------|--------|
| CAD library | Build123d | Best LLM code gen quality, pure Python, active |
| CAD execution | Docker container | Isolated, reproducible, no display needed |
| 3D visualization | Three.js | Runs in browser, loads STL natively, no install |
| Firmware simulation | Wokwi | Best ESP32/Arduino simulator, has API |
| Firmware toolchain | arduino-cli | Headless, scriptable, supports all boards |
| Component search | REST APIs + scraping | Per-source adapters, unified interface |
| Camera | OpenCV + MCP | Simple, cross-platform, works with any camera |
