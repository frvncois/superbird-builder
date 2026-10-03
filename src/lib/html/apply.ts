import type { ComponentDef, ElementNode, Project } from '@/types/editor'
import { alignStructure, isComponentType } from '../components'
import { createNode, isLeafElement } from '../elements'
import { findNode, walkNodes } from '../tree'
import { buildInstanceMap, canNest, isInstanceWrapper, type InstanceMapping } from '../instances'
import { isValidClass } from '../styles'
import { isAllowedAttribute, sanitizeAttributes } from '../shared/attributes.js'
import { isRich, sanitizeRich } from '../shared/richtext.js'
import { SAFE_SRC } from '../shared/urls.js'
import { validateTree, type TreeDiagnostic, type ValidateContext } from '../validateTree'
import { clearBindingsToIds, pageHost, masterHost, type StructureHost } from '../treeOps'
import { decodeEntities, type ParsedNode } from './parse'
import { nodesByShortId } from './ids'
import { ELIDED_DATA_URL } from './serialize'
import { impliedAttrs, isLeafType, sameType, SOURCE_TYPES } from './tags'

/**
 * Writing HTML back onto the tree.
 *
 * This is the one place node identity is still MATCHED rather than simply
 * kept, and it is the reason `reconcile` existed: an agent hands back a
 * document, and every node it did not mean to replace has to survive with its
 * id, its interactions, its translations and its comment anchors. The order is
 * `data-id`, then `data-ref`, then a tree LCS — mostly keyed by ids the agent
 * echoed back, which makes it far simpler than the text heuristics it
 * replaces, and it runs only for agents, never on a drag.
 *
 * Everything the HTML does not carry (interactions, animations, `locales`,
 * slider config, form config, `listQuery`, `entryId`, `instanceAttributes`) is
 * preserved on
 * every adopted node, because the node OBJECT itself is reused.
 *
 * A refusal is never silent. Reporting success for a write that renders
 * nowhere is the bug class this format exists to remove, so anything that
 * cannot land — a class inside a component instance, an invalid class token,
 * an unusable `src`, structure where a part was expected — comes back named.
 */

export interface Refusal {
  /** a readable path to the element: `section > Card#promo > span` */
  path: string
  message: string
}

export interface ApplyResult {
  kept: number
  created: number
  removed: number
  /** what did NOT land, and why */
  refused: Refusal[]
  /** what landed but is worth saying out loud */
  warnings: Refusal[]
  diagnostics: TreeDiagnostic[]
}

export interface ApplyOptions {
  project: Project
  /** the component, when the root being written is a master */
  def?: ComponentDef | null
  /** validation context; omitted = derived from the project */
  validate?: ValidateContext
}

/**
 * Attribute names an agent reaches for instead of `source` / `data-field`.
 *
 * `data-*` is otherwise authorable, so without this a plausible near miss
 * lands as a custom DOM attribute and binds NOTHING, reported as success. The
 * only clue was a downstream "Unknown collection" diagnostic on a list, and on
 * a leaf there was none at all.
 */
const NEAR_MISS_BINDINGS = new Set([
  'data-source',
  'data-collection',
  'data-list',
  'collection',
  'field',
  'data-bind',
])

/** a node's shallow identity for the LCS: what its own tag encodes */
const signature = (node: { type: string; arg?: string; link?: string }) =>
  `${node.type}|${node.arg ?? ''}|${node.link ?? ''}`

const parsedSignature = (node: ParsedNode) =>
  `${node.type}|${argOf(node) ?? ''}|${node.attrs.href ?? ''}`

function argOf(node: ParsedNode): string | undefined {
  const raw = SOURCE_TYPES.has(node.type) ? node.attrs.source : node.attrs['data-field']
  return raw || undefined
}

/**
 * Longest-common-subsequence alignment of two signature lists → a map from
 * b-index to the a-index it matches. The same primitive the component adoption
 * and the instance realign use, so identity is carried the same way
 * everywhere: a removed sibling no longer shifts the survivors onto each
 * other's nodes.
 */
function lcsAlign(a: string[], b: string[]): Map<number, number> {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const map = new Map<number, number>()
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      map.set(j, i)
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++
    else j++
  }
  return map
}

