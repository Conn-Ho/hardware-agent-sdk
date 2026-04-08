/**
 * Calls `claude -p` subprocess, using Claude Code's existing auth.
 * Works without ANTHROPIC_API_KEY by leveraging the local claude CLI.
 */

import { spawn } from 'node:child_process'

/**
 * Run a prompt through claude -p and return the text response.
 * @param {string} prompt
 * @param {object} opts
 * @param {string} [opts.systemPrompt] - appended to default system prompt
 * @param {string} [opts.model] - model override
 * @returns {Promise<string>}
 */
export async function claudePrompt(prompt, { systemPrompt, model } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'text']

    if (systemPrompt) {
      args.push('--append-system-prompt', systemPrompt)
    }
    if (model) {
      args.push('--model', model)
    }

    // Delete CLAUDECODE so nested claude calls are allowed (empty string is not enough)
    const env = { ...process.env }
    delete env.CLAUDECODE

    const child = spawn('claude', args, { env })

    let stdout = ''
    let stderr = ''

    child.stdin.write(prompt)
    child.stdin.end()

    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })

    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`claude -p exited ${code}: ${stderr.slice(0, 300)}`))
      } else {
        resolve(stdout.trim())
      }
    })

    child.on('error', err => {
      reject(new Error(`Failed to start claude CLI: ${err.message}. Is claude installed?`))
    })
  })
}
