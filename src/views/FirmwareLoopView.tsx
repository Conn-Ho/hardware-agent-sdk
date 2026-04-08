import { useState } from 'react';
import {
  Play,
  CheckCircle,
  XCircle,
  Circle,
  Terminal,
  CaretRight,
} from '@phosphor-icons/react';

type StepStatus = 'pending' | 'running' | 'success' | 'error';

interface Step {
  id: string;
  label: string;
  description: string;
  status: StepStatus;
  log?: string;
}

const INITIAL_STEPS: Step[] = [
  {
    id: 'detect',
    label: 'Detect',
    description: 'Find .ino file and board FQBN',
    status: 'pending',
  },
  {
    id: 'compile',
    label: 'Compile',
    description: 'arduino-cli compile — AI auto-fix on error',
    status: 'pending',
  },
  {
    id: 'flash',
    label: 'Flash',
    description: 'Upload firmware to device',
    status: 'pending',
  },
  {
    id: 'monitor',
    label: 'Monitor',
    description: 'Capture serial output, detect crashes',
    status: 'pending',
  },
];

const BOARDS = [
  { label: 'ESP32-C3', fqbn: 'esp32:esp32:esp32c3' },
  { label: 'ESP32 Dev', fqbn: 'esp32:esp32:esp32dev' },
  { label: 'Arduino Uno', fqbn: 'arduino:avr:uno' },
  { label: 'Arduino Nano', fqbn: 'arduino:avr:nano' },
  { label: 'RP2040 Pico', fqbn: 'rp2040:rp2040:rpipico' },
];

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'success')
    return <CheckCircle className="h-4 w-4 text-green-400" />;
  if (status === 'error') return <XCircle className="h-4 w-4 text-red-400" />;
  if (status === 'running')
    return (
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#60a5fa] border-t-transparent" />
    );
  return <Circle className="h-4 w-4 text-white/20" />;
}

export function FirmwareLoopView() {
  const [steps] = useState<Step[]>(INITIAL_STEPS);
  const [board, setBoard] = useState(BOARDS[0].fqbn);
  const [port, setPort] = useState('/dev/tty.usbmodem*');
  const [logs] = useState<string[]>([
    '$ hw-agent firmware-loop --fqbn esp32:esp32:esp32c3',
    '',
    'Hardware Agent SDK — Firmware Loop',
    'Run: npm install -g @hardware-agent-sdk/firmware-loop',
    'Then: fw-loop ./your-sketch --fqbn esp32:esp32:esp32c3',
    '',
    'The firmware loop will:',
    '  1. Detect your .ino file and board automatically',
    '  2. Compile with arduino-cli (up to 10 AI-fix rounds)',
    '  3. Flash to device via USB serial',
    '  4. Monitor serial output for crashes',
    '  5. Auto-fix runtime errors and repeat',
  ]);

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a] p-6 font-mono">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Firmware Loop
        </h1>
        <p className="mt-1 text-sm text-white/40">
          Autonomous compile → flash → monitor → AI auto-fix loop
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Config Panel */}
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs text-white/40">Board</label>
            <select
              value={board}
              onChange={(e) => setBoard(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-black/50 px-3 py-2.5 text-sm text-white outline-none focus:border-[#60a5fa]/60"
            >
              {BOARDS.map((b) => (
                <option key={b.fqbn} value={b.fqbn}>
                  {b.label} — {b.fqbn}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-white/40">
              Serial Port
            </label>
            <input
              type="text"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="/dev/tty.usbmodem12345"
              className="w-full rounded-md border border-white/10 bg-black/50 px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-[#60a5fa]/60"
            />
          </div>

          {/* Loop steps */}
          <div className="rounded-md border border-white/5 bg-black/40 p-4">
            <p className="mb-3 text-xs text-white/40">Loop Steps</p>
            <div className="space-y-3">
              {steps.map((step, i) => (
                <div key={step.id} className="flex items-start gap-3">
                  <StepIcon status={step.status} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-white/30">{i + 1}.</span>
                      <span className="text-sm text-white">{step.label}</span>
                    </div>
                    <p className="text-xs text-white/30">{step.description}</p>
                    {step.log && (
                      <p className="mt-1 text-xs text-[#60a5fa]">{step.log}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-[#60a5fa]/20 bg-[#60a5fa]/5 p-4">
            <p className="mb-2 text-xs font-medium text-[#60a5fa]">CLI Usage</p>
            <code className="block text-xs text-white/70">
              npm install -g @hardware-agent-sdk/firmware-loop
              <br />
              fw-loop ./sketch --fqbn {board} --port {port}
            </code>
          </div>

          <button
            disabled
            className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-md border border-white/10 px-4 py-2.5 text-sm text-white/30"
          >
            <Play className="h-4 w-4" />
            Run in browser (requires local agent)
          </button>
        </div>

        {/* Terminal */}
        <div className="rounded-md border border-white/5 bg-black/80 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Terminal className="h-4 w-4 text-white/30" />
            <span className="text-xs text-white/30">terminal</span>
          </div>
          <div className="space-y-1">
            {logs.map((line, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                {line.startsWith('$') ? (
                  <>
                    <CaretRight className="mt-0.5 h-3 w-3 shrink-0 text-[#60a5fa]" />
                    <span className="text-[#60a5fa]">{line.slice(2)}</span>
                  </>
                ) : line === '' ? (
                  <span>&nbsp;</span>
                ) : line.startsWith('  ') ? (
                  <span className="pl-4 text-white/40">{line.trim()}</span>
                ) : (
                  <span className="text-white/50">{line}</span>
                )}
              </div>
            ))}
            <div className="mt-2 flex items-center gap-1 text-xs text-[#60a5fa]">
              <CaretRight className="h-3 w-3" />
              <span className="animate-pulse">_</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
