import { computed, watch } from 'vue'
import { useSettings } from './useSettings'
import { themeBlock, isValidToken } from '@/lib/settings'

// --color-* names owned by the editor chrome — keep in sync with the
// `@theme inline` block in assets/main.css. A project token may legally share
// one of these names (e.g. `accent`): the runtime @theme would then put the
// PROJECT value on :root, and the runtime-compiled utility (later in the
// cascade than the prebuilt sheet) would recolor the app chrome itself. So we
// re-assert the chrome mapping globally (unlayered — beats @theme's layer) and
// scope the project values to [data-site-scope] (the canvas frames + the
// preview main): CSS variables resolve per element, so site content gets the
// project palette and the app chrome keeps its own.
const CHROME_COLOR_VARS = [
  'background', 'foreground', 'input',
  'muted', 'muted-foreground',
  'primary', 'primary-foreground',
  'secondary', 'secondary-foreground',
  'accent', 'accent-foreground',
  'success', 'pending', 'danger',
  'editor-fg', 'editor-comment', 'editor-keyword', 'editor-arg',
  'editor-string', 'editor-punct', 'editor-component',
  'state-class',
]

let started = false
let styleEl: HTMLStyleElement | null = null
let fontLinkEl: HTMLLinkElement | null = null
let timer: ReturnType<typeof setTimeout> | null = null

/**
 * Keeps ONE <style type="text/tailwindcss"> element in the head whose
 * body is the project's @theme token block. The @tailwindcss/browser
 * runtime (already running in both zones) observes it and recompiles,
 * making bg-<token> classes live. Writes are debounced — every mutation
 * triggers a full document recompile, so hex typing must not thrash it.
 * Also maintains the optional Google Fonts stylesheet link.
 */
export function useThemeTokens() {
  if (started) return
  started = true

  const { settings } = useSettings()
  const block = computed(() => {
    const tokens = settings.value.tokens.filter(isValidToken)
    if (!tokens.length) return ''
    const reassert = CHROME_COLOR_VARS.map((n) => `  --color-${n}: var(--${n});`).join('\n')
    const scoped = tokens.map((t) => `  --color-${t.name}: ${t.value};`).join('\n')
    return `${themeBlock(settings.value)}\n:root {\n${reassert}\n}\n[data-site-scope] {\n${scoped}\n}`
  })
  const fontsUrl = computed(() => {
    const url = settings.value.fonts.googleFontsUrl ?? ''
    return url.startsWith('https://fonts.googleapis.com/') ? url : ''
  })

  watch(
    block,
    (css) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (!styleEl) {
          styleEl = document.createElement('style')
          styleEl.type = 'text/tailwindcss'
          document.head.appendChild(styleEl)
        }
        styleEl.textContent = css
      }, 200)
    },
    { immediate: true },
  )

  watch(
    fontsUrl,
    (url) => {
      if (!url) {
        fontLinkEl?.remove()
        fontLinkEl = null
        return
      }
      if (!fontLinkEl) {
        fontLinkEl = document.createElement('link')
        fontLinkEl.rel = 'stylesheet'
        document.head.appendChild(fontLinkEl)
      }
      fontLinkEl.href = url
    },
    { immediate: true },
  )
}
