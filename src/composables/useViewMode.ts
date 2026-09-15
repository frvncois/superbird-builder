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
let pinStarted = false

export function useViewMode() {
  const { canBuild } = useAuth()

  if (!pinStarted) {
    pinStarted = true
    // role resolves at boot (possibly after first call) — force preview the
    // moment we learn the user can't build
    watch(canBuild, (can) => { if (!can) mode.value = 'preview' }, { immediate: true })
  }

  function setMode(next: 'build' | 'preview') {
    if (next === 'build' && !canBuild.value) return
    // animations only auto-play in Preview — crossing the surface boundary
    // drops every play (entering Build stops them; entering Preview restarts
    // its triggers from a clean slate on mount)
    if (next !== mode.value) useMotion().stopAll()
    mode.value = next
  }

  const isPreview = computed(() => mode.value === 'preview')
  const isBuild = computed(() => mode.value === 'build')

  return { mode, isPreview, isBuild, setMode }
}
