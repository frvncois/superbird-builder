import { ref } from 'vue'

/** whether the shortcuts & syntax cheatsheet modal is open */
const cheatOpen = ref(false)

export function useCheatSheet() {
  return {
    cheatOpen,
    open: () => (cheatOpen.value = true),
    close: () => (cheatOpen.value = false),
  }
}
