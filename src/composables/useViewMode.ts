import { computed, ref, watch } from 'vue'
import { useAuth } from './useAuth'
import { useMotion } from './useMotion'

// Which editing surface the single shell shows: the Build canvas (code + frames
// + full inspector) or the full-site Preview. Runtime-only, shared across the
// app — deliberately NOT on the project (not persisted, not undoable).
//
// Contributors are content-only: they can never enter Build, so the mode is
// pinned to 'preview' for them (the Code rail button is also hidden).
const mode = ref<'build' | 'preview'>('build')
// The code column is a toggle ON the Build surface, not the surface itself:
// Build opens on the bare canvas and the rail's Code button reveals the
// editor beside it. Off by default, runtime-only like `mode`.
const codeOpen = ref(false)
// The pages column works the same way — a docked column the rail's Pages
// button toggles — but it belongs to the shell rather than to Build: it works
// on both surfaces, and contributors get it too. The two columns share ONE
// slot beside the rail: opening either closes the other, so `codeOpen` and
// `pagesOpen` are never both true.
const pagesOpen = ref(false)
let pinStarted = false

export function useViewMode() {
  const { canBuild } = useAuth()

  if (!pinStarted) {
    pinStarted = true
    // role resolves at boot (possibly after first call) — force preview the
    // moment we learn the user can't build
    watch(canBuild, (can) => {
      if (!can) {
        mode.value = 'preview'
        codeOpen.value = false
      }
    }, { immediate: true })
  }

  function setMode(next: 'build' | 'preview') {
    if (next === 'build' && !canBuild.value) return
    // animations only auto-play in Preview — crossing the surface boundary
    // drops every play (entering Build stops them; entering Preview restarts
    // its triggers from a clean slate on mount)
    if (next !== mode.value) useMotion().stopAll()
    mode.value = next
  }

  /**
   * The rail's Code button. From Preview it brings you back to the Build
   * surface WITH the editor open (one click, not two); on Build it just flips
   * the column. Contributors never get here (the button is hidden and
   * `setMode` refuses Build anyway).
   */
  function toggleCode() {
    if (!canBuild.value) return
    if (mode.value !== 'build') {
      setMode('build')
      codeOpen.value = true
    } else {
      codeOpen.value = !codeOpen.value
    }
    if (codeOpen.value) pagesOpen.value = false
  }

  /** The rail's Pages button: flips the pages column, on either surface —
   *  taking the slot from the code column when it opens. */
  function togglePages() {
    pagesOpen.value = !pagesOpen.value
    if (pagesOpen.value) codeOpen.value = false
  }

  /** The rail's App/logo button: the default surface — the bare Build canvas,
   *  neither column open. */
  function showApp() {
    codeOpen.value = false
    pagesOpen.value = false
    setMode('build')
  }

  const isPreview = computed(() => mode.value === 'preview')
  const isBuild = computed(() => mode.value === 'build')
  /** the code column renders only on Build, and only when toggled on */
  const showCode = computed(() => mode.value === 'build' && codeOpen.value)

  return {
    mode, isPreview, isBuild, codeOpen, showCode, pagesOpen,
    setMode, toggleCode, togglePages, showApp,
  }
}
