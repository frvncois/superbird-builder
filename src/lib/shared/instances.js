// Component instances — which master node a page node stands for, and what it
// inherits from it. Plain-JS ESM shared VERBATIM by the editor
// (useComponents), the whole-project operations (componentOps), the exporter
// (server/export.mjs) and the MCP tools.
//
// This pairing used to exist four times, one per consumer, each a few lines
// long and each "a mirror of" another. That held while an instance was one
// flat block. It does not survive per-instance state that resolves through a
// chain (hidden parts, variant picks) — four walks would be four chances to
// resolve the chain differently, and the canvas would stop matching the site.

/** component types are Capitalized in the syntax; built-ins stay lowercase */
export const isComponentType = (type) => /^[A-Z]/.test(type)

/**
 * @typedef {object} Mapping
 * @property {object} master      the master node this page node stands for —
 *                                where its classes, interactions and structure live
 * @property {object} root        the root of that master's component
 * @property {object} def         the component itself
 * @property {string} instanceId  the id of the instance wrapper this node sits
 *                                in: what makes a binding's state unique per instance
 * @property {object[]} mirrors   nodes between this one and its master that may
 *                                also carry its state, most specific first (the
 *                                copies held by the components it is nested in)
 * @property {Record<string,string>} picks  the instance's variant option per axis
 */

/**
 * Map every node that lives in a component instance to its master, by
 * structural position (index + type): the instance block on the page mirrors
 * the master's tree, so the n-th child stands for the master's n-th child.
 *
 * `roots` are the trees to walk — a page's elements, or (on the components
 * board) each master's own children. `components` is the project's list; a
 * name resolves to the FIRST component carrying it, as `findComponent` does.
 *
 * @returns {Map<string, Mapping>}
 */
export function buildInstanceMap(roots, components) {
  const byName = new Map()
  for (const def of components ?? []) if (!byName.has(def.name)) byName.set(def.name, def)

  const map = new Map()

  const pair = (inst, master, scope) => {
    if (inst.type !== master.type) return
    map.set(inst.id, {
      master,
      root: scope.def.root,
      def: scope.def,
      instanceId: scope.instanceId,
      mirrors: [],
      picks: scope.picks,
    })
    const length = Math.min(inst.children.length, master.children.length)
    for (let i = 0; i < length; i++) pair(inst.children[i], master.children[i], scope)
  }

  const visit = (nodes) => {
    for (const node of nodes ?? []) {
      const def = isComponentType(node.type) ? byName.get(node.type) : undefined
      if (!def) {
        visit(node.children)
        continue
      }
      // the instance block itself maps to the master root. Its subtree is
      // paired, not walked: whatever sits inside belongs to this instance.
      pair(node, def.root, { def, instanceId: node.id, picks: resolvePicks(def, node, []) })
    }
  }
  visit(roots)
  return map
}

/**
 * The option an instance picks on each of its component's axes: its wrapper's
 * own pick, else one from the components it is nested in, else the axis
 * default. A pick naming an option that no longer exists falls through —
 * a stale name must never leave an instance wearing nothing.
 */
export function resolvePicks(def, wrapper, mirrors) {
  const picks = {}
  for (const axis of def.variants ?? []) {
    let pick
    for (const source of [wrapper, ...(mirrors ?? [])]) {
      const value = source?.variants?.[axis.name]
      if (value !== undefined && axis.options.includes(value)) {
        pick = value
        break
      }
    }
    picks[axis.name] = pick ?? axis.default
  }
  return picks
}

/**
 * The first DEFINED value of `key` along a node's chain: its own, then each
 * mirror's, then its master's. `undefined` when nothing in the chain sets it.
 *
 * "Defined", not "truthy": `hidden: false` on an instance is how it shows a
 * part its component hides by default.
 */
export function resolveInstanceValue(node, mapping, key) {
  if (node[key] !== undefined) return node[key]
  if (!mapping) return undefined
  for (const mirror of mapping.mirrors) {
    if (mirror[key] !== undefined) return mirror[key]
  }
  return mapping.master[key]
}

/** what a node would inherit for `key` if it set nothing itself */
export function inheritedInstanceValue(mapping, key) {
  if (!mapping) return undefined
  for (const mirror of mapping.mirrors) {
    if (mirror[key] !== undefined) return mirror[key]
  }
  return mapping.master[key]
}

/** a hidden node is not rendered and not exported — for this instance only,
 * when the flag is its own */
export function isNodeHidden(node, mapping) {
  return resolveInstanceValue(node, mapping, 'hidden') === true
}

/**
 * Show or hide a node, writing only what differs from what it inherits — so
 * hiding a part and showing it again leaves the node byte-identical, which
 * keeps merge signatures (whole-object JSON) from reporting a change that
 * was undone.
 */
export function setNodeHidden(node, mapping, hidden) {
  const inherited = inheritedInstanceValue(mapping, 'hidden') === true
  if (hidden === inherited) delete node.hidden
  else node.hidden = hidden
}
