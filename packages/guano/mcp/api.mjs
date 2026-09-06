// Thin HTTP client for a running Guano instance. The MCP server NEVER touches
// the data dir directly — every read/write goes through the authed HTTP API,
// exactly as the browser editor does. Auth is a `guano_` API-token bearer
// (create one in the editor: My account → API tokens).

const BASE = (process.env.GUANO_URL || 'http://localhost:4174').replace(/\/+$/, '')
const TOKEN = process.env.GUANO_TOKEN || ''

class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function req(method, path, body) {
  let res
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
  } catch (e) {
    throw new ApiError(0, `cannot reach Guano at ${BASE} — is the server running? (${e.message})`)
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    const msg = detail?.error ?? `request failed (${res.status})`
    throw new ApiError(res.status, msg)
  }
  return res
}

/** the authenticated user, or throws (bad URL / token / role) */
export async function whoami() {
  const res = await req('GET', '/api/auth/me')
  return res.json()
}

/** raw stored string for a key, or null when absent */
export async function storeGetRaw(key) {
  const res = await req('GET', `/api/store?keys=${encodeURIComponent(key)}`)
  const map = await res.json()
  return map[key] ?? null
}

/** parsed JSON for a key, or null when absent */
export async function storeGetJson(key) {
  const raw = await storeGetRaw(key)
  return raw === null ? null : JSON.parse(raw)
}

/** write a raw string under a key */
export async function storePutRaw(key, raw) {
  await req('PUT', `/api/store/${encodeURIComponent(key)}`, raw)
}

/** publish (server method): editor+ only, gated server-side */
export async function publish(projectSnapshot) {
  const res = await req('POST', '/api/published?method=server', projectSnapshot)
  return res.json()
}

export { ApiError, BASE, TOKEN }
