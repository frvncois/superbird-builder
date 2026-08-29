import type {
  Breakpoint,
  Collection,
  ComponentDef,
  Interaction,
  Page,
  Project,
  ProjectSettings,
} from '@/types/editor'
import { deepClone } from './tree'

export type Resolution = 'mine' | 'theirs'

export interface MergeConflict {
  /** 'page:<id>', 'component:<id>', 'collection:<id>', 'breakpoints', 'locales', or 'settings' */
  key: string
  label: string
  kind: 'changed' | 'deleted-in-branch' | 'deleted-in-main'
  /** the branch-side alternative: a page, component, collection, interaction, breakpoint set, locale pack, settings, or null (deletion) */
  theirs:
    | Page
    | ComponentDef
    | Collection
    | Interaction
    | Breakpoint[]
    | LocalePack
    | ProjectSettings
    | null
}

/** the project-level locale settings, merged as one unit like breakpoints */
export interface LocalePack {
  locales: string[]
  defaultLocale: string
}

export interface MergeResult {
  /** three-way merge with every conflict defaulting to Main's side */
  merged: Project
  conflicts: MergeConflict[]
}

const sig = (value: unknown) => JSON.stringify(value ?? null)

/**
 * Per-item three-way merge of one id-keyed list (pages, components, or
 * collections — they all follow the identical rule). Items changed only in the
 * branch merge in; changed on both sides conflict; a deletion on one side while
 * the other kept editing conflicts too. Every conflict defaults to Main's side;
 * the user resolves via applyResolutions.
 */
function mergeItemList<T extends { id: string }>(
  base: T[],
  mine: T[],
  theirs: T[],
  keyPrefix: string,
  labelFn: (item: T) => string,
): { merged: T[]; conflicts: MergeConflict[] } {
  const baseMap = new Map(base.map((x) => [x.id, x]))
  const mineMap = new Map(mine.map((x) => [x.id, x]))
  const theirMap = new Map(theirs.map((x) => [x.id, x]))
  const merged: T[] = []
  const conflicts: MergeConflict[] = []
  const conflict = (item: T, kind: MergeConflict['kind'], theirsSide: T | null) =>
    conflicts.push({
      key: `${keyPrefix}${item.id}`,
      label: labelFn(item),
      kind,
      theirs: theirsSide as MergeConflict['theirs'],
    })

  for (const mineItem of mine) {
    const baseItem = baseMap.get(mineItem.id)
    const theirItem = theirMap.get(mineItem.id)
    if (!baseItem) {
      // added on Main after branching
      merged.push(mineItem)
      continue
    }
    const mineChanged = sig(mineItem) !== sig(baseItem)
    if (theirItem) {
      const theirsChanged = sig(theirItem) !== sig(baseItem)
      if (theirsChanged && !mineChanged) {
        merged.push(theirItem)
      } else if (theirsChanged && mineChanged && sig(mineItem) !== sig(theirItem)) {
        merged.push(mineItem)
        conflict(mineItem, 'changed', theirItem)
      } else {
        merged.push(mineItem)
      }
    } else if (!mineChanged) {
      // deleted in the branch, untouched on Main → accept the deletion
    } else {
      merged.push(mineItem)
      conflict(mineItem, 'deleted-in-branch', null)
    }
  }

  for (const theirItem of theirs) {
    if (mineMap.has(theirItem.id)) continue
    const baseItem = baseMap.get(theirItem.id)
    if (!baseItem) {
      // added in the branch
      merged.push(theirItem)
    } else if (sig(theirItem) !== sig(baseItem)) {
      // Main deleted it but the branch kept editing it
      conflict(theirItem, 'deleted-in-main', theirItem)
    }
  }

  return { merged, conflicts }
}

/** applies one resolved conflict to its id-keyed list: replace, add, or delete */
function applyToList<T extends { id: string }>(list: T[], id: string, theirs: T | null) {
  const at = list.findIndex((x) => x.id === id)
  if (theirs === null) {
    if (at !== -1) list.splice(at, 1)
  } else if (at !== -1) {
    list[at] = theirs
  } else {
    list.push(theirs)
  }
}

/**
 * Three-way merge of a branch back into Main, per page (and the shared
 * breakpoint set as one unit). Pages changed only in the branch merge
 * in; changed on both sides they conflict and the user picks a side.
 * Comments are shared across branches and never merged.
 */
