# Hardware Agent SDK

> Close the loop between AI agents and the physical world.

Hardware development is still full of **human-in-the-loop** bottlenecks — searching for components, checking if a PCB fits inside an enclosure, verifying solder joints, guiding assembly. AI agents are fast at generating code but blind to the physical world.

**Hardware Agent SDK** is a collection of Skills, MCP servers, and CLI tools that give agents the perception, reasoning, and action capabilities needed to design, source, build, and verify hardware — with minimal human intervention.

---

## The Problem

A typical hardware development cycle looks like this:

```
Idea → Schematic → PCB Layout → Firmware → Enclosure → Source Parts → Print → Assemble → Test
 ↑____________________________________ manual rework __________________________________|
```

At every stage, the agent either **can't see** the physical world or **has no tool** to act on it. The human becomes a translator between agent and reality.

---

## The Solution

Hardware Agent SDK adds a structured feedback loop at each stage:

```
                    ┌─────────────────────────────────────────┐
                    │           DESIGN LOOP                    │
                    │  Natural Language                         │
                    │       ↓                                   │
                    │  CAD Code (Build123d) → Render → Check   │
                    │  Firmware Code → Wokwi Sim → Serial Log  │
                    │       ↓                                   │
                    │  Iterate until spec met                   │
                    └──────────────┬──────────────────────────┘
                                   ↓
                    ┌─────────────────────────────────────────┐
                    │           SOURCING LOOP                  │
                    │  BOM from design                         │
                    │       ↓                                   │
                    │  hw-cli search → price compare → order   │
                    │  (Waveshare / LCSC / JD / 1688)          │
                    └──────────────┬──────────────────────────┘
                                   ↓
                    ┌─────────────────────────────────────────┐
                    │           PHYSICAL LOOP                  │
                    │  3D Print → Camera verify fit            │
                    │  Flash firmware → Camera + serial test   │
                    │  Three.js assembly guide → user follows  │
                    └─────────────────────────────────────────┘
```

---

## Packages

| Package                                         | Type              | What it does                                                                          |
| ----------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| [`cad-skill`](./packages/cad-skill)             | Claude Code Skill | LLM generates Build123d code → renders → vision checks → printability verify          |
| [`hw-cli`](./packages/hw-cli)                   | CLI               | Search, compare prices, and purchase components across Waveshare / LCSC / JD / Taobao |
| [`vision-mcp`](./packages/vision-mcp)           | MCP Server        | Connects a USB/IP camera to the agent — photograph, measure, verify physical objects  |
| [`assembly-viewer`](./packages/assembly-viewer) | Web App           | Three.js step-by-step assembly guide generated from STL files and BOM                 |
| [`firmware-loop`](./packages/firmware-loop)     | CLI + MCP         | Wokwi simulation → arduino-cli compile → flash → serial monitor, all from agent       |

---

## Quick Start

```bash
# Install CLI tools
npm install -g @hardware-agent-sdk/hw-cli

# Search for a component
hw-cli search "ESP32-C3 Super Mini" --sources lcsc,waveshare,jd

# Generate and verify an enclosure
# (in Claude Code, with cad-skill installed)
# > "Design a 60x70mm enclosure for ESP32-C3 with a 1.54inch display cutout"

# Start assembly viewer
hw-cli assemble --bom ./bom.json --models ./stl/
```

---

## Design Principles

**1. Code as the interface to geometry**
Agents generate parametric Python code (Build123d / CadQuery), not meshes. Code is diffable, versionable, and correctable. The geometry is a compile artifact.

**2. Every action has a feedback signal**

- CAD → rendered PNG → vision model checks alignment
- Firmware → Wokwi serial output → agent reads logs
- Physical → camera photo → vision model verifies
- Purchase → order confirmation → BOM status updated

**3. Structured tools, not free-form prompts**
Each MCP tool has typed inputs and outputs. The agent doesn't "browse a website" — it calls `search_component(name, spec)` and gets structured JSON back.

**4. Human in the loop only where it matters**
Assembly, soldering, and physical handling still require humans. The SDK generates precise, visual instructions to make that human time as short as possible.

---

## Motivation: Vibe Hardware

"Vibe coding" — letting agents write software while the human steers at a high level — is now mainstream. The equivalent for hardware doesn't exist yet.

The bottleneck isn't intelligence. It's **tooling**. Agents can reason about circuits and mechanics. They just can't see a PCB, browse a supplier catalog, or know if a screw hole is aligned — because no one built those tools.

Hardware Agent SDK is the missing tooling layer.

---

## Status

Early development. Built as part of a competition project exploring agent-hardware integration.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for system design details.
See [docs/roadmap.md](./docs/roadmap.md) for planned features.
