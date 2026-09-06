import { computed, ref, watch } from 'vue'
import { useProject } from './useProject'
import { readStoredProject } from '@/lib/storage'
import { pendingWrites, storeError, storeGet, storeSet } from '@/lib/store'
import type { Project } from '@/types/editor'

export type SaveStatus = 'saved' | 'pending' | 'error'

/** presentation metadata for each SaveStatus (the header's save pill) */
export const SAVE_STATES: Record<
  SaveStatus,
  { class: string; dot: string; short: string; label: string }
> = {
  saved: { class: 'bg-success/10 text-success', dot: 'bg-success', short: 'Saved', label: 'All changes saved' },
  pending: { class: 'bg-pending/10 text-pending', dot: 'bg-pending', short: 'Saving…', label: 'Saving…' },
  error: { class: 'bg-danger/10 text-danger', dot: 'bg-danger', short: 'Save failed', label: 'Save failed — click to retry' },
}

const DEBOUNCE_MS = 500
const HISTORY_LIMIT = 50

/**
 * Branch whose project is loaded; lives here (not in useBranches) so
 * storage stays branch-keyed without a circular import.
 */
export const activeBranchId = ref('main')

/** While true the deep autosave watcher is a no-op. The AI assistant sets this
 * around a run: the store is latest-wins, so a debounced autosave of the stale
 * in-memory project would clobber the agent's server-side writes mid-run. */
export const autosaveSuspended = ref(false)

export function projectStorageKey(branchId: string) {
  return `guano-project:${branchId}`
}

// 'saved' means server-acked: the store's queue is empty and error-free
const typing = ref(false)
const status = computed<SaveStatus>(() =>
  storeError.value ? 'error' : typing.value || pendingWrites.value > 0 ? 'pending' : 'saved',
)

// whole-project JSON snapshots; pointer marks the current state
const history = ref<string[]>([])
const pointer = ref(0)

/** the last committed whole-project snapshot — reused for cheap dirty
 * checks (e.g. hasUnpublishedChanges) so nothing else has to re-stringify
 * the image-heavy project on every edit */
export const currentSnapshot = computed(() => history.value[pointer.value] ?? '')

let timer: ReturnType<typeof setTimeout> | null = null
let restoring = false
let initialized = false

export function usePersistence() {
  const { project } = useProject()

  const canUndo = computed(() => pointer.value > 0)
  const canRedo = computed(() => pointer.value < history.value.length - 1)

  /** the single storage write — server-backed via the store adapter */
  function persist(snapshot: string) {
    storeSet(projectStorageKey(activeBranchId.value), snapshot)
    typing.value = false
  }

  function load() {
    try {
      // resume the branch that was active last session
      // (the boot sequence hydrated these keys before init() runs)
      const meta = storeGet('guano-branches')
      if (meta) activeBranchId.value = (JSON.parse(meta).activeId as string) || 'main'

      const stored = readStoredProject(projectStorageKey(activeBranchId.value))
      if (stored) {
        restoring = true
        project.value = stored
        restoring = false
      }
    } catch {
      // corrupt storage — start from the in-memory default project
    }
    history.value = [JSON.stringify(project.value)]
    pointer.value = 0
  }

  /**
   * Replaces the working project wholesale (branch switch / merge):
   * fresh undo history seeded with the new state, persisted under the
   * current branch key.
   */
  function resetTo(next: Project) {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    restoring = true
    project.value = next
    restoring = false
    const snapshot = JSON.stringify(next)
    history.value = [snapshot]
    pointer.value = 0
    persist(snapshot)
  }

  /** snapshot the settled state into history and storage */
  function commit() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    const snapshot = JSON.stringify(project.value)
    if (snapshot === history.value[pointer.value]) {
      persist(snapshot)
      return
    }
    const next = history.value.slice(0, pointer.value + 1)
    next.push(snapshot)
    if (next.length > HISTORY_LIMIT) next.shift()
    history.value = next
    pointer.value = next.length - 1
    persist(snapshot)
  }

  function saveNow() {
    commit()
  }

  function apply(snapshot: string) {
    restoring = true
    project.value = JSON.parse(snapshot) as Project
    restoring = false
    persist(snapshot)
  }

  function undo() {
    if (timer) commit() // fold un-settled keystrokes into history first
    if (!canUndo.value) return
    pointer.value--
    apply(history.value[pointer.value]!)
  }

  function redo() {
    if (!canRedo.value) return
    pointer.value++
    apply(history.value[pointer.value]!)
  }

  /** call once at app startup — undo/redo keys live in useEditorShortcuts */
  function init() {
    if (initialized) return
    initialized = true
    load()
    watch(
      project,
      () => {
        if (restoring || autosaveSuspended.value) return
        typing.value = true
        if (timer) clearTimeout(timer)
        timer = setTimeout(commit, DEBOUNCE_MS)
      },
      { deep: true },
    )
  }

  return { status, canUndo, canRedo, init, saveNow, undo, redo, resetTo }
}
