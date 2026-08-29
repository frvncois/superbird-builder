import { computed, ref } from 'vue'
import { flushStore } from '@/lib/store'

export type Role = 'admin' | 'editor' | 'contributor'

const email = ref<string | null>(null)
const name = ref('')
const role = ref<Role | null>(null)
const needsSetup = ref(false)
let checked = false

interface Profile {
  id?: string
  email: string
  name?: string
  role?: Role
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
        role.value = profile.role ?? null
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
    role.value = profile.role ?? null
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

  // role-derived capabilities (UI gating; the server enforces the rest)
  const isAdmin = computed(() => role.value === 'admin')
  const canBuild = computed(() => role.value === 'admin' || role.value === 'editor')

  return { email, name, role, isAdmin, canBuild, needsSetup, check, login, setup, updateAccount, logout }
}
