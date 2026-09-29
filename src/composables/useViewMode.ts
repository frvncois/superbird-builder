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

/**
 * The three docked columns beside the rail — pages, code and components — share
 * ONE 16rem track, so at most one is open. That is why this is a single ref
 * rather than three booleans: with three flags every toggle would have to clear
 * the other two by hand, and the invariant would live in six places instead of
 * one. `null` is the bare canvas.
 *
 * Pages belongs to the shell (both surfaces, contributors included); code and
 * components are Build-only building tools.
 */
const column = ref<'pages' | 'code' | 'components' | null>(null)
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
        // only the build-only columns close: a contributor still gets Pages
        if (column.value === 'code' || column.value === 'components') column.value = null
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
   * A Build-only column button (Code, Components). From Preview it brings you
   * back to the Build surface WITH the column open (one click, not two); on
   * Build it flips it. Contributors never get here (the buttons are hidden and
   * `setMode` refuses Build anyway).
   */
  function toggleBuildColumn(which: 'code' | 'components') {
    if (!canBuild.value) return
    if (mode.value !== 'build') {
      setMode('build')
      column.value = which
      return
    }
    column.value = column.value === which ? null : which
  }

  const toggleCode = () => toggleBuildColumn('code')
  const toggleComponents = () => toggleBuildColumn('components')

  /** The rail's Pages button: flips the pages column, on either surface. */
  function togglePages() {
    column.value = column.value === 'pages' ? null : 'pages'
  }

  /** The rail's App/logo button: the default surface — the bare Build canvas,
   *  no column open. */
  function showApp() {
    column.value = null
    setMode('build')
  }

  const isPreview = computed(() => mode.value === 'preview')
  const isBuild = computed(() => mode.value === 'build')
  const pagesOpen = computed(() => column.value === 'pages')
  const codeOpen = computed(() => column.value === 'code')
  const componentsOpen = computed(() => column.value === 'components')
  /** the build-only columns render only on Build, and only when toggled on */
  const showCode = computed(() => isBuild.value && codeOpen.value)
  const showComponents = computed(() => isBuild.value && componentsOpen.value)
  /**
   * What the shell actually renders in the shared track. Crossing into Preview
   * hides code/components without forgetting them, so returning to Build brings
   * the column back.
   */
  const visibleColumn = computed(() =>
    column.value === 'pages' || isBuild.value ? column.value : null,
  )

  return {
    mode, isPreview, isBuild,
    column, visibleColumn, pagesOpen, codeOpen, componentsOpen, showCode, showComponents,
    setMode, toggleCode, togglePages, toggleComponents, showApp,
  }
}
