import { useState } from 'react'

// Minimal Python syntax highlighter
function highlight(code) {
  const keywords = /\b(from|import|as|with|if|else|elif|for|while|return|def|class|True|False|None|and|or|not|in|is)\b/g
  const numbers = /\b(\d+\.?\d*)\b/g
  const strings = /("""[\s\S]*?"""|'''[\s\S]*?'''|"[^"]*"|'[^']*')/g
  const comments = /(#.*$)/gm
  const builtins = /\b(Box|Cylinder|Sphere|BuildPart|BuildSketch|extrude|fillet|chamfer|Mode|Pos|Rot|Plane|mirror|shell|export_stl|export_step|add|subtract|intersect|Locations|select_edges|edges|faces|Part)\b/g

  return code
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(strings, '<span style="color:#a5d6ff">$1</span>')
    .replace(comments, '<span style="color:#6e7681">$1</span>')
    .replace(keywords, '<span style="color:#ff7b72">$&</span>')
    .replace(numbers, '<span style="color:#f2cc60">$&</span>')
    .replace(builtins, '<span style="color:#d2a8ff">$&</span>')
}

export default function CodePanel({ code }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (!code) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#0d1117]">
        <div className="text-center">
          <svg viewBox="0 0 64 64" className="mx-auto mb-3 h-12 w-12 opacity-20" fill="none" stroke="#e8e8e8" strokeWidth="2">
            <polyline points="16 18 6 32 16 46"/>
            <polyline points="48 18 58 32 48 46"/>
            <line x1="26" y1="8" x2="38" y2="56"/>
          </svg>
          <p className="text-sm text-text-muted">Generated code will appear here</p>
        </div>
      </div>
    )
  }

  const lines = code.split('\n')
  const lineCount = lines.length

  return (
    <div className="flex h-full w-full flex-col bg-[#0d1117]">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-[#21262d] bg-[#161b22] px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <div className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <div className="h-3 w-3 rounded-full bg-[#28c840]" />
          <span className="ml-2 font-mono text-xs text-[#6e7681]">model.py</span>
          <span className="ml-2 rounded bg-[#21262d] px-1.5 py-0.5 font-mono text-xs text-[#6e7681]">
            Build123d
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-[#6e7681]">{lineCount} lines</span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-md border border-[#30363d] bg-[#21262d] px-2.5 py-1 text-xs text-[#8b949e] transition-colors hover:bg-[#30363d] hover:text-[#e6edf3]"
          >
            {copied ? (
              <>
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current text-green-400">
                  <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                </svg>
                <span className="text-green-400">Copied</span>
              </>
            ) : (
              <>
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
                  <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"/>
                  <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"/>
                </svg>
                Copy
              </>
            )}
          </button>
        </div>
      </div>

      {/* Code */}
      <div className="flex flex-1 overflow-auto">
        {/* Line numbers */}
        <div className="select-none border-r border-[#21262d] bg-[#0d1117] px-3 py-4 text-right">
          {lines.map((_, i) => (
            <div key={i} className="font-mono text-xs leading-6 text-[#6e7681]">
              {i + 1}
            </div>
          ))}
        </div>
        {/* Code content */}
        <pre className="flex-1 overflow-auto px-4 py-4">
          <code
            className="code-block text-[#e6edf3] leading-6"
            dangerouslySetInnerHTML={{ __html: highlight(code) }}
          />
        </pre>
      </div>
    </div>
  )
}
