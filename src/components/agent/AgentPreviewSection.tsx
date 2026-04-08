import { OpenSCADPreview } from '@/components/viewer/OpenSCADViewer';
import { useCurrentMessage } from '@/contexts/CurrentMessageContext';
import { CircleNotch, Cpu } from '@phosphor-icons/react';

interface AgentPreviewSectionProps {
  color: string;
  isLoading: boolean;
  onOutputChange?: (output: Blob | undefined) => void;
}

export function AgentPreviewSection({
  color,
  isLoading,
  onOutputChange,
}: AgentPreviewSectionProps) {
  const { currentMessage } = useCurrentMessage();
  const code = currentMessage?.content.artifact?.code;

  return (
    <div className="flex h-full w-full items-center justify-center bg-adam-neutral-700">
      {isLoading && !code ? (
        <div className="flex flex-col items-center gap-3 text-adam-neutral-400">
          <CircleNotch className="h-8 w-8 animate-spin text-adam-blue" />
          <span className="text-xs">Agent is working…</span>
        </div>
      ) : code ? (
        <OpenSCADPreview
          scadCode={code}
          color={color}
          onOutputChange={onOutputChange}
        />
      ) : (
        <div className="text-adam-neutral-600 flex flex-col items-center gap-3">
          <Cpu className="h-12 w-12 opacity-30" />
          <span className="text-xs">
            Describe your hardware project to get started
          </span>
        </div>
      )}
    </div>
  );
}
