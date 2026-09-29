import type {
  ComponentDef,
  DesignToken,
  ElementNode,
  Interaction,
  InteractionBinding,
  Project,
} from '@/types/editor'
import { createMirror, normalizeComponentName } from '../components'
import { setComponentMeta } from '../componentOps'
import { setInstancePick } from '../variantOps'
import { lucideSvg } from '../shared/svg.js'
import { CATALOG_TOKENS } from './tokens'
import { CATALOG_ICONS } from './icons'
import type { CatalogEntry, CatalogNode } from './types'

/** what materializing needs to know about the REST of the library */
export interface MaterializeContext {
  /** the component an entry's instance resolves to: the one already in the
   *  project, a preview of it, or one added on the spot — the caller decides */
  component: (key: string) => ComponentDef | null
  /** the entry behind a key, for addressing a component's parts by their key */
  entry: (key: string) => CatalogEntry | null
}

const iconMarkup = (name: string) =>
  CATALOG_ICONS[name] ? lucideSvg(name, CATALOG_ICONS[name]) : ''

/** where each keyed node of an entry sits, as child indexes from its root */
function keyPaths(entry: CatalogEntry): Map<string, number[]> {
  const paths = new Map<string, number[]>()
  const visit = (node: CatalogNode, path: number[]) => {
    if (node.key) paths.set(node.key, path)
    // an instance's subtree is another entry's: its keys are not this one's
    if (!node.component) (node.children ?? []).forEach((child, i) => visit(child, [...path, i]))
  }
  visit(entry.root, [])
  return paths
}

export interface MaterializedEntry {
  def: ComponentDef
  /** library effects the entry needs that the project doesn't have yet */
  interactions: Interaction[]
  /** design tokens its classes reference that the project doesn't have yet */
  tokens: DesignToken[]
  /** the entries it holds an instance of: entry key → the name of the
   *  component each resolved to */
  dependencies?: Record<string, string>
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
export function materialize(
  entry: CatalogEntry,
  project: Project,
  context: MaterializeContext,
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
  const dependencies: Record<string, string> = {}
  const pending: { node: ElementNode; source: CatalogNode }[] = []

  /** an instance of another entry: a mirror of that component, carrying what
   *  this entry says about it */
  const instance = (source: CatalogNode): ElementNode => {
    const inner = context.component(source.component!)
    if (!inner) {
      throw new Error(`"${entry.key}" holds "${source.component}", which could not be resolved`)
    }
    dependencies[source.component!] = inner.name
    const node = createMirror(inner.root)
    for (const [axis, option] of Object.entries(source.variants ?? {})) {
      setInstancePick(inner, node, axis, option)
    }
    if (source.hidden) node.hidden = true
    const held = context.entry(source.component!)
    const paths = held ? keyPaths(held) : new Map<string, number[]>()
    for (const [key, part] of Object.entries(source.parts ?? {})) {
      // the mirror's first child is the entry's root; a component the user has
      // since reshaped may no longer have the part where the library put it
      const path = paths.get(key)
      if (!path) continue
      let at: ElementNode | undefined = node.children[0]
      for (const i of path) at = at?.children[i]
      if (!at) continue
      if (part.content !== undefined) at.content = part.content
      if (part.hidden !== undefined) at.hidden = part.hidden
      if (part.icon && at.type === 'icon') {
        const svg = iconMarkup(part.icon)
        if (svg) at.svg = svg
      }
    }
    if (source.key) keyToId.set(source.key, node.id)
    return node
  }

  const build = (source: CatalogNode): ElementNode => {
    if (source.component) return instance(source)
    const node: ElementNode = {
      id: crypto.randomUUID(),
      type: source.type,
      content: source.content ?? '',
      children: (source.children ?? []).map(build),
    }
    if (source.classes) node.classes = source.classes
    if (source.link) node.link = source.link
    if (source.attributes) node.attributes = { ...source.attributes }
    if (source.src) node.src = source.src
    if (source.hidden) node.hidden = true
    if (source.icon) {
      const svg = iconMarkup(source.icon)
      if (svg) node.svg = svg
    }
    if (source.slider) node.slider = JSON.parse(JSON.stringify(source.slider))
    if (source.variantClasses && Object.keys(source.variantClasses).length) {
      // in axis order, then option order: the canonical key order
      const kept: Record<string, string> = {}
      for (const axis of entry.variants ?? []) {
        for (const option of axis.options) {
          const classes = source.variantClasses[`${axis.name}:${option}`]
          if (classes) kept[`${axis.name}:${option}`] = classes
        }
      }
      if (Object.keys(kept).length) node.variantClasses = kept
    }
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
  setComponentMeta(def, { category: entry.category, source: entry.key, variants: entry.variants })

  // --- tokens: only the missing ones, and never overwrite a user's value ---
  const have = new Set(project.settings.tokens.map((t) => t.name))
  const tokens: DesignToken[] = entry.tokens
    .filter((n) => !have.has(n) && CATALOG_TOKENS[n])
    .map((n) => ({ id: crypto.randomUUID(), name: n, value: CATALOG_TOKENS[n]! }))

  return {
    def,
    interactions: newInteractions,
    tokens,
    ...(Object.keys(dependencies).length ? { dependencies } : {}),
  }
}
