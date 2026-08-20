import { ref } from 'vue'

/**
 * Write-through store: the editor's persistence lives on the server
 * (authed /api/store endpoints), fronted by a synchronous in-memory
 * cache so all existing persistence code keeps its sync signatures.
 * Reads hit the cache; writes update the cache immediately and flush to
 * the server through a per-key serialized queue (latest wins — never
 * out-of-order PUTs). Only boot needs to await hydration.
 */

const cache = new Map<string, string>()
const hydratedKeys = new Set<string>()

/** last write failure, cleared on the next success (drives save status) */
export const storeError = ref<string | null>(null)
/** number of keys with unflushed or in-flight writes */
export const pendingWrites = ref(0)

interface Op {
  method: 'PUT' | 'DELETE'
  value?: string
}

const queues = new Map<string, { inflight: boolean; next: Op | null }>()

function countPending() {
  let n = 0
  for (const q of queues.values()) if (q.inflight || q.next) n++
  pendingWrites.value = n
}

export function storeGet(key: string): string | null {
  return cache.get(key) ?? null
}

export function storeSet(key: string, value: string) {
  cache.set(key, value)
  enqueue(key, { method: 'PUT', value })
}

export function storeRemove(key: string) {
  cache.delete(key)
  enqueue(key, { method: 'DELETE' })
}

function enqueue(key: string, op: Op) {
  let q = queues.get(key)
  if (!q) {
    q = { inflight: false, next: null }
    queues.set(key, q)
  }
  q.next = op // latest wins: an unsent op is simply replaced
  countPending()
  if (!q.inflight) void flush(key)
}

async function flush(key: string) {
  const q = queues.get(key)!
  q.inflight = true
  countPending()
  while (q.next) {
    const op = q.next
    q.next = null
    try {
      const res = await fetch(`/api/store/${encodeURIComponent(key)}`, {
        method: op.method,
        body: op.value,
      })
      if (res.status === 401) {
        // session expired mid-work — back to login (hard reload)
        window.location.assign('/admin/login')
        return
      }
      if (!res.ok) throw new Error(`save failed (${res.status})`)
      storeError.value = null
    } catch (e) {
      // keep the op queued so a manual save (or the next edit) retries
      q.next ??= op
      storeError.value = e instanceof Error ? e.message : 'save failed'
      break
    }
  }
  q.inflight = false
  countPending()
}

/** fetches keys not yet hydrated into the cache; throws on network failure */
export async function hydrateStore(keys: string[]): Promise<void> {
  const missing = keys.filter((k) => !hydratedKeys.has(k))
  if (!missing.length) return
  const res = await fetch(`/api/store?keys=${missing.map(encodeURIComponent).join(',')}`)
  if (res.status === 401) {
    window.location.assign('/admin/login')
    await new Promise(() => {}) // navigation is taking over
  }
  if (!res.ok) throw new Error(`store fetch failed (${res.status})`)
  const data = (await res.json()) as Record<string, string | null>
  for (const [key, value] of Object.entries(data)) {
    hydratedKeys.add(key)
    // never clobber a key with local writes still in flight
    const q = queues.get(key)
    if (q && (q.inflight || q.next)) continue
    if (value === null) cache.delete(key)
    else cache.set(key, value)
  }
}

/** resolves once every queued write has been flushed (best effort) */
export async function flushStore(): Promise<void> {
  while ([...queues.values()].some((q) => q.inflight || q.next)) {
    await new Promise((r) => setTimeout(r, 50))
    if (storeError.value) return // stuck on an error — don't hang forever
  }
}

/**
 * One-time import of a pre-auth localStorage project into the server
 * store. Runs only when the server has no editor data at all and the
 * browser still holds the old keys. localStorage is left untouched as
 * a backup.
 */
export async function migrateLocalToServer(): Promise<void> {
  await hydrateStore(['superbird-branches', 'superbird-project:main'])
  if (storeGet('superbird-branches') || storeGet('superbird-project:main')) return

  const legacy = localStorage.getItem('superbird-project')
  const keys = Object.keys(localStorage).filter(
    (k) =>
      k.startsWith('superbird-project:') ||
      k.startsWith('superbird-base:') ||
      k === 'superbird-branches' ||
      k === 'superbird-published-baseline' ||
      k === 'superbird-published-info',
  )
  if (!keys.length && !legacy) return

  for (const key of keys) storeSet(key, localStorage.getItem(key)!)
  if (legacy && !localStorage.getItem('superbird-project:main')) {
    storeSet('superbird-project:main', legacy)
  }
  await flushStore()
}
