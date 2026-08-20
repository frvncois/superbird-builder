import { computed, ref } from 'vue'
import { useProject } from './useProject'
import { usePersistence, activeBranchId, projectStorageKey } from './usePersistence'
import { computeMerge, applyResolutions } from '@/lib/merge'
import { readStoredProject } from '@/lib/storage'
import { hydrateStore, storeGet, storeRemove, storeSet } from '@/lib/store'
import type { MergeResult, Resolution } from '@/lib/merge'
import type { Project } from '@/types/editor'

export interface BranchMeta {
  id: string
  name: string
  createdAt: number
}

const META_KEY = 'superbird-branches'
export const MAIN_ID = 'main'

const branches = ref<BranchMeta[]>([{ id: MAIN_ID, name: 'Main', createdAt: 0 }])
let metaLoaded = false

function baseStorageKey(branchId: string) {
  return `superbird-base:${branchId}`
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

  /** snapshot the current project as a new branch and switch to it */
  function createBranch(name: string) {
    saveNow()
    const id = crypto.randomUUID()
    const snapshot = JSON.stringify(project.value)
    storeSet(projectStorageKey(id), snapshot)
    storeSet(baseStorageKey(id), snapshot) // three-way merge base
    branches.value = [...branches.value, { id, name: name.trim() || 'Branch', createdAt: Date.now() }]
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

  /** merge the branch into Main with the given conflict picks, then close it */
  async function mergeIntoMain(id: string, choices: Record<string, Resolution>): Promise<boolean> {
    const result = await previewMerge(id)
    if (!result) return false
    const merged = applyResolutions(result, choices)
    merged.comments = project.value.comments
    activeBranchId.value = MAIN_ID
    resetTo(merged)
    await deleteBranch(id)
    saveMeta()
    return true
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
  }
}
