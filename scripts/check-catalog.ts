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
import assert from 'node:assert'
import { CATALOG, CATALOG_TOKENS, materializeCatalogEntry } from '../src/lib/catalog'
import type { CatalogNode } from '../src/lib/catalog'
import { isValidClass, setStyleTokens } from '../src/lib/styles'
import { setColorTokens } from '../src/lib/colors'
import { serializeNode } from '../src/lib/components'
import { validateDocument } from '../src/lib/syntax'
import { isKnownElement } from '../src/lib/elements'
import { walkNodes } from '../src/lib/tree'
import { createProject } from '../src/lib/factories'
import type { Project } from '../src/types/editor'

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

  eachNode(entry.root, (node) => {
    if (!isKnownElement(node.type)) fail(`${where}: unknown element ":${node.type}"`)
    for (const cls of (node.classes ?? '').split(/\s+/).filter(Boolean)) {
      if (!isValidClass(cls)) fail(`${where}: "${cls}" is not a class the Style panel accepts`)
      // bg-primary / text-muted-foreground / border-border … must be declared.
      // LONGEST match: 'text-primary-foreground' ends with '-foreground' too.
      const token = names
        .filter((n) => cls.endsWith(`-${n}`))
        .sort((a, b) => b.length - a.length)[0]
      if (token && !declared.has(token)) fail(`${where}: uses "${cls}" but doesn't declare "${token}"`)
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

  // --- materialize into a fresh project and check the result ---
  const project: Project = createProject('Catalog check') as unknown as Project
  const made = materializeCatalogEntry(entry, project)
  assert.equal(made.def.name, entry.name)
  assert.equal(made.def.root.type, entry.name, `${where}: root type must equal the name`)
  assert.equal(made.def.source, entry.key)
  assert.equal(made.def.category, entry.category)
  assert.equal(made.def.root.children.length, 1, `${where}: exactly one root child`)
  assert.equal(
    made.tokens.length,
    new Set(entry.tokens).size,
    `${where}: a fresh project is missing every token it declares`,
  )

  // every symbolic target resolved to a real node id inside this tree
  const ids = new Set<string>()
  walkNodes([made.def.root], (n) => ids.add(n.id))
  walkNodes([made.def.root], (n) => {
    for (const b of n.interactions ?? []) {
      if (b.targetId && !ids.has(b.targetId)) {
        fail(`${where}: binding target ${b.targetId} is outside the component`)
      }
      if (!made.interactions.some((i) => i.id === b.interactionId)) {
        fail(`${where}: binding references an interaction that wasn't created`)
      }
    }
  })

  // ids are unique AND fresh on every add (two projects must not share them)
  const again = materializeCatalogEntry(entry, project)
  assert.notEqual(again.def.root.id, made.def.root.id, `${where}: ids must be minted per add`)

  // --- and the DSL it produces has to parse and validate ---
  const block = [
    `:${entry.name}`,
    ...made.def.root.children.flatMap((c) => serializeNode(c, '\t\t')),
    `${entry.name}:`,
  ]
  const doc = [
    '@setup',
    '\tname: Check',
    '\tslug: /check',
    '\tstatus: published',
    'setup@',
    ':body',
    `\t${block[0]}`,
    ...block.slice(1, -1),
    `\t${block[block.length - 1]}`,
    'body:',
  ].join('\n')
  const diags = validateDocument(doc, [entry.name], [], [], [])
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
