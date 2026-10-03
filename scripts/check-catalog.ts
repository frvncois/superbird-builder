// Validates the bundled component library (src/lib/catalog/).
//
// Run with:  npm run check:catalog
//
// An entry is plain data, so nothing else catches a malformed one — the type
// checker sees a well-typed object and the e2e suite only exercises the few
// entries it inserts. This holds every entry to what a hand-authored component
// must satisfy, which is exactly the list of ways a catalog entry can be wrong:
// an unknown element, a class the Style panel would refuse (it renders fine but
// becomes un-retypeable once removed), a token class whose token nobody
// declares, a binding pointing at a node key that doesn't exist, ids that
// aren't minted per add, or a block that doesn't parse.
//
// It has already earned this: it caught a Select carrying a `placeholder:` rule
// a <select> cannot use.
//
// Entries can hold instances of other entries, come in variants, and carry
// icons and optional parts. Each of those is one more way to be wrong — an
// instance of an entry that does not exist, an override for an option nobody
// declared, a part addressed by a key the component does not have — and each
// is checked here, because a wrong one fails silently: the override is
// dropped, the part is skipped, and the component simply looks off.
import assert from 'node:assert'
import {
  CATALOG,
  CATALOG_ICONS,
  CATALOG_TOKENS,
  catalogDependencies,
  catalogEntry,
  materializeCatalogEntry,
} from '../src/lib/catalog'
import type { CatalogEntry, CatalogNode } from '../src/lib/catalog'
import { buildInstanceMap } from '../src/lib/instances'
import { effectiveClasses } from '../src/lib/variants'
import { isValidClass, setStyleTokens } from '../src/lib/styles'
import { setColorTokens } from '../src/lib/colors'
import { validateTree } from '../src/lib/validateTree'
import { isKnownElement } from '../src/lib/elements'
import { walkNodes } from '../src/lib/tree'
import { createProject } from '../src/lib/factories'
import type { ComponentDef, Project } from '../src/types/editor'

// the style/colour vocabularies are normally fed by a watchEffect in
// useSettings; headless, we register the catalog palette ourselves
const names = Object.keys(CATALOG_TOKENS)
setStyleTokens(names)
setColorTokens(Object.fromEntries(names.map((n) => [n, CATALOG_TOKENS[n]!])))

let failures = 0
const fail = (msg: string) => {
  console.error(`FAIL  ${msg}`)
  failures++
}

const eachNode = (node: CatalogNode, visit: (n: CatalogNode) => void) => {
  visit(node)
  for (const child of node.children ?? []) eachNode(child, visit)
}

/** every class must be one the Style panel accepts, and every token class must
 *  have its token declared by the entry */
function checkClasses(where: string, classes: string | undefined, declared: Set<string>) {
  for (const cls of (classes ?? '').split(/\s+/).filter(Boolean)) {
    if (!isValidClass(cls)) fail(`${where}: "${cls}" is not a class the Style panel accepts`)
    // bg-primary / text-muted-foreground / border-border … must be declared.
    // LONGEST match: 'text-primary-foreground' ends with '-foreground' too.
    const token = names
      .filter((n) => cls.endsWith(`-${n}`))
      .sort((a, b) => b.length - a.length)[0]
    if (token && !declared.has(token)) fail(`${where}: uses "${cls}" but doesn't declare "${token}"`)
  }
}

/** add an entry to a project the way the editor does: what it holds first */
function addTo(project: Project, entry: CatalogEntry): ComponentDef {
  const made = materializeCatalogEntry(entry, project, (key) => {
    const have = project.components.find((c) => c.source === key)
    if (have) return have
    const held = catalogEntry(key)
    return held ? addTo(project, held) : null
  })
  project.components.push(made.def)
  project.interactions.push(...made.interactions)
  return made.def
}

/** can `from` reach `to` by following what each entry holds? */
function holds(from: string, to: string, seen = new Set<string>()): boolean {
  if (seen.has(from)) return false
  seen.add(from)
  const entry = catalogEntry(from)
  return !!entry && catalogDependencies(entry).some((key) => key === to || holds(key, to, seen))
}

assert.ok(CATALOG.length, 'the catalog is not empty')
const keys = new Set<string>()
const componentNames = new Set<string>()

