import { ref } from 'vue'

/** which right-sidebar popover is open ('style', 'content', …) */
const activePanelId = ref<string | null>(null)

/** panel that should focus its primary input once it renders */
const pendingFocus = ref<string | null>(null)

/** where to send the user back when they Escape out of the panel */
const onEscape = ref<(() => void) | null>(null)

export function usePanel() {
  function openPanel(id: string, opts?: { focus?: boolean; escape?: () => void }) {
    activePanelId.value = id
    if (opts?.focus) pendingFocus.value = id
    onEscape.value = opts?.escape ?? null
  }

  function togglePanel(id: string) {
    activePanelId.value = activePanelId.value === id ? null : id
    if (activePanelId.value === null) onEscape.value = null
  }

  function closePanel() {
    activePanelId.value = null
    pendingFocus.value = null
    onEscape.value = null
  }

  return { activePanelId, pendingFocus, onEscape, openPanel, togglePanel, closePanel }
}
