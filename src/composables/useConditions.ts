import { ref } from 'vue'

/** editor-only: when on, condition-hidden elements disappear from the
 * canvas (like the published site) instead of rendering dimmed */
const previewConditions = ref(false)

export function useConditions() {
  return { previewConditions }
}