export function computeMerge(base: Project, mine: Project, theirs: Project): MergeResult {
  // pages, components, and collections all follow the same per-item three-way
  // rule — one shared helper keeps them from drifting apart
  const pages = mergeItemList(base.pages, mine.pages, theirs.pages, 'page:', (p) => p.name)
  const components = mergeItemList(
    base.components,
    mine.components,
    theirs.components,
    'component:',
    (c) => `Component ${c.name}`,
  )
  const collections = mergeItemList(
    base.collections,
    mine.collections,
    theirs.collections,
    'collection:',
    (c) => `Collection ${c.name}`,
  )
  const interactions = mergeItemList(
    base.interactions ?? [],
    mine.interactions ?? [],
    theirs.interactions ?? [],
    'interaction:',
    (i) => `Interaction ${i.name}`,
  )
  const conflicts: MergeConflict[] = [
    ...pages.conflicts,
    ...components.conflicts,
    ...collections.conflicts,
    ...interactions.conflicts,
  ]

  let mergedBreakpoints = mine.breakpoints
  const bpMineChanged = sig(mine.breakpoints) !== sig(base.breakpoints)
  const bpTheirsChanged = sig(theirs.breakpoints) !== sig(base.breakpoints)
  if (bpTheirsChanged && !bpMineChanged) {
    mergedBreakpoints = theirs.breakpoints
  } else if (bpTheirsChanged && bpMineChanged && sig(mine.breakpoints) !== sig(theirs.breakpoints)) {
    conflicts.push({
      key: 'breakpoints',
      label: 'Breakpoints',
      kind: 'changed',
      theirs: theirs.breakpoints,
    })
  }

  const localePack = (p: Project): LocalePack => ({
    locales: p.locales,
    defaultLocale: p.defaultLocale,
  })
  let mergedLocales = localePack(mine)
  const locMineChanged = sig(localePack(mine)) !== sig(localePack(base))
  const locTheirsChanged = sig(localePack(theirs)) !== sig(localePack(base))
  if (locTheirsChanged && !locMineChanged) {
    mergedLocales = localePack(theirs)
  } else if (
    locTheirsChanged &&
    locMineChanged &&
    sig(localePack(mine)) !== sig(localePack(theirs))
  ) {
    conflicts.push({
      key: 'locales',
      label: 'Locales',
      kind: 'changed',
      theirs: localePack(theirs),
    })
  }

  let mergedSettings = mine.settings
  const setMineChanged = sig(mine.settings) !== sig(base.settings)
  const setTheirsChanged = sig(theirs.settings) !== sig(base.settings)
  if (setTheirsChanged && !setMineChanged) {
    mergedSettings = theirs.settings
  } else if (setTheirsChanged && setMineChanged && sig(mine.settings) !== sig(theirs.settings)) {
    conflicts.push({
      key: 'settings',
      label: 'Project settings',
      kind: 'changed',
      theirs: theirs.settings,
    })
  }

  const merged: Project = {
    ...mine,
    pages: pages.merged,
    components: components.merged,
    collections: collections.merged,
    interactions: interactions.merged,
    breakpoints: mergedBreakpoints,
    comments: mine.comments,
    locales: mergedLocales.locales,
    defaultLocale: mergedLocales.defaultLocale,
    settings: mergedSettings,
  }
  return { merged, conflicts }
}

/** applies the user's per-conflict picks onto the merged project */
export function applyResolutions(
  result: MergeResult,
  choices: Record<string, Resolution>,
): Project {
  const merged = deepClone(result.merged) as Project
  for (const conflict of result.conflicts) {
    if (choices[conflict.key] !== 'theirs') continue
    if (conflict.key === 'breakpoints') {
      merged.breakpoints = conflict.theirs as Breakpoint[]
      continue
    }
    if (conflict.key === 'locales') {
      const pack = conflict.theirs as LocalePack
      merged.locales = pack.locales
      merged.defaultLocale = pack.defaultLocale
      continue
    }
    if (conflict.key === 'settings') {
      merged.settings = conflict.theirs as ProjectSettings
      continue
    }
    // pages / components / collections all resolve the same way: replace the
    // item, add it back (branch kept an item Main deleted), or drop it
    if (conflict.key.startsWith('component:')) {
      applyToList(
        merged.components,
        conflict.key.slice('component:'.length),
        conflict.theirs as ComponentDef | null,
      )
      continue
    }
    if (conflict.key.startsWith('collection:')) {
      applyToList(
        merged.collections,
        conflict.key.slice('collection:'.length),
        conflict.theirs as Collection | null,
      )
      continue
    }
    if (conflict.key.startsWith('interaction:')) {
      applyToList(
        merged.interactions,
        conflict.key.slice('interaction:'.length),
        conflict.theirs as Interaction | null,
      )
      continue
    }
    applyToList(merged.pages, conflict.key.slice('page:'.length), conflict.theirs as Page | null)
  }
  return merged
}

// ---------- change summary (draft vs its base snapshot) ----------

export interface ChangeSummary {
  pages: number
  components: number
  collections: number
  interactions: number
  breakpoints: boolean
  locales: boolean
  settings: boolean
}

/** added + changed + deleted count for one id-keyed list vs its base */
function countListChanges<T extends { id: string }>(base: T[], current: T[]): number {
  const baseMap = new Map(base.map((x) => [x.id, x]))
  let changes = 0
  for (const item of current) {
    const baseItem = baseMap.get(item.id)
    if (!baseItem || sig(item) !== sig(baseItem)) changes++
    baseMap.delete(item.id)
  }
  return changes + baseMap.size // leftovers in baseMap were deleted
}

/** what a draft touched since it branched — per-list change counts + unit flags */
export function summarizeChanges(base: Project, current: Project): ChangeSummary {
  const pack = (p: Project): LocalePack => ({ locales: p.locales, defaultLocale: p.defaultLocale })
  return {
    pages: countListChanges(base.pages, current.pages),
    components: countListChanges(base.components, current.components),
    collections: countListChanges(base.collections, current.collections),
    interactions: countListChanges(base.interactions ?? [], current.interactions ?? []),
    breakpoints: sig(current.breakpoints) !== sig(base.breakpoints),
    locales: sig(pack(current)) !== sig(pack(base)),
    settings: sig(current.settings) !== sig(base.settings),
  }
}

export function hasChanges(s: ChangeSummary): boolean {
  return (
    s.pages + s.components + s.collections + s.interactions > 0 ||
    s.breakpoints ||
    s.locales ||
    s.settings
  )
}

/** "3 pages · 1 component · settings" — empty string when nothing changed */
export function changeSummaryLabel(s: ChangeSummary): string {
  const count = (n: number, word: string) => (n ? `${n} ${word}${n > 1 ? 's' : ''}` : null)
  return [
    count(s.pages, 'page'),
    count(s.components, 'component'),
    count(s.collections, 'collection'),
    count(s.interactions, 'interaction'),
    s.breakpoints ? 'breakpoints' : null,
    s.locales ? 'locales' : null,
    s.settings ? 'settings' : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
