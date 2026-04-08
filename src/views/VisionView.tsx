import { useState, useRef, useCallback, type ComponentType } from 'react';
import {
  Camera,
  Eye,
  Ruler,
  Wrench,
  Upload,
  X,
  CheckCircle2,
  type LucideProps,
} from 'lucide-react';

type AnalysisMode = 'inspect' | 'measure' | 'verify' | 'solder';

const MODES: {
  id: AnalysisMode;
  label: string;
  icon: ComponentType<LucideProps>;
  description: string;
}[] = [
  {
    id: 'inspect',
    label: 'Inspect',
    icon: Eye,
    description: 'General visual inspection',
  },
  {
    id: 'measure',
    label: 'Measure',
    icon: Ruler,
    description: 'Estimate dimensions with reference object',
  },
  {
    id: 'verify',
    label: 'Verify Assembly',
    icon: CheckCircle2,
    description: 'Compare to expected assembly',
  },
  {
    id: 'solder',
    label: 'Solder Quality',
    icon: Wrench,
    description: 'Analyze solder joint quality',
  },
];

export function VisionView() {
  const [mode, setMode] = useState<AnalysisMode>('inspect');
  const [image, setImage] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const startCamera = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      setStream(s);
      setIsCapturing(true);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        videoRef.current.play();
      }
    } catch {
      alert('Camera access denied or not available');
    }
  }, []);

  const stopCamera = useCallback(() => {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
    setIsCapturing(false);
  }, [stream]);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    setImage(dataUrl);
    stopCamera();
  }, [stopCamera]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setImage(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const analyze = async () => {
    if (!image) return;
    setIsAnalyzing(true);
    setResult(null);
    // Placeholder: in production, call Supabase edge function with image + mode + prompt
    await new Promise((r) => setTimeout(r, 1500));
    const mockResults: Record<AnalysisMode, string> = {
      inspect:
        '✅ Board appears clean. ESP32-C3 module seated correctly. No visible damage or burnt components. USB connector appears intact.',
      measure:
        '📏 Estimated dimensions: ~52mm × 28mm based on USB connector reference (9mm width). Component height: ~8mm.',
      verify:
        '✅ VCC → 3V3 (red wire) — confirmed\n✅ GND → GND (black wire) — confirmed\n⚠️ CS → GPIO4 — wire connection unclear, verify seat\n✅ Display powered on — confirmed',
      solder:
        '✅ Header pin joints: shiny volcano shape, good wetting — PASS\n❌ USB connector pad 2: dull grey appearance — possible cold joint\n✅ Remaining pads — PASS',
    };
    setResult(mockResults[mode]);
    setIsAnalyzing(false);
  };

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a] p-6 font-mono">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Vision
        </h1>
        <p className="mt-1 text-sm text-white/40">
          Camera perception for physical hardware inspection
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Camera / Image */}
        <div className="space-y-4">
          <div className="relative aspect-video overflow-hidden rounded-md border border-white/5 bg-black/60">
            {isCapturing && (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="h-full w-full object-cover"
              />
            )}
            {image && !isCapturing && (
              <img
                src={image}
                alt="Captured"
                className="h-full w-full object-contain"
              />
            )}
            {!isCapturing && !image && (
              <div className="flex h-full flex-col items-center justify-center gap-3">
                <Camera className="h-10 w-10 text-white/10" />
                <p className="text-xs text-white/30">No image captured</p>
              </div>
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          <div className="flex gap-2">
            {!isCapturing ? (
              <>
                <button
                  onClick={startCamera}
                  className="flex flex-1 items-center justify-center gap-2 rounded-md border border-[#60a5fa] px-4 py-2.5 text-sm text-[#60a5fa] transition-all hover:bg-[#60a5fa] hover:text-black"
                >
                  <Camera className="h-4 w-4" /> Start Camera
                </button>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-md border border-white/10 px-4 py-2.5 text-sm text-white/50 transition-all hover:border-white/20 hover:text-white/70"
                >
                  <Upload className="h-4 w-4" /> Upload
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </>
            ) : (
              <>
                <button
                  onClick={capturePhoto}
                  className="flex flex-1 items-center justify-center gap-2 rounded-md border border-[#60a5fa] px-4 py-2.5 text-sm text-[#60a5fa] transition-all hover:bg-[#60a5fa] hover:text-black"
                >
                  <Camera className="h-4 w-4" /> Capture
                </button>
                <button
                  onClick={stopCamera}
                  className="flex items-center justify-center gap-2 rounded-md border border-white/10 px-4 py-2.5 text-sm text-white/50 hover:text-red-400"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            )}
          </div>

          {image && (
            <button
              onClick={() => {
                setImage(null);
                setResult(null);
              }}
              className="w-full text-center text-xs text-white/20 hover:text-white/40"
            >
              Clear image
            </button>
          )}
        </div>

        {/* Right: Analysis */}
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs text-white/40">Analysis Mode</p>
            <div className="grid grid-cols-2 gap-2">
              {MODES.map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.id}
                    onClick={() => setMode(m.id)}
                    className={`flex items-start gap-3 rounded-md border p-3 text-left transition-all ${
                      mode === m.id
                        ? 'border-[#60a5fa]/40 bg-[#60a5fa]/10 text-[#60a5fa]'
                        : 'border-white/5 bg-black/40 text-white/40 hover:border-white/10'
                    }`}
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="text-xs font-medium">{m.label}</p>
                      <p className="text-xs opacity-60">{m.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-white/40">
              Context / Checklist (optional)
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. ESP32-C3 connected to ST7789 display. Check: VCC→3V3, GND→GND, CS→GPIO4"
              rows={3}
              className="w-full resize-none rounded-md border border-white/10 bg-black/50 px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-[#60a5fa]/60"
            />
          </div>

          <button
            onClick={analyze}
            disabled={!image || isAnalyzing}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-[#60a5fa] px-4 py-2.5 text-sm text-[#60a5fa] transition-all hover:bg-[#60a5fa] hover:text-black disabled:opacity-40"
          >
            {isAnalyzing ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />{' '}
                Analyzing...
              </>
            ) : (
              <>
                <Eye className="h-4 w-4" /> Analyze
              </>
            )}
          </button>

          {result && (
            <div className="rounded-md border border-white/5 bg-black/60 p-4">
              <p className="mb-2 text-xs text-white/30">Analysis Result</p>
              <pre className="whitespace-pre-wrap text-xs leading-relaxed text-white/70">
                {result}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
