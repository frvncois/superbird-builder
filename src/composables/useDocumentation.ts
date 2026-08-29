import { ref } from 'vue'

/** whether the documentation modal is open */
const docsOpen = ref(false)

/** active section id; null shows the hub (home) page */
const activeSection = ref<string | null>(null)

export function useDocumentation() {
  return {
    docsOpen,
    activeSection,
    open: (section?: string) => {
      activeSection.value = section ?? null
      docsOpen.value = true
    },
    close: () => (docsOpen.value = false),
  }
}
