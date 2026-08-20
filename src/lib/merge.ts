import type {
  Breakpoint,
  Collection,
  ComponentDef,
  Page,
  Project,
  ProjectSettings,
} from '@/types/editor'

export type Resolution = 'mine' | 'theirs'

export interface MergeConflict {
  /** 'page:<id>', 'component:<id>', 'collection:<id>', 'breakpoints', 'locales', or 'settings' */
  key: string
  label: string
  kind: 'changed' | 'deleted-in-branch' | 'deleted-in-main'
  /** the branch-side alternative: a page, component, collection, breakpoint set, locale pack, settings, or null (deletion) */
  theirs: Page | ComponentDef | Collection | Breakpoint[] | LocalePack | ProjectSettings | null
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
 * Three-way merge of a branch back into Main, per page (and the shared
 * breakpoint set as one unit). Pages changed only in the branch merge
 * in; changed on both sides they conflict and the user picks a side.
 * Comments are shared across branches and never merged.
 */
export function computeMerge(base: Project, mine: Project, theirs: Project): MergeResult {
  const conflicts: MergeConflict[] = []
  const basePages = new Map(base.pages.map((p) => [p.id, p]))
  const minePages = new Map(mine.pages.map((p) => [p.id, p]))
  const theirPages = new Map(theirs.pages.map((p) => [p.id, p]))

  const mergedPages: Page[] = []

  for (const minePage of mine.pages) {
    const basePage = basePages.get(minePage.id)
    const theirPage = theirPages.get(minePage.id)
    if (!basePage) {
      // added on Main after branching
      mergedPages.push(minePage)
      continue
    }
    const mineChanged = sig(minePage) !== sig(basePage)
    if (theirPage) {
      const theirsChanged = sig(theirPage) !== sig(basePage)
      if (theirsChanged && !mineChanged) {
        mergedPages.push(theirPage)
      } else if (theirsChanged && mineChanged && sig(minePage) !== sig(theirPage)) {
        mergedPages.push(minePage)
        conflicts.push({
          key: `page:${minePage.id}`,
          label: minePage.name,
          kind: 'changed',
          theirs: theirPage,
        })
      } else {
        mergedPages.push(minePage)
      }
    } else if (!mineChanged) {
      // deleted in the branch, untouched on Main → accept the deletion
    } else {
      mergedPages.push(minePage)
      conflicts.push({
        key: `page:${minePage.id}`,
        label: minePage.name,
        kind: 'deleted-in-branch',
        theirs: null,
      })
    }
  }

  for (const theirPage of theirs.pages) {
    if (minePages.has(theirPage.id)) continue
    const basePage = basePages.get(theirPage.id)
    if (!basePage) {
      // added in the branch
      mergedPages.push(theirPage)
    } else if (sig(theirPage) !== sig(basePage)) {
      // Main deleted it but the branch kept editing it
      conflicts.push({
        key: `page:${theirPage.id}`,
        label: theirPage.name,
        kind: 'deleted-in-main',
        theirs: theirPage,
      })
    }
  }

  // components merge with the same per-item three-way rule as pages
  const baseComponents = new Map(base.components.map((c) => [c.id, c]))
  const theirComponents = new Map(theirs.components.map((c) => [c.id, c]))
  const mergedComponents: ComponentDef[] = []
  for (const mineComp of mine.components) {
    const baseComp = baseComponents.get(mineComp.id)
    const theirComp = theirComponents.get(mineComp.id)
    if (!baseComp || !theirComp) {
      mergedComponents.push(mineComp)
      continue
    }
    const mineChanged = sig(mineComp) !== sig(baseComp)
    const theirsChanged = sig(theirComp) !== sig(baseComp)
    if (theirsChanged && !mineChanged) {
      mergedComponents.push(theirComp)
    } else if (theirsChanged && mineChanged && sig(mineComp) !== sig(theirComp)) {
      mergedComponents.push(mineComp)
      conflicts.push({
        key: `component:${mineComp.id}`,
        label: `Component ${mineComp.name}`,
        kind: 'changed',
        theirs: theirComp,
      })
    } else {
      mergedComponents.push(mineComp)
    }
  }
  for (const theirComp of theirs.components) {
    if (!mine.components.some((c) => c.id === theirComp.id) && !baseComponents.has(theirComp.id)) {
      mergedComponents.push(theirComp) // added in the branch
    }
  }

  // collections merge with the same per-item three-way rule
  const baseCollections = new Map(base.collections.map((c) => [c.id, c]))
  const theirCollections = new Map(theirs.collections.map((c) => [c.id, c]))
  const mergedCollections: Collection[] = []
  for (const mineCol of mine.collections) {
    const baseCol = baseCollections.get(mineCol.id)
    const theirCol = theirCollections.get(mineCol.id)
    if (!baseCol || !theirCol) {
      mergedCollections.push(mineCol)
      continue
    }
    const mineChanged = sig(mineCol) !== sig(baseCol)
    const theirsChanged = sig(theirCol) !== sig(baseCol)
    if (theirsChanged && !mineChanged) {
      mergedCollections.push(theirCol)
    } else if (theirsChanged && mineChanged && sig(mineCol) !== sig(theirCol)) {
      mergedCollections.push(mineCol)
      conflicts.push({
        key: `collection:${mineCol.id}`,
        label: `Collection ${mineCol.name}`,
        kind: 'changed',
        theirs: theirCol,
      })
    } else {
      mergedCollections.push(mineCol)
    }
  }
  for (const theirCol of theirs.collections) {
    if (!mine.collections.some((c) => c.id === theirCol.id) && !baseCollections.has(theirCol.id)) {
      mergedCollections.push(theirCol)
    }
  }

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
    pages: mergedPages,
    components: mergedComponents,
    collections: mergedCollections,
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
  const merged = JSON.parse(JSON.stringify(result.merged)) as Project
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
    if (conflict.key.startsWith('component:')) {
      const componentId = conflict.key.slice('component:'.length)
      const at = merged.components.findIndex((c) => c.id === componentId)
      if (at !== -1) merged.components[at] = conflict.theirs as ComponentDef
      continue
    }
    if (conflict.key.startsWith('collection:')) {
      const collectionId = conflict.key.slice('collection:'.length)
      const at = merged.collections.findIndex((c) => c.id === collectionId)
      if (at !== -1) merged.collections[at] = conflict.theirs as Collection
      continue
    }
    const pageId = conflict.key.slice('page:'.length)
    const at = merged.pages.findIndex((p) => p.id === pageId)
    if (conflict.theirs === null) {
      // branch deleted the page
      if (at !== -1) merged.pages.splice(at, 1)
    } else if (at !== -1) {
      merged.pages[at] = conflict.theirs as Page
    } else {
      merged.pages.push(conflict.theirs as Page)
    }
  }
  return merged
}
