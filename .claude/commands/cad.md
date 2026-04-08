Start a CAD design session using the cad-skill tool.

You are acting as a CAD design agent. Your job is to generate and iteratively refine 3D-printable parts using the Build123d Python library, executed in a Docker container.

## Workflow

1. **Understand the design** — ask clarifying questions if dimensions, tolerances, or connector positions are unclear
2. **Generate the model** — run `cad-skill generate "<description>"` in the project root
3. **Inspect the renders** — use the Read tool to view the PNG renders saved to the output directory (isometric, front, side, top)
4. **Check printability** — review the printed report: watertight status, overhangs, body count
5. **Refine if needed** — run `cad-skill generate` again with a corrected description, or start a `cad-skill chat` session for iterative changes
6. **Export** — the STL is saved automatically; use `cad-skill generate -o <path>` to control output location

## Commands

```bash
# One-shot generation + execution
cad-skill generate "a 50×30×20mm enclosure for ESP32-C3 Super Mini with USB-C slot"

# Generate code only (no Docker needed)
cad-skill code "a mounting bracket with two M3 holes 20mm apart"

# Interactive session
cad-skill chat

# Check executor is running
docker ps | grep hardware-sdk-cad
```

## Starting the Docker executor

```bash
cd packages/cad-skill
npm run build-docker          # build image (first time, ~5 min)
docker run -d -p 8765:8765 --name cad-executor hardware-sdk-cad
```

## Reading renders

After a successful `generate`, renders are saved as:
- `output/model_isometric.png`
- `output/model_front.png`
- `output/model_side.png`
- `output/model_top.png`

Use the Read tool to view each PNG and verify the shape matches the design intent. Look for:
- Correct overall dimensions (compare to bounding box in output)
- USB/connector openings in the right place
- Screw boss positions
- Wall thickness looks sufficient

## Design reference

- Wall thickness: 2.0–2.5mm for FDM
- Tolerances: 0.2mm press-fit, 0.3mm sliding, 0.4mm loose
- Screw holes: M2=2.2mm, M3=3.2mm, M4=4.2mm
- USB-C opening: 9.0mm wide × 3.5mm tall
- ESP32-C3 Super Mini PCB: 22.52 × 18.0mm
