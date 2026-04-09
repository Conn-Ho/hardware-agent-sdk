# Vision: Why Hardware Agent SDK

## The Gap

AI agents can now write production software, design databases, build APIs — all from natural language. But ask an agent to "build a device that monitors temperature and displays it on a screen," and it immediately hits walls:

- It can write the firmware, but can't compile it without a toolchain
- It can describe the enclosure, but can't verify the display cutout is the right size
- It can suggest components, but can't search a supplier catalog
- It can generate assembly instructions, but can't see if the user followed them correctly

These aren't intelligence failures. They're **tooling failures**.

## The Insight

Every stage of hardware development produces a feedback signal. The problem is that none of those signals are wired to the agent:

| Stage | Signal | Currently reaches agent? |
|-------|--------|--------------------------|
| CAD design | Rendered image of model | ✗ Agent generates blind |
| Firmware | Compilation errors, serial output | ✗ Agent can't run the toolchain |
| Simulation | Display output, pin states | ✗ No simulator integration |
| Component selection | Price, availability, spec match | ✗ No supplier API access |
| Physical assembly | Photo of assembled device | ✗ No camera integration |
| Hardware test | Serial logs, device behavior | ✗ Can't observe running hardware |

Wire these signals to the agent, and hardware development becomes tractable.

## What Changes

**Without Hardware Agent SDK:**
```
Human: "Design a robot display enclosure"
Agent: generates some STL code
Human: opens FreeCAD, checks if it fits, finds it doesn't, goes back to agent
Agent: adjusts, human checks again... (5-10 iterations, 2 hours)
Human: searches LCSC for parts, manually compares prices
Human: assembles, discovers firmware bug, debugs manually
```

**With Hardware Agent SDK:**
```
Human: "Design a robot display enclosure"
Agent: generates Build123d code
      → cad-skill renders it, checks printability
      → "PCB recess is 0.5mm too shallow, adjusting..."
      → confirms fit in 3 automated iterations
      → hw-cli finds all components, shows price comparison
      → firmware-loop compiles and simulates, shows display output
      → assembly-viewer generates step-by-step guide
Human: reviews design, approves purchase, follows assembly guide
      → vision-mcp verifies each assembly step
```

Human time: ~20 minutes of review and physical assembly.
Agent time: continuous.

## Scope

Hardware Agent SDK is **not** trying to replace:
- Electronics engineers for novel circuit design
- Mechanical engineers for complex structural analysis
- Human hands for fine assembly work

It **is** trying to replace:
- Manual iteration on CAD to check component fit
- Tedious component search and price comparison
- Trial-and-error firmware debugging without simulation
- Undirected assembly without real-time guidance

## The Procurement Gap

There's one more wall the current workflow hits: after the agent selects the right components, a human still has to go click "Buy" on DigiKey or Taobao.

This is where **Web3/Web4 agent wallets** change the picture.

An AI agent with a programmable payment primitive can close the full loop — from BOM generation to actual purchase order — autonomously, within policy limits set by the human:

```
Agent: confirms BOM → finds lowest price across 微雪/DFRobot/LCSC/DigiKey
     → checks spend policy (user-set per-order limit: ¥500)
     → places order via DigiKey Order API / Privacy.com virtual card
     → returns tracking number
Human: receives parts at the door
```

**Practical architecture today:**

| Channel | Mechanism | Status |
|---------|-----------|--------|
| 中文渠道 (微雪/DFRobot/立创) | 虚拟卡 via Privacy.com MCP | 生产可用 |
| 海外 API 服务 | x402 协议 + USDC (Coinbase AgentKit) | 生产可用 |
| DigiKey / Mouser / Arrow | Order API + 预开企业账户 | 需注册 |
| 通用兜底 | Privacy.com 虚拟 Visa，单笔限额 | 生产可用 |

The human retains control through **spend policies, not approval dialogs** — you set the rules once, the agent operates within them.

This is the natural next frontier: hardware agents that don't just design and debug, but also source and procure.

## The Competition Angle

This is a **software project** that enables a new category of hardware development workflow. The deliverable is an SDK — installable, composable tools that any developer can add to their Claude Code environment.

The reference implementation (clawd-mochi robot enclosure) demonstrates the full loop end-to-end.

The broader claim: **vibe hardware is now possible**, with the right tooling layer.
