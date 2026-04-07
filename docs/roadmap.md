# Roadmap

## Phase 1 — Core Loop (Competition MVP)

Goal: demonstrate a complete agent-driven design-to-assembly loop for a single reference project (ESP32-C3 + ST7789 robot enclosure).

### 1.1 `hw-cli` — Component Search
- [ ] Waveshare API adapter (reverse-engineered, working)
- [ ] LCSC API adapter
- [ ] Unified `search` command with JSON output
- [ ] BOM resolve command (cheapest match per line item)

### 1.2 `cad-skill` — CAD Generation
- [ ] Build123d Docker execution container
- [ ] Multi-angle PNG render endpoint
- [ ] Printability check endpoint (watertight, overhangs)
- [ ] Claude Code skill wrapper
- [ ] Example: robot enclosure generation prompt

### 1.3 `assembly-viewer` — Three.js Viewer
- [ ] Load multiple STL files with positions from JSON
- [ ] Exploded view animation
- [ ] Step-by-step navigation
- [ ] Component highlight / ghost mode
- [ ] Export assembly JSON from agent

### 1.4 `firmware-loop` — Simulation
- [ ] arduino-cli compile wrapper
- [ ] Wokwi API integration (compile + simulate)
- [ ] Serial output capture
- [ ] Display screenshot capture
- [ ] MCP server wrapper

---

## Phase 2 — Physical Feedback

### 2.1 `vision-mcp` — Camera Integration
- [ ] USB webcam capture (OpenCV)
- [ ] iPhone Continuity Camera support
- [ ] `verify_assembly` tool (compare photo vs STL render)
- [ ] `measure_object` tool (with reference ruler)

### 2.2 Physical-Simulation Diff
- [ ] Flash firmware after simulation passes
- [ ] Capture real serial output
- [ ] Compare real vs simulated output
- [ ] Flag hardware-level discrepancies

---

## Phase 3 — Full Sourcing Loop

### 3.1 Additional Sources
- [ ] JD.com adapter
- [ ] 1688 adapter (bulk pricing)
- [ ] Cross-source price comparison table

### 3.2 Purchase Automation
- [ ] Shopping cart management
- [ ] Order placement (with user confirmation step)
- [ ] Order tracking

---

## Phase 4 — Agent Orchestration

### 4.1 Full Project Agent
- [ ] Single agent that takes "build a device that does X" and runs the full loop
- [ ] Persistent project state (design decisions, BOM, firmware versions)
- [ ] Human checkpoints at: design approval, purchase confirmation, assembly start

### 4.2 Multi-device Support
- [ ] Raspberry Pi support in firmware-loop
- [ ] STM32 support
- [ ] KiCad PCB integration (schematic → layout → gerber)
