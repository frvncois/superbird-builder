import { ref } from 'vue'
import { onUnauthorized } from '@/lib/store'

// Per-user API tokens (bearer credentials for the Guano MCP server & scripts).
// The raw token is returned by create() exactly once and never stored client- or
// server-side — only its hash lives at rest. Mirrors useUsers' fetch shape.
export interface ApiTokenRow {
  id: string
  name: string
  createdAt: number
  lastUsedAt: number | null
}

const tokens = ref<ApiTokenRow[]>([])

async function json(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  })
  if (res.status === 401) onUnauthorized() // dead session — back to login
  const detail = await res.json().catch(() => null)
  if (!res.ok) throw new Error(detail?.error ?? `request failed (${res.status})`)
  return detail
}

export function useApiTokens() {
  async function load() {
    tokens.value = (await json('/api/tokens')).tokens
  }

  /** create a token; returns the raw token string (shown once, then unrecoverable) */
  async function create(name: string): Promise<string> {
    const created = await json('/api/tokens', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
    await load()
    return created.token as string
  }

  async function revoke(id: string) {
    await json(`/api/tokens/${id}`, { method: 'DELETE' })
    await load()
  }

  return { tokens, load, create, revoke }
}
