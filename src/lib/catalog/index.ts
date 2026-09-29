import { PRIMITIVES } from './entries/primitives'
import { FORMS } from './entries/forms'
import { CONTENT } from './entries/content'
import { INTERACTIVE } from './entries/interactive'
import { materialize, type MaterializedEntry } from './materialize'
import type { CatalogEntry, CatalogNode } from './types'
import type { ComponentDef, Project } from '@/types/editor'

export type { CatalogEntry, CatalogNode, CatalogBinding, CatalogInteraction, CatalogPart } from './types'
export { CATALOG_TOKENS } from './tokens'
export { CATALOG_ICONS } from './icons'
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
export const CATALOG: CatalogEntry[] = [...PRIMITIVES, ...FORMS, ...CONTENT, ...INTERACTIVE]

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

/** the entries an entry holds an instance of, directly — by key, each once */
export function catalogDependencies(entry: CatalogEntry): string[] {
  const keys = new Set<string>()
  const visit = (node: CatalogNode) => {
    if (node.component) keys.add(node.component)
    else (node.children ?? []).forEach(visit)
  }
  visit(entry.root)
  return [...keys]
}

/**
 * Turn a library entry into a component for this project.
 *
 * An entry may hold instances of other entries (a Card holds a Button).
 * `component` says what each of those resolves to; by default, the component
 * the project already made from that entry. A caller that can ADD the missing
 * one — or stand a preview in for it — passes its own.
 */
export function materializeCatalogEntry(
  entry: CatalogEntry,
  project: Project,
  component: (key: string) => ComponentDef | null = (key) =>
    project.components.find((c) => c.source === key) ?? null,
): MaterializedEntry {
  return materialize(entry, project, { component, entry: catalogEntry })
}
