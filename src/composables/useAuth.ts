import { ref } from 'vue'
import { flushStore } from '@/lib/store'

const email = ref<string | null>(null)
const name = ref('')
const needsSetup = ref(false)
let checked = false

interface Profile {
  email: string
  name?: string
}

export function useAuth() {
  /** memoized session check against the server */
  async function check(): Promise<void> {
    if (checked) return
    checked = true
    try {
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        const profile = (await res.json()) as Profile
        email.value = profile.email
        name.value = profile.name ?? ''
      } else {
        const detail = await res.json().catch(() => null)
        needsSetup.value = !!detail?.needsSetup
      }
    } catch {
      // server unreachable — treated as unauthenticated; the editor
      // boot gate surfaces the connectivity error separately
    }
  }

  async function post(path: string, body: Record<string, unknown>): Promise<Profile> {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const detail = await res.json().catch(() => null)
    if (!res.ok) throw new Error(detail?.error ?? `request failed (${res.status})`)
    return detail as Profile
  }

  function applyProfile(profile: Profile) {
    email.value = profile.email
    name.value = profile.name ?? ''
    needsSetup.value = false
  }

  async function login(e: string, password: string) {
    applyProfile(await post('/api/auth/login', { email: e, password }))
  }

  async function setup(e: string, password: string) {
    applyProfile(await post('/api/auth/setup', { email: e, password }))
  }

  /** update name / email / password (password needs currentPassword) */
  async function updateAccount(payload: {
    name?: string
    email?: string
    password?: string
    currentPassword?: string
  }) {
    applyProfile(await post('/api/auth/update', payload))
  }

  async function logout() {
    await flushStore() // don't drop in-flight edits
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    // hard reload drops all editor singleton state
    window.location.assign('/admin/login')
  }

  return { email, name, needsSetup, check, login, setup, updateAccount, logout }
}
