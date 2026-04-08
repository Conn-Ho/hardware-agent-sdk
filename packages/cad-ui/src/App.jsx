import { useState, useCallback } from 'react'
import ChatPanel from './components/ChatPanel.jsx'
import ViewerPanel from './components/ViewerPanel.jsx'
import CodePanel from './components/CodePanel.jsx'

const SUGGESTIONS = [
  'ESP32-C3 enclosure with USB-C slot and display window',
  'Raspberry Pi Zero W case with GPIO cutout',
  'Battery holder for 3x AA cells with lid',
  'Adjustable phone stand with cable management slot',
  'Wall-mount bracket for small PCB with 4 M3 holes',
]

export default function App() {
  const [messages, setMessages] = useState([])
  const [currentCode, setCurrentCode] = useState('')
  const [stlB64, setStlB64] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [activeRight, setActiveRight] = useState('viewer') // 'viewer' | 'code'
  const [panelWidths, setPanelWidths] = useState({ chat: 30, viewer: 45, code: 25 })

  const addMessage = (role, content) =>
    setMessages(prev => [...prev, { id: Date.now() + Math.random(), role, content }])

  const streamRequest = useCallback(async (endpoint, body) => {
    setIsLoading(true)
    setStatus('')

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''

      for (const part of parts) {
        if (!part.trim()) continue
        const lines = part.split('\n')
        let event = 'message', data = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) event = line.slice(7).trim()
          else if (line.startsWith('data: ')) data = line.slice(6).trim()
        }
        try {
          const payload = JSON.parse(data)
          handleSSEEvent(event, payload)
        } catch {}
      }
    }

    setIsLoading(false)
    setStatus('')
  }, [])

  const handleSSEEvent = useCallback((event, payload) => {
    switch (event) {
      case 'status':
        setStatus(payload.message)
        break
      case 'code':
        setCurrentCode(payload.code)
        setActiveRight('code')
        break
      case 'result':
        if (payload.success) {
          if (payload.stl_b64) {
            setStlB64(payload.stl_b64)
            setActiveRight('viewer')
          }
          if (payload.metrics) setMetrics(payload.metrics)
          addMessage('assistant', {
            type: 'result',
            metrics: payload.metrics,
            hasModel: !!payload.stl_b64,
          })
        } else {
          addMessage('assistant', {
            type: 'error',
            text: payload.error || 'Execution failed — code generated, Docker not available',
          })
        }
        break
      case 'error':
        addMessage('assistant', { type: 'error', text: payload.message })
        break
    }
  }, [])

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || isLoading) return
    addMessage('user', { type: 'text', text })

    const isFirst = messages.length === 0
    const endpoint = isFirst || !currentCode ? '/api/generate' : '/api/refine'
    const body = isFirst || !currentCode
      ? { description: text }
      : { description: text, currentCode }

    await streamRequest(endpoint, body)
  }, [messages.length, currentCode, isLoading, streamRequest])

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg-primary">
      {/* Header bar */}
      <div className="absolute left-0 right-0 top-0 z-10 flex h-11 items-center justify-between border-b border-border bg-bg-secondary px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" strokeWidth="1.5" fill="none"/>
            </svg>
          </div>
          <span className="text-sm font-semibold text-text-primary">CAD Agent</span>
          <span className="text-xs text-text-muted">Build123d · claude -p</span>
        </div>
        {/* Right panel toggle */}
        <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-panel p-1">
          <button
            onClick={() => setActiveRight('viewer')}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${activeRight === 'viewer' ? 'bg-bg-hover text-text-primary' : 'text-text-muted hover:text-text-primary'}`}
          >
            3D Viewer
          </button>
          <button
            onClick={() => setActiveRight('code')}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${activeRight === 'code' ? 'bg-bg-hover text-text-primary' : 'text-text-muted hover:text-text-primary'}`}
          >
            Code
          </button>
        </div>
      </div>

      {/* Main panels */}
      <div className="flex h-full w-full pt-11">
        {/* Chat panel */}
        <div className="flex h-full border-r border-border" style={{ width: '380px', minWidth: '320px', flexShrink: 0 }}>
          <ChatPanel
            messages={messages}
            isLoading={isLoading}
            status={status}
            onSend={sendMessage}
            suggestions={SUGGESTIONS}
            hasCode={!!currentCode}
          />
        </div>

        <div className="resize-handle" />

        {/* Right panel */}
        <div className="flex flex-1 overflow-hidden">
          {activeRight === 'viewer' ? (
            <ViewerPanel stlB64={stlB64} metrics={metrics} isLoading={isLoading} status={status} />
          ) : (
            <CodePanel code={currentCode} />
          )}
        </div>
      </div>
    </div>
  )
}