for (const entry of CATALOG) {
  const where = `${entry.key} (${entry.name})`

  if (keys.has(entry.key)) fail(`${where}: duplicate key`)
  keys.add(entry.key)
  if (componentNames.has(entry.name)) fail(`${where}: duplicate component name`)
  componentNames.add(entry.name)
  if (!/^[A-Z][A-Za-z0-9]*$/.test(entry.name)) fail(`${where}: name is not a PascalCase token`)
  if (!entry.description) fail(`${where}: no description`)

  // tokens it declares must exist in the palette, and every token its classes
  // reference must be declared — or adding it yields an unstyled component
  const declared = new Set(entry.tokens)
  for (const t of entry.tokens) {
    if (!CATALOG_TOKENS[t]) fail(`${where}: declares unknown token "${t}"`)
  }

  const interactionKeys = new Set((entry.interactions ?? []).map((i) => i.key))
  const nodeKeys = new Set<string>()
  eachNode(entry.root, (n) => {
    if (n.key) nodeKeys.add(n.key)
  })

  // --- variants: well-formed axes ---
  const options = new Set<string>()
  for (const axis of entry.variants ?? []) {
    if (!/^[a-z][a-z0-9-]*$/.test(axis.name)) fail(`${where}: axis name "${axis.name}"`)
    if (!axis.options.length) fail(`${where}: axis "${axis.name}" has no options`)
    if (!axis.options.includes(axis.default)) {
      fail(`${where}: axis "${axis.name}" defaults to "${axis.default}", which it does not have`)
    }
    for (const option of axis.options) {
      if (!/^[a-z][a-z0-9-]*$/.test(option)) fail(`${where}: option name "${option}"`)
      options.add(`${axis.name}:${option}`)
    }
  }

  if (holds(entry.key, entry.key)) fail(`${where}: holds itself, directly or through another entry`)

  eachNode(entry.root, (node) => {
    if (node.component) {
      // --- an instance of another entry ---
      const held = catalogEntry(node.component)
      if (!held) {
        fail(`${where}: holds "${node.component}", which is not an entry`)
        return
      }
      if (node.type !== held.name) {
        fail(`${where}: an instance of "${node.component}" must be typed "${held.name}", not "${node.type}"`)
      }
      // what is inside an instance is the component's, never the host's
      for (const own of ['classes', 'children', 'interactions', 'content', 'variantClasses'] as const) {
        if (node[own] !== undefined) fail(`${where}: an instance of ${held.name} cannot carry its own ${own}`)
      }
      for (const [axis, option] of Object.entries(node.variants ?? {})) {
        const known = held.variants?.find((a) => a.name === axis)
        if (!known) fail(`${where}: ${held.name} has no "${axis}" axis`)
        else if (!known.options.includes(option)) fail(`${where}: ${held.name}'s "${axis}" has no "${option}"`)
      }
      const parts = new Map<string, CatalogNode>()
      eachNode(held.root, (n) => {
        if (n.key) parts.set(n.key, n)
      })
      for (const [key, part] of Object.entries(node.parts ?? {})) {
        const at = parts.get(key)
        if (!at) {
          fail(`${where}: ${held.name} has no part "${key}"`)
          continue
        }
        if (part.icon) {
          if (at.type !== 'icon') fail(`${where}: part "${key}" of ${held.name} is not an icon`)
          if (!CATALOG_ICONS[part.icon]) fail(`${where}: unknown icon "${part.icon}" — run npm run build:icons`)
        }
      }
      return
    }

    if (!isKnownElement(node.type)) fail(`${where}: unknown element ":${node.type}"`)
    if (node.variants || node.parts) fail(`${where}: variants/parts belong on an instance of another entry`)
    checkClasses(where, node.classes, declared)
    for (const [key, classes] of Object.entries(node.variantClasses ?? {})) {
      if (!options.has(key)) fail(`${where}: overrides "${key}", which is not an option it declares`)
      checkClasses(`${where} [${key}]`, classes, declared)
    }
    if (node.icon !== undefined) {
      if (node.type !== 'icon') fail(`${where}: only an :icon: carries an icon`)
      if (!CATALOG_ICONS[node.icon]) fail(`${where}: unknown icon "${node.icon}" — run npm run build:icons`)
    } else if (node.type === 'icon') {
      fail(`${where}: an :icon: with no icon`)
    }
    // a button, a link and a label hold their words in a child
    if (node.content && ['button', 'link', 'label'].includes(node.type)) {
      fail(`${where}: ":${node.type}" is a container — its text goes in a child`)
    }
    for (const b of node.interactions ?? []) {
      if (!interactionKeys.has(b.interaction)) {
        fail(`${where}: binding names undeclared interaction "${b.interaction}"`)
      }
      if (b.target && !nodeKeys.has(b.target)) {
        fail(`${where}: binding targets unknown node key "${b.target}"`)
      }
      // a group holds ONE open key; pairing it with a Hide would close the Show
      if (b.group && b.action === 'off') {
        fail(`${where}: an 'off' binding must not carry a group`)
      }
    }
  })

  // --- add it to a fresh project and check the result ---
  const project: Project = createProject('Catalog check') as unknown as Project
  let def: ComponentDef
  try {
    def = addTo(project, entry)
  } catch (err) {
    fail(`${where}: ${(err as Error).message}`)
    continue
  }
  assert.equal(def.name, entry.name)
  assert.equal(def.root.type, entry.name, `${where}: root type must equal the name`)
  assert.equal(def.source, entry.key)
  assert.equal(def.category, entry.category)
  assert.equal(def.root.children.length, 1, `${where}: exactly one root child`)
  assert.deepEqual(def.variants ?? [], entry.variants ?? [], `${where}: axes must survive`)
  for (const t of new Set(entry.tokens)) {
    assert.ok(CATALOG_TOKENS[t], `${where}: a fresh project is missing "${t}"`)
  }
  // everything it holds came with it
  for (const key of catalogDependencies(entry)) {
    assert.ok(
      project.components.some((c) => c.source === key),
      `${where}: adding it must add "${key}"`,
    )
  }

  // every symbolic target resolved to a real node id inside this tree
  const ids = new Set<string>()
  walkNodes([def.root], (n) => ids.add(n.id))
  walkNodes([def.root], (n) => {
    for (const b of n.interactions ?? []) {
      if (b.targetId && !ids.has(b.targetId)) {
        fail(`${where}: binding target ${b.targetId} is outside the component`)
      }
      if (!project.interactions.some((i) => i.id === b.interactionId)) {
        fail(`${where}: binding references an interaction that wasn't created`)
      }
    }
  })

  // every instance it holds resolves, and every option it can wear produces
  // classes with no two on one property — the whole point of an override
  const map = buildInstanceMap(def.root.children, project.components)
  walkNodes(def.root.children, (n) => {
    if (/^[A-Z]/.test(n.type) && !map.has(n.id)) fail(`${where}: holds a ${n.type} that does not resolve`)
  })
  for (const axis of entry.variants ?? []) {
    for (const option of axis.options) {
      walkNodes(def.root.children, (n) => {
        if (!n.variantClasses) return
        const worn = effectiveClasses(n, def, { [axis.name]: option }).split(/\s+/)
        if (new Set(worn).size !== worn.length) {
          fail(`${where}: ${axis.name}:${option} leaves a class on "${n.type}" twice`)
        }
      })
    }
  }

  // ids are unique AND fresh on every add (two projects must not share them)
  const again = materializeCatalogEntry(
    entry,
    project,
    (key) => project.components.find((c) => c.source === key) ?? null,
  )
  assert.notEqual(again.def.root.id, def.root.id, `${where}: ids must be minted per add`)

  // --- and the tree it produces has to validate ---
  // the entry's root stands in for the `:Name` instance an insert would land;
  // a library entry names no collection, so the data context is empty
  const diags = validateTree(def.root, {
    componentNames: project.components.map((c) => c.name),
    collectionNames: [],
    listFieldNames: [],
    dataOnlyCollections: [],
  })
  if (diags.length) fail(`${where}: ${diags.map((d) => d.message).join('; ')}`)
}

// adding the same entry twice must not collide on the component name
const project: Project = createProject('Twice') as unknown as Project
const first = materializeCatalogEntry(CATALOG[0]!, project)
project.components.push(first.def)
const second = materializeCatalogEntry(CATALOG[0]!, project)
assert.notEqual(second.def.name, first.def.name, 'a second add gets a distinct name')

// an existing token is reused, never duplicated or overwritten
const withToken: Project = createProject('Tokens') as unknown as Project
withToken.settings.tokens.push({ id: 'x', name: 'primary', value: '#ff0000' })
const reuse = materializeCatalogEntry(CATALOG.find((e) => e.tokens.includes('primary'))!, withToken)
assert.ok(!reuse.tokens.some((t) => t.name === 'primary'), 'an existing token is left alone')

if (failures) {
  console.error(`\n${failures} problem(s)`)
  process.exitCode = 1
} else {
  console.log(`\n${CATALOG.length} catalog entries OK`)
}