/**
 * Apply a parsed document to an existing root.
 *
 * `parsed` is either the root element itself (a `<body>`, or a component's own
 * tag) or just its children — the root element is optional on input, because
 * an agent writing a page body naturally writes the elements and nothing
 * around them. Written out, the root's own attributes are applied too; left
 * out, they are left alone.
 */
export function applyHtml(
  root: ElementNode,
  parsed: ParsedNode[],
  opts: ApplyOptions,
): ApplyResult {
  const result: ApplyResult = {
    kept: 0,
    created: 0,
    removed: 0,
    refused: [],
    warnings: [],
    diagnostics: [],
  }
  const project = opts.project
  const components = project.components ?? []
  const host: StructureHost = opts.def ? masterHost(opts.def) : pageHost(root)

  let topAttrs: Record<string, string> | null = null
  let children = parsed
  if (parsed.length === 1 && sameType(parsed[0]!.type, root.type)) {
    topAttrs = parsed[0]!.attrs
    children = parsed[0]!.children
  }

  const before = new Set<string>()
  walkNodes([root], (n) => before.add(n.id))

  const mapped: Map<string, InstanceMapping> = buildInstanceMap(
    [root],
    opts.def ? [opts.def, ...components.filter((c) => c !== opts.def)] : components,
  )
  const refuse = (path: string, message: string) => result.refused.push({ path, message })
  const warn = (path: string, message: string) => result.warnings.push({ path, message })

  /** a readable address for a refusal: the element, with its ref when it has one */
  const name = (node: ElementNode) => (node.ref ? `${node.type}#${node.ref}` : node.type)
  const under = (parent: string, node: ElementNode) => `${parent} > ${name(node)}`

  // --- the claims, document-wide and BEFORE any LCS ---
  //
  // An agent may MOVE a node to another parent; it is still the same node, so
  // a `data-id` or `data-ref` claim is resolved across the whole document
  // first. Doing it per level would let one level's LCS take a node that a
  // deeper level addressed by id, which is the one thing an echoed id must
  // never lose to a guess.
  //
  // A node INSIDE an instance is deliberately not in the index. Its structure
  // is the master's, and it is addressed positionally as a part — letting a
  // `data-id` pull one out to another parent would both contradict the format
  // and leave it in two places at once, because `fillInstance` does not rebuild
  // the children array it came from.
  const addressable = [root]
  walkNodes([root], (n) => {
    const mapping = mapped.get(n.id)
    if (!mapping || isInstanceWrapper(mapping)) addressable.push(n)
  })
  const byKey = nodesByShortId([root])
  for (const [key, node] of [...byKey]) if (!addressable.includes(node)) byKey.delete(key)
  const byRef = new Map<string, ElementNode>()
  for (const node of addressable) if (node.ref) byRef.set(node.ref, node)
  const claim = new Map<ParsedNode, ElementNode>()
  const claimed = new Set<ElementNode>()
  const eachParsed = (nodes: ParsedNode[], visit: (n: ParsedNode) => void) => {
    for (const node of nodes) {
      visit(node)
      eachParsed(node.children, visit)
    }
  }
  for (const pass of ['data-id', 'data-ref'] as const) {
    eachParsed(children, (node) => {
      if (claim.has(node)) return
      const key = node.attrs[pass]
      if (!key) return
      const found = pass === 'data-id' ? byKey.get(key) : byRef.get(key)
      if (!found || claimed.has(found) || !sameType(found.type, node.type)) return
      claim.set(node, found)
      claimed.add(found)
    })
  }

  // the root itself: its own state, never its structure
  if (topAttrs) {
    applyState(root, { ...bare(root.type), attrs: topAttrs }, root.type)
  }
  alignLevel(root, children, name(root))

  // --- what went, goes properly ---
  const after = new Set<string>()
  walkNodes([root], (n) => after.add(n.id))
  const gone = new Set<string>()
  for (const id of before) if (!after.has(id)) gone.add(id)
  result.removed = gone.size
  clearBindingsToIds(host, gone)

  result.diagnostics = validateTree(root, opts.validate ?? contextFromProject(project))
  return result

  // ---------------------------------------------------------------- helpers

  function bare(type: string): ParsedNode {
    return { type, tag: type, attrs: {}, children: [], line: 0, col: 0 }
  }

  /**
   * Pair this level's parsed children with the existing ones, then recurse.
   *
   * The claims are already in; what is left is aligned by an LCS on the
   * shallow signature (type, binding, link), then by type alone for whatever
   * that left over. Anything still unpaired is new.
   */
  function alignLevel(parent: ElementNode, parsedChildren: ParsedNode[], path: string): void {
    const existing = parent.children
    const freeOld = existing
      .map((node, i) => ({ node, i }))
      .filter(({ node }) => !claimed.has(node))
    const freeNew = parsedChildren
      .map((node, i) => ({ node, i }))
      .filter(({ node }) => !claim.has(node))

    for (const signatures of [
      () =>
        [
          freeOld.map(({ node }) => signature(node)),
          freeNew.map(({ node }) => parsedSignature(node)),
        ] as const,
      () =>
        [freeOld.map(({ node }) => node.type), freeNew.map(({ node }) => node.type)] as const,
    ]) {
      const [a, b] = signatures()
      for (const [nj, oj] of lcsAlign(a, b)) {
        const target = freeNew[nj]
        const source = freeOld[oj]
        if (!target || !source) continue
        if (claim.has(target.node) || claimed.has(source.node)) continue
        if (!sameType(source.node.type, target.node.type)) continue
        claim.set(target.node, source.node)
        claimed.add(source.node)
      }
    }

    const next: ElementNode[] = []
    for (const child of parsedChildren) {
      let adopted = claim.get(child)
      // a claim must never make a node its own ancestor. An agent can write a
      // document that nests an element inside its own subtree, and a cycle in
      // the tree is unrecoverable — every walk loops forever.
      if (adopted && (adopted === parent || !!findNode([adopted], parent.id))) {
        refuse(
          `${path} > ${name(adopted)}`,
          `<${child.tag}> is written inside its own subtree; it is kept where it was and a new ` +
            'element is created here',
        )
        claim.delete(child)
        adopted = undefined
      }
      const node = adopted ?? createNode(child.type)
      if (adopted) result.kept++
      else {
        result.created++
        claim.set(child, node)
        claimed.add(node)
      }
      const childPath = under(path, node)
      applyState(node, child, child.type, childPath)
      if (isComponentType(node.type)) fillInstance(node, child, childPath)
      else if (!isLeafType(node.type)) alignLevel(node, child.children, childPath)
      next.push(node)
    }
    parent.children = next
  }

  /**
   * A component instance.
   *
   * Self-closed (`<Card />`) means "this instance, as the component defines
   * it": the subtree is realigned to the master, which fills a fresh instance
   * and leaves an existing one's per-instance content exactly as it was.
   *
   * Written out (`<Card>…</Card>`) fills its PARTS: the structure has to match
   * the master, and only content, media and `alt` are taken. That is what
   * makes a page of eight filled-in Cards ONE write. Classes or a different
   * element inside are refused by name, because every renderer reads a mapped
   * node's classes from the master — one written here would render nowhere
   * while the write reported success.
   */
  function fillInstance(node: ElementNode, parsed: ParsedNode, path: string): void {
    const def = components.find((c) => c.name === node.type)
    if (!def) return // validateTree reports the unknown component, with its id

    // a master may never end up holding itself, at any distance
    if (opts.def && !canNest(components, opts.def.name, def.name)) {
      refuse(path, `<${def.name}> can't go inside <${opts.def.name}>: a component can't hold itself`)
      return
    }
    alignStructure(node, def.root)
    if (!parsed.children.length) return

    const fill = (
      instance: ElementNode[],
      master: ElementNode[],
      written: ParsedNode[],
      at: string,
    ) => {
      if (written.length !== master.length) {
        refuse(
          at,
          `<${def.name}> has ${master.length} part${master.length === 1 ? '' : 's'} here and ` +
            `${written.length} ${written.length === 1 ? 'was' : 'were'} written. Write ` +
            `<${def.name} /> to leave its parts alone, or change the component itself with ` +
            'update_component.',
        )
        return
      }
      written.forEach((child, i) => {
        const target = instance[i]
        const below = master[i]
        if (!target || !below) return
        const childPath = under(at, target)
        if (!sameType(target.type, child.type)) {
          refuse(
            childPath,
            `part ${i + 1} of <${def.name}> is a <${target.type}>, not a <${child.tag}>`,
          )
          return
        }
        fillPart(target, child, def.name, childPath)
        fill(target.children, below.children, child.children, childPath)
      })
    }
    fill(node.children, def.root.children, parsed.children, path)
  }

  /**
   * One part of an instance.
   *
   * What an instance owns is its CONTENT, its media, its per-placement `alt`,
   * its hidden flag, its field-bound attributes and its `htmlId` — a per-page
   * anchor. Everything else on a mapped node (its classes, its binding, its
   * link, its shared attributes) is the master's: every renderer reads those
   * from there, so one written here would render nowhere. Writing back what
   * the read showed is therefore a no-op, and CHANGING it is refused with the
   * tool that can actually do it.
   */
  function fillPart(node: ElementNode, parsed: ParsedNode, component: string, path: string): void {
    const shared = (attr: string, current: string | undefined) => {
      if ((parsed.attrs[attr] ?? '') === (current ?? '')) return
      refuse(
        path,
        `'${attr}' inside <${component}> is the component's, not this instance's — ` +
          'change it with update_component',
      )
    }
    const implied = impliedAttrs(node.type)

    for (const [attr, value] of Object.entries(parsed.attrs)) {
      switch (true) {
        case attr === 'data-id':
        case attr === 'data-type':
        case attr === 'data-interactions':
        case attr === 'data-animations':
          break

        case implied[attr] !== undefined:
          break // part of the element's identity, not state

        case attr === 'id':
          assign(node, 'htmlId', value)
          break

        case attr === 'src':
          setSrc(node, value, path)
          break

        case attr === 'alt': {
          // per-placement attribute text: what lets one component serve
          // "Search contacts" and "Your email" without copying its classes
          const attrs = { ...(node.instanceAttributes ?? {}) }
          if (value) attrs.alt = value
          else delete attrs.alt
          assignObject(node, 'instanceAttributes', attrs)
          break
        }

        case attr === 'data-hidden':
          setHidden(node, value)
          break

        case attr === 'data-icon':
          // an icon's markup is per-instance state, but it is never IN the
          // HTML; writing the name back can only mean "unchanged"
          if (value && value !== iconNameOf(node)) {
            refuse(
              path,
              `an icon's markup is not in the HTML — set it with edit_elements {icon: "${value}"}`,
            )
          }
          break

        case attr.startsWith('data-bind-'):
          setFieldAttr(node, attr.slice('data-bind-'.length), value, path)
          break

        case attr === 'data-ref':
          refuse(
            path,
            'a ref inside a component instance would be duplicated on every instance — put it ' +
              `on the <${component}> element instead`,
          )
          break

        case attr === 'class':
          refuse(
            path,
            `a class inside <${component}> renders nowhere: a mapped node wears the component's. ` +
              'Style the component instead.',
          )
          break

        case attr === 'href':
          shared('href', node.link)
          break
        case attr === 'source':
        case attr === 'data-field':
          shared(attr, node.arg)
          break

        case NEAR_MISS_BINDINGS.has(attr):
          refuse(path, `'${attr}' binds nothing — a field binding is 'data-field'`)
          break

        default:
          shared(attr, node.attributes?.[attr])
      }
    }

    // an attribute the agent dropped is a removal here too, for the keys this
    // placement owns
    const has = (attr: string) => parsed.attrs[attr] !== undefined
    if (!has('id') && node.htmlId !== undefined) delete node.htmlId
    if (!has('src') && node.src !== undefined) delete node.src
    if (!has('data-hidden') && node.hidden !== undefined) delete node.hidden
    if (!has('alt') && node.instanceAttributes?.alt !== undefined) {
      const attrs = { ...node.instanceAttributes }
      delete attrs.alt
      assignObject(node, 'instanceAttributes', attrs)
    }
    const fields: Record<string, string> = {}
    for (const [attr, field] of Object.entries(node.fieldAttrs ?? {})) {
      if (has(`data-bind-${attr}`)) fields[attr] = field
    }
    assignObject(node, 'fieldAttrs', fields)

    if (parsed.text !== undefined && isLeafType(node.type)) setContent(node, parsed, path)
  }

  // ---------------------------------------------------------------- state

  function applyState(node: ElementNode, parsed: ParsedNode, type: string, path = name(node)) {
    const isInstance = isComponentType(type)
    // an alias keeps its own type: `container` and `div` render identically, so
    // rewriting one as the other would be churn with no effect
    if (!sameType(node.type, type)) node.type = type

    const implied = impliedAttrs(type)
    for (const [attr, value] of Object.entries(parsed.attrs)) {
      switch (true) {
        // addressing, and read-only information
        case attr === 'data-id':
        case attr === 'data-type':
        case attr === 'data-interactions':
        case attr === 'data-animations':
          break

        // `type="checkbox"` IS the element, not an attribute on it
        case implied[attr] !== undefined:
          break

        case attr === 'data-ref':
          setRef(node, value, path)
          break

        case attr === 'class':
          if (isInstance) {
            refuse(
              path,
              `a class on <${parsed.tag}> renders nowhere: an instance wrapper emits no element ` +
                "of its own, and its look is the component's. Style the component instead.",
            )
          } else setClasses(node, value, path)
          break

        case attr === 'id':
          assign(node, 'htmlId', value)
          break

        case attr === 'source':
          if (!SOURCE_TYPES.has(type)) {
            refuse(path, `<${parsed.tag}> takes no 'source'; a field binding is 'data-field'`)
          } else assign(node, 'arg', value)
          break

        case attr === 'data-field':
          if (SOURCE_TYPES.has(type)) {
            refuse(path, `<${parsed.tag}> binds a whole collection with 'source', not 'data-field'`)
          } else if (isInstance) {
            refuse(path, `<${parsed.tag}> emits no element, so it has nothing to bind`)
          } else assign(node, 'arg', value)
          break

        case attr === 'href':
          if (isInstance) refuse(path, `<${parsed.tag}> emits no element, so it has no link`)
          else assign(node, 'link', value)
          break

        case attr === 'src':
          setSrc(node, value, path)
          break

        case attr === 'data-hidden':
          setHidden(node, value)
          break

        case attr === 'data-icon':
          if (value && value !== iconNameOf(node)) {
            refuse(
              path,
              `an icon's markup is not in the HTML — set it with edit_elements {icon: "${value}"}`,
            )
          }
          break

        case NEAR_MISS_BINDINGS.has(attr):
          refuse(
            path,
            SOURCE_TYPES.has(type)
              ? `'${attr}' binds nothing — <${parsed.tag}> takes a whole collection as 'source'`
              : `'${attr}' binds nothing — a field binding is 'data-field'`,
          )
          break

        case attr.startsWith('data-bind-'):
          setFieldAttr(node, attr.slice('data-bind-'.length), value, path)
          break

        case attr.startsWith('data-variant-'):
          if (!isInstance) {
            refuse(path, `only a component instance wears a variant; <${parsed.tag}> does not`)
          } else setVariant(node, attr.slice('data-variant-'.length), value)
          break

        default:
          if (isInstance) {
            refuse(
              path,
              `'${attr}' on <${parsed.tag}> belongs to the component — change it with ` +
                'update_component, or use edit_elements {instanceAttributes} for this placement',
            )
          } else if (!isAllowedAttribute(attr)) {
            refuse(path, `'${attr}' is not an allowed attribute`)
          } else setAttr(node, attr, value)
      }
    }

    // an attribute the agent DROPPED is a removal: the document it wrote is
    // the whole truth for everything the format carries, or an attribute could
    // never be taken off again
    pruneAbsent(node, parsed, isInstance, () => path)
    if (!isInstance && isLeafType(type) && parsed.text !== undefined) {
      setContent(node, parsed, path)
    }
  }

  function pruneAbsent(
    node: ElementNode,
    parsed: ParsedNode,
    isInstance: boolean,
    pathFor: (n: ElementNode) => string,
  ) {
    const has = (attr: string) => parsed.attrs[attr] !== undefined
    if (!has('data-ref') && node.ref !== undefined) delete node.ref
    if (!has('id') && node.htmlId !== undefined) delete node.htmlId
    if (!has('data-hidden') && node.hidden !== undefined) delete node.hidden
    if (!has(SOURCE_TYPES.has(node.type) ? 'source' : 'data-field') && node.arg !== undefined) {
      delete node.arg
    }
    if (isInstance) {
      // the wrapper carries only its picks; everything else is the component's.
      // Existing axes keep their key ORDER: `computeMerge` compares a whole
      // object's JSON, so re-ordering two picks would read as a conflict.
      const written = new Map<string, string>()
      for (const [attr, value] of Object.entries(parsed.attrs)) {
        if (attr.startsWith('data-variant-')) written.set(attr.slice('data-variant-'.length), value)
      }
      const picks: Record<string, string> = {}
      for (const axis of Object.keys(node.variants ?? {})) {
        const value = written.get(axis)
        if (value) picks[axis] = value
        written.delete(axis)
      }
      for (const [axis, value] of written) if (value) picks[axis] = value
      assignObject(node, 'variants', picks)
      return
    }
    if (node.variants !== undefined) delete node.variants
    if (!has('href') && node.link !== undefined) delete node.link
    if (!has('class') && node.classes !== undefined) {
      // The document is the whole truth, so an absent `class` CLEARS the
      // classes — which is right, and is also the easiest way to wipe a
      // component's styling by writing its structure out from memory. Named,
      // not silent: a deliberate removal is written as `class=""` or by listing
      // what remains, so an unmentioned `class` on a styled element is almost
      // always an accident.
      if (node.classes.trim()) {
        warn(
          pathFor(node),
          `had classes ("${node.classes.trim()}") and the markup gives it none, so they are ` +
            'gone. Write `class=""` if that was deliberate; otherwise echo the classes back.',
        )
      }
      delete node.classes
    }
    if (!has('src') && node.src !== undefined) delete node.src
    const implied = impliedAttrs(node.type)
    const attrs: Record<string, string> = {}
    for (const [attr, value] of Object.entries(node.attributes ?? {})) {
      if (has(attr) || implied[attr] !== undefined) attrs[attr] = value
    }
    assignObject(node, 'attributes', attrs)
    const fields: Record<string, string> = {}
    for (const [attr, field] of Object.entries(node.fieldAttrs ?? {})) {
      if (has(`data-bind-${attr}`)) fields[attr] = field
    }
    assignObject(node, 'fieldAttrs', fields)
  }

  function setRef(node: ElementNode, value: string, path: string) {
    const ref = value.trim()
    if (!ref) {
      delete node.ref
      return
    }
    if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(ref)) {
      refuse(path, `'${ref}' is not a valid ref — letters, digits and '-', starting with a letter`)
      return
    }
    if (node.type === 'body') {
      refuse(path, '<body> carries no ref: it is the page root and is already addressable')
      return
    }
    const mapping = mapped.get(node.id)
    if (mapping && !isInstanceWrapper(mapping)) {
      refuse(
        path,
        'a ref inside a component instance would be duplicated on every instance — put it on ' +
          `the <${mapping.def.name}> element instead`,
      )
      return
    }
    assign(node, 'ref', ref)
    byRef.set(ref, node)
  }

  /**
   * The `class` attribute is the WHOLE list, so a token the style catalog does
   * not model is KEPT and reported — every renderer and the exporter use
   * `node.classes` verbatim, so dropping one would change the published page.
   * What it costs is that the Style panel cannot show it as a control, which
   * is what the warning says.
   */
  function setClasses(node: ElementNode, value: string, path: string) {
    const tokens = value.split(/\s+/).filter(Boolean)
    for (const token of tokens) {
      if (!isValidClass(token)) {
        warn(path, `'${token}' is kept, but the Style panel has no control for it`)
      }
    }
    assign(node, 'classes', tokens.join(' '))
  }

  function setSrc(node: ElementNode, value: string, path: string) {
    // the read elides a `data:` URL (megabytes of base64 nobody can edit);
    // writing the marker back can only honestly mean "unchanged"
    if (value === ELIDED_DATA_URL) return
    if (value && !SAFE_SRC.test(value)) {
      refuse(path, `'${value}' is not a usable media URL — upload one with upload_media`)
      return
    }
    assign(node, 'src', value)
  }

  function setAttr(node: ElementNode, attr: string, value: string) {
    assignObject(
      node,
      'attributes',
      sanitizeAttributes({ ...(node.attributes ?? {}), [attr]: value }),
    )
  }

  function setFieldAttr(node: ElementNode, attr: string, field: string, path: string) {
    if (isComponentType(node.type)) {
      refuse(path, 'an instance wrapper emits no element, so an attribute has nowhere to land')
      return
    }
    if (!isAllowedAttribute(attr)) {
      refuse(path, `'${attr}' is not an allowed attribute, so it can't be bound to a field`)
      return
    }
    const next = { ...(node.fieldAttrs ?? {}) }
    if (field) next[attr] = field
    else delete next[attr]
    assignObject(node, 'fieldAttrs', next)
  }

  function setVariant(node: ElementNode, axis: string, option: string) {
    const next = { ...(node.variants ?? {}) }
    if (option) next[axis] = option
    else delete next[axis]
    assignObject(node, 'variants', next)
  }

  function setContent(node: ElementNode, parsed: ParsedNode, path: string) {
    const raw = parsed.text ?? ''
    // rich copy keeps its markup (sanitized); plain text is decoded, undoing
    // exactly what the serializer escaped
    const text = isRich(raw) ? sanitizeRich(raw) : decodeEntities(raw)
    if (!isLeafElement(node.type) && text.trim()) {
      refuse(path, `<${parsed.tag}> is a container — its words go in a child element`)
      return
    }
    assign(node, 'content', text)
  }

  /** `data-hidden` is the editor's hide, not the HTML `hidden` attribute: a
   *  bare one means true, and an explicit `false` is how an instance SHOWS a
   *  part its component hides */
  function setHidden(node: ElementNode, value: string) {
    const next = value !== 'false'
    if (node.hidden !== next) node.hidden = next
  }

  /** write only a real change, and let an empty value DELETE the key — which
   *  is what makes a round-trip of an unchanged document byte-identical */
  function assign<K extends 'classes' | 'content' | 'htmlId' | 'src' | 'arg' | 'ref' | 'link'>(
    node: ElementNode,
    key: K,
    value: string,
  ) {
    // `content` is the one field whose empty string is the canonical absence
    // (`createNode` writes it), so it is assigned rather than deleted
    const next = key === 'content' ? value : value.trim()
    if (!next && key !== 'content') {
      if (node[key] !== undefined) delete node[key]
      return
    }
    if (node[key] !== next) node[key] = next
  }

  function assignObject<K extends 'attributes' | 'fieldAttrs' | 'variants' | 'instanceAttributes'>(
    node: ElementNode,
    key: K,
    value: Record<string, string>,
  ) {
    if (!Object.keys(value).length) {
      if (node[key] !== undefined) delete node[key]
      return
    }
    if (JSON.stringify(node[key]) !== JSON.stringify(value)) node[key] = value
  }
}

const iconNameOf = (node: ElementNode) =>
  node.svg?.match(/data-icon="([a-z0-9:_-]+)"/)?.[1] ?? (node.svg ? 'custom' : '')

/** the validation context a project implies */
export function contextFromProject(project: Project): ValidateContext {
  const collections = project.collections ?? []
  return {
    componentNames: (project.components ?? []).map((c) => c.name),
    collectionNames: collections.map((c) => c.name),
    listFieldNames: collections.flatMap((c) =>
      c.fields
        .filter((f) => f.type === 'multi-reference' || f.type === 'multi-image')
        .map((f) => f.name),
    ),
    dataOnlyCollections: collections.filter((c) => c.detailRoutes === false).map((c) => c.name),
  }
}
