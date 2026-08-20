import { computed, watchEffect } from 'vue'
import { useProject } from './useProject'
import { isValidToken } from '@/lib/settings'
import { setColorTokens } from '@/lib/colors'
import { setStyleTokens } from '@/lib/styles'
import type { DesignToken } from '@/types/editor'

let syncStarted = false

export function useSettings() {
  const { project } = useProject()

  const settings = computed(() => project.value.settings)
  const validTokens = computed(() => settings.value.tokens.filter(isValidToken))

  // keep the (non-reactive) style/color vocabularies aware of tokens so
  // bg-brand suggests, validates, and resolves to its hex everywhere
  if (!syncStarted) {
    syncStarted = true
    watchEffect(() => {
      setColorTokens(Object.fromEntries(validTokens.value.map((t) => [t.name, t.value])))
      setStyleTokens(validTokens.value.map((t) => t.name))
    })
  }

  function addToken(): DesignToken {
    const token: DesignToken = { id: crypto.randomUUID(), name: '', value: '#3b82f6' }
    settings.value.tokens.push(token)
    return token
  }

  function removeToken(id: string) {
    settings.value.tokens = settings.value.tokens.filter((t) => t.id !== id)
  }

  return { settings, validTokens, addToken, removeToken }
}
