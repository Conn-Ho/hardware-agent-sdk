import { useOpenSCAD } from '@/hooks/useOpenSCAD';
import { useEffect, useState, useContext, useRef } from 'react';
import { ThreeScene } from '@/components/viewer/ThreeScene';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { BufferGeometry } from 'three';
import { CircleNotch, WarningCircle, Wrench } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import OpenSCADError from '@/lib/OpenSCADError';
import { cn } from '@/lib/utils';
import { MeshFilesContext } from '@/contexts/MeshFilesContext';

// Extract import() filenames from OpenSCAD code
function extractImportFilenames(code: string): string[] {
  const importRegex = /import\s*\(\s*"([^"]+)"\s*\)/g;
  const filenames: string[] = [];
  let match;
  while ((match = importRegex.exec(code)) !== null) {
    filenames.push(match[1]);
  }
  return filenames;
}

interface OpenSCADPreviewProps {
  scadCode: string | null;
  color: string;
  onOutputChange?: (output: Blob | undefined) => void;
  fixError?: (error: OpenSCADError) => void;
  isMobile?: boolean;
  backgroundColor?: string;
}

export function OpenSCADPreview({
  scadCode,
  color,
  onOutputChange,
  fixError,
  isMobile,
  backgroundColor,
}: OpenSCADPreviewProps) {
  const { compileScad, writeFile, isCompiling, output, isError, error } =
    useOpenSCAD();
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  // Use context directly to avoid throwing if provider is not mounted (e.g. VisualCard)
  const meshFilesCtx = useContext(MeshFilesContext);
  // Track which files we've written to avoid re-writing unchanged blobs
  const writtenFilesRef = useRef<Map<string, Blob>>(new Map());

  useEffect(() => {
    if (!scadCode) return;

    const compileWithMeshFiles = async () => {
      try {
        // Extract any import() filenames from the code
        const importedFiles = extractImportFilenames(scadCode);

        // Write any mesh files that haven't been written yet
        if (meshFilesCtx) {
          for (const filename of importedFiles) {
            const meshContent = meshFilesCtx.getMeshFile(filename);
            const writtenBlob = writtenFilesRef.current.get(filename);
            const needsWrite =
              meshContent && (!writtenBlob || writtenBlob !== meshContent);

            if (needsWrite && meshContent) {
              await writeFile(filename, meshContent);
              writtenFilesRef.current.set(filename, meshContent);
            }
          }
        }

        compileScad(scadCode);
      } catch (err) {
        console.error('[OpenSCAD] Error preparing files for compilation:', err);
      }
    };

    compileWithMeshFiles();
  }, [scadCode, compileScad, writeFile, meshFilesCtx]);

  useEffect(() => {
    onOutputChange?.(output);
    if (output && output instanceof Blob) {
      output.arrayBuffer().then((buffer) => {
        const loader = new STLLoader();
        const geom = loader.parse(buffer);
        geom.center();
        geom.computeVertexNormals();
        setGeometry(geom);
      });
    } else {
      setGeometry(null);
    }
  }, [output, onOutputChange]);

  return (
    <div className="h-full w-full bg-adam-neutral-700/50 shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out">
      <div className="h-full w-full">
        {geometry ? (
          <div className="h-full w-full">
            <ThreeScene
              geometry={geometry}
              color={color}
              isMobile={isMobile}
              backgroundColor={backgroundColor}
            />
          </div>
        ) : (
          <>
            {isError && (
              <div className="flex h-full items-center justify-center">
                <FixWithAIButton error={error} fixError={fixError} />
              </div>
            )}
          </>
        )}
        {isCompiling && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-adam-neutral-700/30 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <CircleNotch className="h-6 w-6 animate-spin text-adam-blue" />
              <p className="text-xs font-medium text-adam-text-primary/70">
                Compiling...
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Alias for backwards compatibility (ViewerSection imports OpenSCADViewer)
export { OpenSCADPreview as OpenSCADViewer };

function FixWithAIButton({
  error,
  fixError,
}: {
  error?: OpenSCADError | Error;
  fixError?: (error: OpenSCADError) => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          <div className="absolute inset-0 animate-ping rounded-full bg-adam-blue/20" />
          <WarningCircle className="h-8 w-8 text-adam-blue" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-adam-blue">
            Error Compiling Model
          </p>
          <p className="mt-1 text-xs text-adam-text-primary/60">
            Adam encountered an error while compiling
          </p>
        </div>
      </div>
      {fixError && error && error.name === 'OpenSCADError' && (
        <Button
          variant="ghost"
          className={cn(
            'group relative flex items-center gap-2 rounded-lg border',
            'bg-gradient-to-br from-adam-blue/20 to-adam-neutral-800/70 p-3',
            'border-adam-blue/30 text-adam-text-primary',
            'transition-all duration-300 ease-in-out',
            'hover:border-adam-blue/70 hover:bg-adam-blue/50 hover:text-white',
            'hover:shadow-[0_0_25px_rgba(249,115,184,0.4)]',
            'focus:outline-none focus:ring-2 focus:ring-adam-blue/30',
          )}
          onClick={() => {
            if (error && error.name === 'OpenSCADError') {
              fixError?.(error as OpenSCADError);
            }
          }}
        >
          <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-adam-blue/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <Wrench className="h-4 w-4 transition-transform duration-300 group-hover:rotate-12" />
          <span className="relative text-sm font-medium">Fix with AI</span>
        </Button>
      )}
    </div>
  );
}
