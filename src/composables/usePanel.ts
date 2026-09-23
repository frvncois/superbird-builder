import { ref } from 'vue'

/** which right-sidebar popover is open ('style', 'data', …) */
const activePanelId = ref<string | null>(null)

/** panel that should focus its primary input once it renders */
const pendingFocus = ref<string | null>(null)

export function usePanel() {
  function openPanel(id: string, opts?: { focus?: boolean }) {
    activePanelId.value = id
    if (opts?.focus) pendingFocus.value = id
  }

  function togglePanel(id: string) {
    activePanelId.value = activePanelId.value === id ? null : id
  }

  function closePanel() {
    activePanelId.value = null
    pendingFocus.value = null
  }

  return { activePanelId, pendingFocus, openPanel, togglePanel, closePanel }
}
