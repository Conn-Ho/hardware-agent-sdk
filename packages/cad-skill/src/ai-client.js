/**
 * AI client — pluggable backend for CAD code generation.
 *
 * Supported providers:
 *   claude-cli   — calls `claude -p` subprocess (no API key, uses Claude Code auth)
 *   anthropic    — direct Anthropic SDK (ANTHROPIC_API_KEY)
 *   openai       — OpenAI-compatible endpoint (Ollama, LM Studio, OpenRouter, etc.)
 *   gemini       — Google Gemini API (supports vision)
 *
 * Config is read from (in priority order):
 *   1. explicit options passed to aiPrompt()
 *   2. AI_PROVIDER / AI_MODEL / AI_BASE_URL / AI_API_KEY env vars
 *   3. defaults (claude-cli)
 */

import { spawn }   from 'node:child_process'

// ── Defaults ──────────────────────────────────────────────────────────────────

export const PROVIDERS = {
  'claude-cli':  { label: 'Claude Code (local CLI)',        needsKey: false, vision: false },
  'anthropic':   { label: 'Anthropic API',                  needsKey: true,  vision: true  },
  'openai':      { label: 'OpenAI-compatible (Ollama etc)', needsKey: false, vision: false },
  'gemini':      { label: 'Google Gemini API',              needsKey: true,  vision: true  },
}

export function defaultConfig() {
  return {
    provider: process.env.AI_PROVIDER  || 'claude-cli',
    model:    process.env.AI_MODEL     || '',
    baseUrl:  process.env.AI_BASE_URL  || '',
    apiKey:   process.env.AI_API_KEY   || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY || '',
  }
}

// ── Main entry ────────────────────────────────────────────────────────────────

/**
 * Send a prompt and return the text response.
 * @param {string} prompt
 * @param {object} opts
 * @param {string} [opts.systemPrompt]
 * @param {string} [opts.provider]      — override provider
 * @param {string} [opts.model]         — override model
 * @param {string} [opts.baseUrl]       — override base URL (openai provider)
 * @param {string} [opts.apiKey]        — override API key
 * @param {string} [opts.imageBase64]   — base64-encoded image (vision, optional)
 * @param {string} [opts.imageMimeType] — MIME type of the image (e.g. 'image/png')
 * @returns {Promise<string>}
 */
export async function aiPrompt(prompt, opts = {}) {
  const cfg = { ...defaultConfig(), ...opts }

  switch (cfg.provider) {
    case 'anthropic':   return anthropicPrompt(prompt, cfg)
    case 'openai':      return openaiPrompt(prompt, cfg)
    case 'gemini':      return geminiPrompt(prompt, cfg)
    case 'claude-cli':
    default:            return claudeCliPrompt(prompt, cfg)
  }
}

// ── claude -p subprocess ──────────────────────────────────────────────────────

function claudeCliPrompt(prompt, { systemPrompt, model, timeoutMs = 300_000 }) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'text']
    if (systemPrompt) args.push('--append-system-prompt', systemPrompt)
    // Only pass --model if it's a Claude model name (not gemini/gpt/etc from a stale config)
    if (model && model.startsWith('claude')) args.push('--model', model)

    const env = { ...process.env }
    delete env.CLAUDECODE   // allow nested claude calls

    const child = spawn('claude', args, { env })
    let stdout = '', stderr = ''

    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`claude -p timed out after ${timeoutMs / 1000}s`))
    }, timeoutMs)

    child.stdin.write(prompt)
    child.stdin.end()
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })

    child.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`claude -p exited ${code}: ${stderr.slice(0, 300)}`))
      else            resolve(stdout.trim())
    })
    child.on('error', err => {
      clearTimeout(timer)
      reject(new Error(`Failed to start claude CLI: ${err.message}. Is claude installed?`))
    })
  })
}

// ── Anthropic SDK (with vision) ───────────────────────────────────────────────

async function anthropicPrompt(prompt, { systemPrompt, model, apiKey, imageBase64, imageMimeType }) {
  if (!apiKey) throw new Error('Anthropic provider requires an API key. Set it in Settings.')

  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
    throw new Error('@anthropic-ai/sdk not installed. Run: npm install @anthropic-ai/sdk in packages/cad-skill')
  })

  const client = new Anthropic({ apiKey })

  const userContent = []
  if (imageBase64 && imageMimeType) {
    userContent.push({ type: 'image', source: { type: 'base64', media_type: imageMimeType, data: imageBase64 } })
  }
  userContent.push({ type: 'text', text: prompt })

  const res = await client.messages.create({
    model:      model || 'claude-sonnet-4-6',
    max_tokens: 8096,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userContent }],
  })

  return res.content[0]?.text?.trim() ?? ''
}

// ── Google Gemini API (with vision) ───────────────────────────────────────────

async function geminiPrompt(prompt, { systemPrompt, model, apiKey, imageBase64, imageMimeType }) {
  if (!apiKey) throw new Error('Gemini provider requires an API key. Set it in Settings.')

  const modelId = model || 'gemini-2.0-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`

  const parts = []
  if (imageBase64 && imageMimeType) {
    parts.push({ inlineData: { mimeType: imageMimeType, data: imageBase64 } })
  }
  parts.push({ text: prompt })

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { maxOutputTokens: 8096 },
  }
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] }
  }

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(120_000),
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Gemini API returned ${res.status}: ${txt.slice(0, 300)}`)
  }

  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
}

// ── OpenAI-compatible (Ollama, LM Studio, OpenRouter, …) ─────────────────────

async function openaiPrompt(prompt, { systemPrompt, model, baseUrl, apiKey }) {
  const url  = (baseUrl || 'http://localhost:11434') + '/v1/chat/completions'
  const msgs = []
  if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt })
  msgs.push({ role: 'user', content: prompt })

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model:      model || 'llama3',
      messages:   msgs,
      max_tokens: 8096,
    }),
    signal: AbortSignal.timeout(120_000),
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`OpenAI-compatible endpoint returned ${res.status}: ${txt.slice(0, 200)}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() ?? ''
}
