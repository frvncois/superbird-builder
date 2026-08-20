import { computed, watch } from 'vue'
import { useSettings } from './useSettings'
import { themeBlock } from '@/lib/settings'

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
  const block = computed(() => themeBlock(settings.value))
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
