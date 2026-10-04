import type { ElementNode } from '@/types/editor'
import { isComponentType } from './components'
import { BUILTIN_LIST_SOURCES } from './nodeState'

/**
 * What is wrong with a page's structure — the only place a human sees that a
 * document is broken, now that the code column is gone.
 *
 * This replaces the half of `validateDocument` that still means something. The
 * other half was grammar (indentation, unclosed blocks, leaf-vs-container form,
 * invalid tokens) and cannot be expressed in a tree at all: a node is a node,
 * its children are its children. What remains are the rules about MEANING, and
 * they still arrive broken — from agents, from a 3-way merge, and from projects
 * written before a rule existed.
 *
 * Diagnostics address a NODE, not a line, so the issues footer selects the
 * element it is talking about.
 */

export interface TreeDiagnostic {
  nodeId: string
  message: string
}

export interface ValidateContext {
  componentNames: string[]
  collectionNames: string[]
  /** multi-reference / multi-image field names — also valid list sources */
  listFieldNames: string[]
  /** collections with `detailRoutes: false`: they render inside other pages and
   *  own no route, so an `@item` link inside one points nowhere */
  dataOnlyCollections: string[]
}

/** an open entry scope: what a `:collection-list` / `:collection-item` / bound
 *  `:slider` (or a collection template's `:body[name]`) is iterating */
interface Scope {
  type: string
  arg?: string
}

