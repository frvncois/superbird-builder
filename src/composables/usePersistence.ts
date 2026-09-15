import { computed, ref, watch } from 'vue'
import { useProject } from './useProject'
import { migrateStoredProject, readStoredProject } from '@/lib/storage'
import { pendingWrites, storeError, storeGet, storeGetFresh, storeSet } from '@/lib/store'
import { computeMerge } from '@/lib/merge'
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

/**
 * The project as this tab last knew the SERVER to hold — the common ancestor
 * for merge-on-save. The store is latest-wins on one whole-project blob, so
 * without this an open tab's autosave silently reverts anything another
 * writer (an MCP agent, another session) changed in the meantime: a deleted
 * animation would come back from the dead. With it, a save that finds the
 * stored blob changed merges per entity instead of overwriting.
 * null = no baseline yet (fresh boot / corrupt read) → plain write.
 */
let baseline: string | null = null

export function usePersistence() {
  const { project, projectVersion } = useProject()

  const canUndo = computed(() => pointer.value > 0)
  const canRedo = computed(() => pointer.value < history.value.length - 1)

  /** the single storage write — server-backed via the store adapter.
   * Deliberate wholesale writes (load/reset/undo) use this directly and take
   * ownership of the baseline; edits go through persistMerged instead. */
  function persist(snapshot: string) {
    storeSet(projectStorageKey(activeBranchId.value), snapshot)
    baseline = snapshot
    typing.value = false
  }

  /**
   * Writes an edit, merging first if the stored project moved under us.
   *
   * Three cases:
   *  - nothing changed server-side (the overwhelmingly common one) → plain write
   *  - we have no baseline, or an agent owns the project (live sync replaces
   *    wholesale), or the read fails → plain write, same as before
   *  - the blob changed → 3-way merge against the baseline. Our edits win any
   *    genuine conflict (the human is here and typing); entities only THEY
   *    touched — including deletions — survive.
   */
  async function persistMerged(snapshot: string) {
    const key = projectStorageKey(activeBranchId.value)
    if (baseline === null || autosaveSuspended.value) {
      persist(snapshot)
      return
    }
    let storedRaw: string | null
    try {
      storedRaw = await storeGetFresh(key)
    } catch {
      persist(snapshot) // offline / server hiccup — behave as before
      return
    }
    if (storedRaw === null || storedRaw === baseline) {
      persist(snapshot)
      return
    }
    let merged: Project
    try {
      const theirs = migrateStoredProject(JSON.parse(storedRaw) as Project)
      if (!theirs) {
        persist(snapshot)
        return
      }
      const { merged: result } = computeMerge(
        JSON.parse(baseline) as Project,
        JSON.parse(snapshot) as Project,
        theirs,
      )
      merged = result
    } catch {
      persist(snapshot) // unparseable remote — our state is the better bet
      return
    }
    const mergedSnapshot = JSON.stringify(merged)
    persist(mergedSnapshot)
    if (mergedSnapshot === snapshot) return
    // adopt what we actually stored, so the editor shows the merged truth.
    // History gains an entry (rather than being wiped) so undo still works.
    restoring = true
    project.value = merged
    restoring = false
    const next = history.value.slice(0, pointer.value + 1)
    next.push(mergedSnapshot)
    if (next.length > HISTORY_LIMIT) next.shift()
    history.value = next
    pointer.value = next.length - 1
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
        baseline = JSON.stringify(stored)
      } else {
        // fresh instance: persist the default project immediately, instead of
        // only on the first edit — otherwise the server has no project blob
        // and every out-of-band reader (the MCP agent surface) fails on Main
        persist(JSON.stringify(project.value))
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

  /**
   * Like resetTo but WITHOUT the write-back — for applying a state that is
   * already on the server (live agent sync). Persisting here would race a
   * concurrent agent write: our echo of the fetched blob could land after a
   * newer agent save and revert it (the store is latest-wins).
   */
  function replaceFromRemote(next: Project) {
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
    // this state came FROM the server, so it is the new common ancestor
    baseline = snapshot
    typing.value = false
  }

  /** snapshot the settled state into history and storage */
  function commit() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    const snapshot = JSON.stringify(project.value)
    if (snapshot === history.value[pointer.value]) {
      void persistMerged(snapshot)
      return
    }
    const next = history.value.slice(0, pointer.value + 1)
    next.push(snapshot)
    if (next.length > HISTORY_LIMIT) next.shift()
    history.value = next
    pointer.value = next.length - 1
    void persistMerged(snapshot)
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
    // projectVersion is useProject's single shared deep watcher — watching it
    // avoids a second whole-document traversal on every keystroke
    watch(projectVersion, () => {
      if (restoring || autosaveSuspended.value) return
      typing.value = true
      if (timer) clearTimeout(timer)
      timer = setTimeout(commit, DEBOUNCE_MS)
    })
  }

  return { status, canUndo, canRedo, init, saveNow, undo, redo, resetTo, replaceFromRemote }
}
