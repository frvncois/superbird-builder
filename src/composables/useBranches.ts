import { computed, ref } from 'vue'
import { useProject } from './useProject'
import { usePersistence, activeBranchId, projectStorageKey } from './usePersistence'
import { computeMerge, applyResolutions, summarizeChanges } from '@/lib/merge'
import { readStoredProject } from '@/lib/storage'
import { hydrateStore, storeGet, storeRemove, storeSet } from '@/lib/store'
import type { ChangeSummary, MergeResult, Resolution } from '@/lib/merge'
import type { Project } from '@/types/editor'

export interface BranchMeta {
  id: string
  name: string
  /** optional one-line purpose, set at creation ("Summer campaign") */
  description?: string
  createdAt: number
}

/** what a draft row displays: what it changed, and whether applying will conflict */
export interface DraftStatus {
  summary: ChangeSummary
  conflictCount: number
}

const META_KEY = 'guano-branches'
export const MAIN_ID = 'main'

const branches = ref<BranchMeta[]>([{ id: MAIN_ID, name: 'Main', createdAt: 0 }])
let metaLoaded = false

/** per-draft status cache; entries invalidate on switch/apply/edit-elsewhere */
const statusCache = ref(new Map<string, DraftStatus>())

function baseStorageKey(branchId: string) {
  return `guano-base:${branchId}`
}

export function useBranches() {
  const { project } = useProject()
  const { saveNow, resetTo } = usePersistence()

  if (!metaLoaded) {
    metaLoaded = true
    try {
      const raw = storeGet(META_KEY)
      if (raw) {
        const meta = JSON.parse(raw) as { branches: BranchMeta[] }
        if (Array.isArray(meta.branches) && meta.branches.some((b) => b.id === MAIN_ID)) {
          branches.value = meta.branches
        }
      }
    } catch {
      // corrupt meta — fall back to Main only
    }
  }

  const activeBranch = computed(
    () => branches.value.find((b) => b.id === activeBranchId.value) ?? branches.value[0]!,
  )
  const onMain = computed(() => activeBranchId.value === MAIN_ID)

  function saveMeta() {
    storeSet(
      META_KEY,
      JSON.stringify({ activeId: activeBranchId.value, branches: branches.value }),
    )
  }

  const readProject = readStoredProject

  /** snapshot the current project as a new draft (branch) and switch to it */
  function createBranch(name: string, description?: string) {
    saveNow()
    const id = crypto.randomUUID()
    const snapshot = JSON.stringify(project.value)
    storeSet(projectStorageKey(id), snapshot)
    storeSet(baseStorageKey(id), snapshot) // three-way merge base
    branches.value = [
      ...branches.value,
      {
        id,
        name: name.trim() || 'Draft',
        description: description?.trim() || undefined,
        createdAt: Date.now(),
      },
    ]
    activeBranchId.value = id
    resetTo(JSON.parse(snapshot) as Project) // fresh undo history on the branch
    saveMeta()
  }

  async function switchBranch(id: string) {
    if (id === activeBranchId.value) return
    saveNow() // current branch's work lands under its own key first
    await hydrateStore([projectStorageKey(id)])
    const target = readProject(projectStorageKey(id))
    if (!target) return
    target.comments = project.value.comments // comments are shared across branches
    activeBranchId.value = id
    resetTo(target)
    saveMeta()
  }

  async function deleteBranch(id: string) {
    if (id === MAIN_ID) return
    if (activeBranchId.value === id) await switchBranch(MAIN_ID)
    storeRemove(projectStorageKey(id))
    storeRemove(baseStorageKey(id))
    branches.value = branches.value.filter((b) => b.id !== id)
    saveMeta()
  }

  /** dry-run the three-way merge so the UI can offer conflict choices */
  async function previewMerge(id: string): Promise<MergeResult | null> {
    saveNow()
    await hydrateStore([baseStorageKey(id), projectStorageKey(id), projectStorageKey(MAIN_ID)])
    const base = readProject(baseStorageKey(id))
    const theirs = readProject(projectStorageKey(id))
    const mine = onMain.value ? project.value : readProject(projectStorageKey(MAIN_ID))
    if (!base || !theirs || !mine) return null
    return computeMerge(base, mine, theirs)
  }

  /**
   * Applies the draft to Main with the given conflict picks. By default the
   * draft is deleted afterwards; with `keep` it survives, and its merge base
   * is rebased onto the merged Main so future diffs show only new divergence.
   */
  async function mergeIntoMain(
    id: string,
    choices: Record<string, Resolution>,
    opts: { keep?: boolean } = {},
  ): Promise<boolean> {
    const result = await previewMerge(id)
    if (!result) return false
    const merged = applyResolutions(result, choices)
    merged.comments = project.value.comments
    activeBranchId.value = MAIN_ID
    resetTo(merged)
    if (opts.keep) {
      const snapshot = JSON.stringify(merged)
      storeSet(baseStorageKey(id), snapshot)
      // the kept draft adopts the merged state too — it applied cleanly, so
      // it starts over from the new Main instead of re-proposing old edits
      storeSet(projectStorageKey(id), snapshot)
      statusCache.value.delete(id)
    } else {
      await deleteBranch(id)
    }
    saveMeta()
    return true
  }

  /** what the draft changed vs its base + how many conflicts applying would hit */
  async function draftStatus(id: string, opts: { fresh?: boolean } = {}): Promise<DraftStatus | null> {
    if (id === MAIN_ID) return null
    if (!opts.fresh && statusCache.value.has(id)) return statusCache.value.get(id)!
    // the active draft's latest edits live in memory — commit them first so
    // the stored project reflects what the user sees
    if (activeBranchId.value === id) saveNow()
    await hydrateStore([baseStorageKey(id), projectStorageKey(id), projectStorageKey(MAIN_ID)])
    const base = readProject(baseStorageKey(id))
    const branch = activeBranchId.value === id ? project.value : readProject(projectStorageKey(id))
    const main = onMain.value ? project.value : readProject(projectStorageKey(MAIN_ID))
    if (!base || !branch) return null
    const status: DraftStatus = {
      summary: summarizeChanges(base, branch),
      conflictCount: main ? computeMerge(base, main, branch).conflicts.length : 0,
    }
    statusCache.value.set(id, status)
    return status
  }

  function invalidateDraftStatus(id?: string) {
    if (id) statusCache.value.delete(id)
    else statusCache.value.clear()
  }

  return {
    branches,
    activeBranch,
    activeBranchId,
    onMain,
    createBranch,
    switchBranch,
    deleteBranch,
    previewMerge,
    mergeIntoMain,
    draftStatus,
    invalidateDraftStatus,
  }
}
