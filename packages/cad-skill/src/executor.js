/**
 * Executor — sends Build123d code to the Docker container and returns results.
 */

const EXECUTOR_URL = process.env.CAD_EXECUTOR_URL ?? 'http://localhost:8765'

export async function executeCadCode(code) {
  let res
  try {
    res = await fetch(`${EXECUTOR_URL}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(120_000),
    })
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.message?.includes('fetch')) {
      throw new Error(
        `CAD executor not reachable at ${EXECUTOR_URL}.\n` +
        `Start it with: cd packages/cad-skill && npm run build-docker && docker run -p 8765:8765 hardware-sdk-cad`
      )
    }
    throw err
  }

  if (!res.ok) throw new Error(`Executor HTTP ${res.status}`)
  return res.json()
}

export async function checkExecutorHealth() {
  try {
    const res = await fetch(`${EXECUTOR_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}
