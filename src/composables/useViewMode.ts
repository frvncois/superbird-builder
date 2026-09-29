import { computed, ref, watch } from 'vue'
import { useAuth } from './useAuth'
import { useMotion } from './useMotion'

// Which editing surface the single shell shows: the Build canvas (frames +
// full inspector) or the full-site Preview. Runtime-only, shared across the
// app — deliberately NOT on the project (not persisted, not undoable).
//
// Contributors are content-only: they can never enter Build, so the mode is
// pinned to 'preview' for them (the Build-only rail buttons are hidden too).
const mode = ref<'build' | 'preview'>('build')

/**
 * What the Build canvas shows: the open page, or the components board.
 *
 * Deliberately separate from `column` below. They used to be one thing — the
 * board was visible exactly while the Components column was open — which
 * cannot survive Layers, whose whole job is to show the layers of whatever is
 * on the canvas WHILE holding the column itself.
 */
const canvas = ref<'page' | 'components'>('page')

/**
 * The docked column beside the rail — pages, layers or components. They share
 * ONE 16rem track, so at most one is open. That is why this is a single ref
 * rather than three booleans: with flags every toggle would have to clear the
 * others by hand and the invariant would live in six places. `null` is the
 * bare canvas.
 *
 * Pages belongs to the shell (both surfaces, contributors included); layers
 * and components are Build-only building tools.
 */
const column = ref<'pages' | 'layers' | 'components' | null>(null)
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
        canvas.value = 'page'
        // only the build-only columns close: a contributor still gets Pages
        if (column.value === 'layers' || column.value === 'components') column.value = null
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

  /** the canvas only ever switches on Build, and only for build roles */
  function setCanvas(next: 'page' | 'components') {
    if (!canBuild.value) return
    canvas.value = next
  }

  /**
   * A Build-only column button. From Preview it brings you back to the Build
   * surface WITH the column open (one click, not two); on Build it flips it.
   * Contributors never get here (the buttons are hidden and `setMode` refuses
   * Build anyway).
   */
  function toggleBuildColumn(which: 'layers' | 'components') {
    if (!canBuild.value) return
    if (mode.value !== 'build') {
      setMode('build')
      column.value = which
      return
    }
    column.value = column.value === which ? null : which
  }

  const toggleLayers = () => toggleBuildColumn('layers')

  /**
   * The rail's Components button: the board, plus its column. Pressed again
   * with the column already open it closes the column and LEAVES the board —
   * that is the point of the split, and how you get a full-width board.
   */
  function toggleComponents() {
    if (!canBuild.value) return
    if (mode.value !== 'build') setMode('build')
    setCanvas('components')
    column.value = column.value === 'components' ? null : 'components'
  }

  /** The rail's Pages button: flips the pages column, on either surface. */
  function togglePages() {
    column.value = column.value === 'pages' ? null : 'pages'
  }

  /** The rail's App/logo button: the default surface — the bare page canvas,
   *  no column open. */
  function showApp() {
    column.value = null
    canvas.value = 'page'
    setMode('build')
  }

  const isPreview = computed(() => mode.value === 'preview')
  const isBuild = computed(() => mode.value === 'build')
  const pagesOpen = computed(() => column.value === 'pages')
  const layersOpen = computed(() => column.value === 'layers')
  const componentsOpen = computed(() => column.value === 'components')
  /** the build-only columns render only on Build, and only when toggled on */
  const showLayers = computed(() => isBuild.value && layersOpen.value)
  /** the board is a CANVAS state now, not a column one */
  const showComponents = computed(() => isBuild.value && canvas.value === 'components')
  /**
   * What the shell actually renders in the shared track. Crossing into Preview
   * hides the build-only columns without forgetting them, so returning to
   * Build brings the column back.
   */
  const visibleColumn = computed(() =>
    column.value === 'pages' || isBuild.value ? column.value : null,
  )

  return {
    mode, isPreview, isBuild, canvas,
    column, visibleColumn, pagesOpen, layersOpen, componentsOpen, showLayers, showComponents,
    setMode, setCanvas, toggleLayers, togglePages, toggleComponents, showApp,
  }
}
