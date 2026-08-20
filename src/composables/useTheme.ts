import { ref } from 'vue'

// Dark is the default (:root in main.css); the `.light` class on the
// document element flips the theme tokens. A per-browser UI preference —
// not project data — so it lives in localStorage, not the server store.
export type Theme = 'dark' | 'light'

const KEY = 'superbird-theme'
const stored = localStorage.getItem(KEY)
const theme = ref<Theme>(stored === 'light' ? 'light' : 'dark')

function apply(value: Theme) {
  document.documentElement.classList.toggle('light', value === 'light')
}
apply(theme.value)

export function useTheme() {
  function setTheme(value: Theme) {
    theme.value = value
    localStorage.setItem(KEY, value)
    apply(value)
  }

  function toggleTheme() {
    setTheme(theme.value === 'light' ? 'dark' : 'light')
  }

  return { theme, setTheme, toggleTheme }
}