export function validateTree(root: ElementNode, ctx: ValidateContext): TreeDiagnostic[] {
  const diags: TreeDiagnostic[] = []
  /** every ref seen so far → the node that claimed it */
  const refAt = new Map<string, ElementNode>()

  const visit = (
    node: ElementNode,
    parent: ElementNode | null,
    /** the entry scopes around this node, outermost first */
    scopes: Scope[],
    /** the KNOWN component instances it is inside, outermost first */
    instances: string[],
    /** the `form` ancestors, so a nested form can be named */
    forms: ElementNode[],
  ) => {
    if (node.ref) {
      // refs are page-scope addresses, so a second use makes both ambiguous —
      // an agent addressing by one can't be told which element it meant
      if (refAt.has(node.ref)) {
        diags.push({
          nodeId: node.id,
          message: `'#${node.ref}' is already used by another element — refs must be unique on a page`,
        })
      } else {
        refAt.set(node.ref, node)
      }
      // inside an instance the structure is the master's, copied into every
      // instance on every page — a ref there would be duplicated across all of
      // them. The instance's own wrapper is fine: that is a real page node.
      const host = instances[instances.length - 1]
      if (host) {
        diags.push({
          nodeId: node.id,
          message:
            `'#${node.ref}' is inside the '${host}' component — refs are page-scope, and a ` +
            `component's structure is copied into every instance. Put the ref on the ` +
            `'${host}' element instead.`,
        })
      }
    }

    if (node.type === 'list-empty') {
      // it renders only when a list has nothing to repeat, so it is meaningful
      // ONLY as a direct child of a list or a bound slider. Anywhere else it
      // renders never — a silent no-op worth saying out loud.
      const inList =
        !!parent &&
        (parent.type === 'collection-list' || (parent.type === 'slider' && !!parent.arg))
      if (!inList) {
        diags.push({
          nodeId: node.id,
          message:
            "'list-empty' is a list's empty state — it only renders as a DIRECT child of a " +
            "'collection-list' or a bound 'slider'. Elsewhere it never renders at all.",
        })
      }
    }

    if (node.type === 'form-success' || node.type === 'form-error') {
      // like `list-empty`: it renders only in one position, so anywhere else is
      // a silent no-op worth saying out loud.
      if (parent?.type !== 'form') {
        diags.push({
          nodeId: node.id,
          message:
            `'${node.type}' is a form's ${node.type === 'form-success' ? 'success' : 'error'} ` +
            "state — it only renders as a DIRECT child of a 'form'. Elsewhere it never " +
            'renders at all.',
        })
      } else {
        const twins = (parent.children ?? []).filter((c) => c.type === node.type)
        if (twins.length > 1 && twins[0] !== node) {
          diags.push({
            nodeId: node.id,
            message: `this form already has a '${node.type}' — only the first one renders.`,
          })
        }
      }
    }

    if (node.type === 'form' && forms.length) {
      // the browser does not nest forms: it closes the outer one, so the inner
      // controls silently submit to the wrong place (or nowhere)
      diags.push({
        nodeId: node.id,
        message:
          'a form cannot contain another form — browsers close the outer one, so the inner ' +
          'fields are not submitted.',
      })
    }

    if (node.link === '@item') {
      // '@item' links to the entry's own page — which a data-only collection
      // does not have. Caught here rather than silently rendering unlinked.
      const scope = [...scopes].reverse().find((s) => s.arg && ctx.collectionNames.includes(s.arg))
      if (scope && ctx.dataOnlyCollections.includes(scope.arg!)) {
        diags.push({
          nodeId: node.id,
          message:
            `'@item' links to an entry's own page, but the collection '${scope.arg}' has no ` +
            'detail routes (detailRoutes: false). Remove the link, or give the collection a ' +
            'template page.',
        })
      }
    }

    let childScopes = scopes
    let childInstances = instances

    if (node.slot) {
      if (node.type === 'body' || isComponentType(node.type) || !node.children) {
        diags.push({ nodeId: node.id, message: `'${node.type}' can't be a slot — a slot is a container inside the component` })
      } else if (parent === null) {
        diags.push({ nodeId: node.id, message: "The component's own element can't be a slot" })
      }
      // what is under a slot belongs to the holder: a page's own structure
      // again, where a ref is fine and an instance is an instance
      childInstances = []
    }

    if (isComponentType(node.type)) {
      if (!ctx.componentNames.includes(node.type)) {
        diags.push({ nodeId: node.id, message: `Unknown component '${node.type}'` })
      } else {
        if (instances.includes(node.type)) {
          diags.push({ nodeId: node.id, message: `'${node.type}' can't contain itself` })
        }
        childInstances = [...instances, node.type]
      }
    } else if (node.type === 'collection-list' || node.type === 'collection-item') {
      const arg = node.arg
      const known =
        !!arg &&
        (ctx.collectionNames.includes(arg) ||
          // built-in list sources ('@pages' — the site's own pages)
          (node.type === 'collection-list' && BUILTIN_LIST_SOURCES.includes(arg)) ||
          (node.type === 'collection-list' && ctx.listFieldNames.includes(arg)))
      if (!known) {
        diags.push({
          nodeId: node.id,
          message: `Unknown collection '${node.type}${arg ? `[${arg}]` : ''}'`,
        })
      }
      childScopes = [...scopes, { type: node.type, arg }]
    } else if (node.type === 'slider') {
      // a slider's arg is OPTIONAL: with one it repeats per entry like a
      // :collection-list, without one each direct child is a slide
      const arg = node.arg
      if (
        arg &&
        !ctx.collectionNames.includes(arg) &&
        !BUILTIN_LIST_SOURCES.includes(arg) &&
        !ctx.listFieldNames.includes(arg)
      ) {
        diags.push({ nodeId: node.id, message: `Unknown collection 'slider[${arg}]'` })
      }
      if (arg) childScopes = [...scopes, { type: node.type, arg }]
    } else if (node.type === 'body' && node.arg) {
      // a collection template page: its whole body renders per entry
      childScopes = [...scopes, { type: node.type, arg: node.arg }]
    }

    const childForms = node.type === 'form' ? [...forms, node] : forms
    for (const child of node.children) {
      visit(child, node, childScopes, childInstances, childForms)
    }
  }

  visit(root, null, [], [], [])
  return diags
}
