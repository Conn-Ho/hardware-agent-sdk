import { ToolCall } from '@shared/types';
import {
  MagnifyingGlass,
  Cube,
  Eye,
  CircleNotch,
  WarningCircle,
} from '@phosphor-icons/react';

const TOOL_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  search_components: {
    label: 'Searching hardware library',
    icon: <MagnifyingGlass className="h-3.5 w-3.5" />,
  },
  generate_cad: {
    label: 'Generating CAD model',
    icon: <Cube className="h-3.5 w-3.5" />,
  },
  analyze_vision: {
    label: 'Analyzing image',
    icon: <Eye className="h-3.5 w-3.5" />,
  },
};

export function AgentStepList({ toolCalls }: { toolCalls: ToolCall[] }) {
  if (!toolCalls.length) return null;

  return (
    <div className="mb-2 flex flex-col gap-1">
      {toolCalls.map((tc) => {
        const meta = TOOL_LABELS[tc.name] ?? {
          label: tc.name,
          icon: <Cube className="h-3.5 w-3.5" />,
        };
        const isError = tc.status === 'error';

        return (
          <div
            key={tc.id}
            className="flex items-center gap-2 rounded-md border border-adam-neutral-700 bg-adam-background-2 px-2.5 py-1.5 text-xs text-adam-neutral-300"
          >
            <span className="text-adam-blue">{meta.icon}</span>
            <span>{meta.label}…</span>
            <span className="ml-auto">
              {isError ? (
                <WarningCircle className="h-3.5 w-3.5 text-red-400" />
              ) : (
                <CircleNotch className="h-3.5 w-3.5 animate-spin text-adam-blue" />
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
