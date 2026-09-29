import type {
  ComponentDef,
  DesignToken,
  ElementNode,
  Interaction,
  InteractionBinding,
  Project,
} from '@/types/editor'
import { normalizeComponentName } from '../components'
import { setComponentMeta } from '../componentOps'
import { CATALOG_TOKENS } from './tokens'
import type { CatalogEntry, CatalogNode } from './types'

export interface MaterializedEntry {
  def: ComponentDef
  /** library effects the entry needs that the project doesn't have yet */
  interactions: Interaction[]
  /** design tokens its classes reference that the project doesn't have yet */
  tokens: DesignToken[]
}

const DEFAULT_DURATION = 'duration-200'
const DEFAULT_EASING = 'ease-out'

/**
 * Turns a bundled library entry into a real, independent `ComponentDef` for
 * this project — fresh ids throughout, symbolic targets resolved, and the
 * shared library entries it needs alongside it.
 *
 * Nothing links back to the catalog afterwards: `source` only records where it
 * came from, so the Library can show which entries are already added.
 */
export function materializeCatalogEntry(
  entry: CatalogEntry,
  project: Project,
): MaterializedEntry {
  const name = normalizeComponentName(
    entry.name,
    project.components.map((c) => c.name),
  )

  // --- interactions: reuse an identical one, else mint it ---
  // "Identical" means every field, name included. Entry names are
  // entry-specific on purpose ("Accordion · open"), so adding two different
  // components never makes them share one effect — editing it would then
  // restyle both.
  const newInteractions: Interaction[] = []
  const interactionIds = new Map<string, string>()
  for (const spec of entry.interactions ?? []) {
    const shape = {
      name: spec.name,
      toClasses: spec.toClasses,
      duration: spec.duration ?? DEFAULT_DURATION,
      easing: spec.easing ?? DEFAULT_EASING,
    }
    const existing = project.interactions.find(
      (i) =>
        i.name === shape.name &&
        i.toClasses === shape.toClasses &&
        i.duration === shape.duration &&
        i.easing === shape.easing,
    )
    if (existing) {
      interactionIds.set(spec.key, existing.id)
      continue
    }
    const made: Interaction = { id: crypto.randomUUID(), ...shape }
    newInteractions.push(made)
    interactionIds.set(spec.key, made.id)
  }

  // --- nodes: build first (so every key has an id), then wire the targets ---
  const keyToId = new Map<string, string>()
  const pending: { node: ElementNode; source: CatalogNode }[] = []

  const build = (source: CatalogNode): ElementNode => {
    const node: ElementNode = {
      id: crypto.randomUUID(),
      type: source.type,
      content: source.content ?? '',
      children: (source.children ?? []).map(build),
    }
    if (source.classes) node.classes = source.classes
    if (source.link) node.link = source.link
    if (source.attributes) node.attributes = { ...source.attributes }
    if (source.key) keyToId.set(source.key, node.id)
    if (source.interactions?.length) pending.push({ node, source })
    return node
  }

  const child = build(entry.root)

  for (const { node, source } of pending) {
    const bindings: InteractionBinding[] = []
    for (const b of source.interactions ?? []) {
      const interactionId = interactionIds.get(b.interaction)
      // a binding naming an interaction the entry never declared is an authoring
      // bug; dropping it beats shipping a binding that resolves to nothing
      if (!interactionId) continue
      const binding: InteractionBinding = {
        id: crypto.randomUUID(),
        interactionId,
        trigger: b.trigger,
        targetId: b.target ? (keyToId.get(b.target) ?? null) : null,
      }
      if (b.action) binding.action = b.action
      if (b.closeOn?.length) binding.closeOn = [...b.closeOn]
      if (b.group) binding.group = b.group
      if (b.once) binding.once = b.once
      bindings.push(binding)
    }
    if (bindings.length) node.interactions = bindings
  }

  // the root is the component-typed wrapper, exactly as createComponent builds
  // it: one child, no styling of its own, so it emits no element
  const root: ElementNode = { id: crypto.randomUUID(), type: name, content: '', children: [child] }
  const def: ComponentDef = { id: crypto.randomUUID(), name, root }
  setComponentMeta(def, { category: entry.category, source: entry.key })

  // --- tokens: only the missing ones, and never overwrite a user's value ---
  const have = new Set(project.settings.tokens.map((t) => t.name))
  const tokens: DesignToken[] = entry.tokens
    .filter((n) => !have.has(n) && CATALOG_TOKENS[n])
    .map((n) => ({ id: crypto.randomUUID(), name: n, value: CATALOG_TOKENS[n]! }))

  return { def, interactions: newInteractions, tokens }
}
