import { useState, useRef, useEffect } from 'react'

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="dot h-2 w-2 rounded-full bg-accent"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  )
}

function UserMessage({ content }) {
  return (
    <div className="msg-enter flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-accent/20 px-4 py-3 text-sm text-text-primary border border-accent/30">
        {content.text}
      </div>
    </div>
  )
}

function AssistantMessage({ content }) {
  if (content.type === 'result') {
    const b = content.metrics?.bounding_box
    return (
      <div className="msg-enter flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/20">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="#00A6FF" strokeWidth="1.5">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
        </div>
        <div className="flex-1">
          <div className="rounded-2xl rounded-tl-sm bg-bg-panel px-4 py-3 text-sm text-text-primary border border-border">
            <div className="flex items-center gap-2 text-accent font-medium mb-2">
              <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current">
                <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/>
              </svg>
              Model generated
            </div>
            {b && (
              <div className="space-y-1 text-xs text-text-muted font-mono">
                <div>Bounding box: <span className="text-text-primary">{b.x} × {b.y} × {b.z} mm</span></div>
                {content.metrics?.volume_mm3 && (
                  <div>Volume: <span className="text-text-primary">{content.metrics.volume_mm3} mm³</span></div>
                )}
              </div>
            )}
            {content.hasModel && (
              <div className="mt-2 text-xs text-text-muted">STL rendered in viewer →</div>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (content.type === 'error') {
    return (
      <div className="msg-enter flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-500/20">
          <svg viewBox="0 0 20 20" className="h-4 w-4 fill-red-400">
            <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"/>
          </svg>
        </div>
        <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-text-primary">
          {content.text}
        </div>
      </div>
    )
  }

  return (
    <div className="msg-enter flex items-start gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/20">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="#00A6FF" strokeWidth="1.5">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
        </svg>
      </div>
      <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-bg-panel px-4 py-3 text-sm text-text-primary border border-border">
        {content.text}
      </div>
    </div>
  )
}

function SuggestionPill({ text, onClick }) {
  return (
    <button
      onClick={() => onClick(text)}
      className="rounded-full border border-border bg-bg-panel px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent/40 hover:bg-bg-hover hover:text-text-primary text-left"
    >
      {text}
    </button>
  )
}

export default function ChatPanel({ messages, isLoading, status, onSend, suggestions, hasCode }) {
  const [input, setInput] = useState('')
  const scrollRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isLoading])

  const handleSubmit = (e) => {
    e?.preventDefault()
    if (!input.trim() || isLoading) return
    onSend(input)
    setInput('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const isEmpty = messages.length === 0

  return (
    <div className="flex h-full w-full flex-col bg-bg-secondary">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
            <div>
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 border border-accent/20">
                <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="#00A6FF" strokeWidth="1.5">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
              </div>
              <h2 className="text-base font-semibold text-text-primary">CAD Agent</h2>
              <p className="mt-1 text-xs text-text-muted">Describe what you want to build</p>
            </div>
            <div className="w-full space-y-2">
              <p className="text-xs font-medium text-text-dim uppercase tracking-wide">Suggestions</p>
              <div className="flex flex-col gap-2">
                {suggestions.map((s, i) => (
                  <SuggestionPill key={i} text={s} onClick={(t) => { onSend(t) }} />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map(msg => (
              <div key={msg.id}>
                {msg.role === 'user'
                  ? <UserMessage content={msg.content} />
                  : <AssistantMessage content={msg.content} />
                }
              </div>
            ))}
            {isLoading && (
              <div className="msg-enter flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/20">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="#00A6FF" strokeWidth="1.5">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                  </svg>
                </div>
                <div className="rounded-2xl rounded-tl-sm bg-bg-panel px-4 py-3 border border-border">
                  {status ? (
                    <span className="text-xs text-text-muted">{status}</span>
                  ) : (
                    <TypingDots />
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border px-4 pb-4 pt-3">
        <form onSubmit={handleSubmit}>
          <div className="relative rounded-xl border border-border bg-bg-panel transition-colors focus-within:border-accent/50">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={hasCode ? 'Describe changes to refine...' : 'Describe what you want to build...'}
              rows={3}
              disabled={isLoading}
              className="w-full resize-none rounded-xl bg-transparent px-4 py-3 pr-12 text-sm text-text-primary placeholder-text-dim outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="absolute bottom-3 right-3 flex h-7 w-7 items-center justify-center rounded-lg bg-accent transition-all disabled:opacity-30 hover:bg-accent-dim active:scale-95"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4 fill-white">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/>
              </svg>
            </button>
          </div>
          <p className="mt-2 text-center text-xs text-text-dim">
            Powered by <span className="text-accent">claude -p</span> · Build123d
          </p>
        </form>
      </div>
    </div>
  )
}
