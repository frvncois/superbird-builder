import { PRIMITIVES } from './entries/primitives'
import { CONTENT } from './entries/content'
import { INTERACTIVE } from './entries/interactive'
import type { CatalogEntry } from './types'

export type { CatalogEntry, CatalogNode, CatalogBinding, CatalogInteraction } from './types'
export { CATALOG_TOKENS } from './tokens'
export { materializeCatalogEntry } from './materialize'
export type { MaterializedEntry } from './materialize'

/**
 * The bundled component library — ready-made pieces the user COPIES into a
 * project. Once added, a component is ordinary: nothing follows the catalog,
 * so editing or deleting it has no effect here and a library update never
 * reaches a project that already added the entry.
 *
 * Ships with the app rather than being fetched, so it works offline and is
 * versioned with the editor that renders it.
 */
export const CATALOG: CatalogEntry[] = [...PRIMITIVES, ...CONTENT, ...INTERACTIVE]

export function catalogEntry(key: string): CatalogEntry | null {
  return CATALOG.find((e) => e.key === key) ?? null
}

/** entries grouped for the drawer, in the order the categories are declared */
export function catalogCategories(): { name: string; items: CatalogEntry[] }[] {
  const groups: { name: string; items: CatalogEntry[] }[] = []
  for (const entry of CATALOG) {
    const group = groups.find((g) => g.name === entry.category)
    if (group) group.items.push(entry)
    else groups.push({ name: entry.category, items: [entry] })
  }
  return groups
}
