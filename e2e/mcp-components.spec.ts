import { test, expect } from '@playwright/test'
// In-process, like mcp-tools-security: the toolset and its bundled runtime are
// plain ESM, driven against an in-memory store. No server, no browser, no
// login — so this spec cannot disturb smoke.spec's first-run flow.
// @ts-expect-error untyped package module
import { createToolSet } from '../packages/guano/mcp/tools.mjs'
// @ts-expect-error untyped server module
import { exportSite } from '../server/export.mjs'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// An agent building a site WITH components: what the project and the library
// offer, a page written as `:Name:` lines, and the component itself edited as
// the board edits it. The checks that matter read the published HTML — a tool
// reporting success for a write that renders nowhere is the bug class here.

const runtimePromise = import(
  /* @vite-ignore */ '../packages/guano/runtime/mcp-runtime.mjs' as string
).catch(() => null)

const page = (body: string) =>
  `@setup\n\tname: Home\n\tslug: /\n\tstatus: published\n\tlocale: en\n:body\n${body}\nbody:`

async function session() {
  const runtime = await runtimePromise
  test.skip(!runtime, 'runtime/mcp-runtime.mjs missing — run `npm run build:mcp-runtime`')
  const store = new Map([['guano-project:main', JSON.stringify(runtime.createProject('T'))]])
  const api = {
    base: 'http://localhost:4174',
    whoami: async () => ({ id: 'u1', email: 'a@b.c', role: 'admin', name: 'A' }),
    storeGetRaw: async (k: string) => store.get(k) ?? null,
    storeGetJson: async (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null),
    storePutRaw: async (k: string, v: string) => void store.set(k, v),
    publish: async () => ({ routes: 1, bytes: 1 }),
    mediaIndex: async () => ({ assets: [], folders: [] }),
    mediaUpload: async () => ({ id: 'm1' }),
  }
  const set = createToolSet({ api, runtime })
  set.setTarget('main')
  const call = (name: string, args: Record<string, unknown> = {}) =>
    set.toolMap.get(name)!.handler(args)
  const stored = () => JSON.parse(store.get('guano-project:main')!)
  const html = async () => {
    const dir = mkdtempSync(join(tmpdir(), 'guano-mcp-'))
    try {
      await exportSite(stored(), dir)
      const out = readFileSync(join(dir, 'index.html'), 'utf8')
      return out.slice(out.indexOf('<body'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  const home = async () => (await call('list_pages')).pages[0]
  return { call, stored, html, home }
}

test('the library is listed, copied in by key or name, and never copied twice', async () => {
  const { call, stored } = await session()

  const library = await call('list_library')
  expect(library.library.length).toBeGreaterThan(30)
  expect(library.library.every((e: { added: boolean }) => e.added === false)).toBe(true)
  // looking — even in detail — adds nothing
  const detail = await call('list_library', { keys: ['card'] })
  expect(detail.library[0].structure).toContain(':Button')
  expect(stored().components).toEqual([])

  // a card holds a button: it comes along, with the tokens both name
  const added = await call('add_library_components', { keys: ['card', 'PricingCard', 'nope'] })
  expect(added.added.map((a: { name: string }) => a.name)).toEqual(
    expect.arrayContaining(['Button', 'Card', 'PricingCard']),
  )
  expect(added.tokensAdded).toContain('primary')
  expect(added.failures).toHaveLength(1)
  expect(stored().components.filter((c: { name: string }) => c.name === 'Button')).toHaveLength(1)

  const again = await call('add_library_components', { keys: ['button'] })
  expect(again.saved).toBe(false)
  expect(again.alreadyInProject[0].name).toBe('Button')

  // a token the project already has is the project's
  const before = stored().settings.tokens.find((t: { name: string }) => t.name === 'primary').value
  await call('add_library_components', { keys: ['badge'] })
  expect(stored().settings.tokens.filter((t: { name: string }) => t.name === 'primary')).toHaveLength(1)
  expect(stored().settings.tokens.find((t: { name: string }) => t.name === 'primary').value).toBe(before)
})

test('an unknown component the library has says how to get it', async () => {
  const { call, home } = await session()
  const h = await home()
  const refused = await call('set_page_code', { pageId: h.id, version: h.version, code: page('\t:Hero:') })
  expect(refused.saved).toBe(false)
  expect(refused.diagnostics[0].message).toContain('add_library_components {keys: ["hero"]}')
})

test('an instance written with a ref expands, and lists the parts to fill', async () => {
  const { call, home, html } = await session()
  await call('add_library_components', { keys: ['card'] })
  const h = await home()
  const written = await call('set_page_code', {
    pageId: h.id,
    version: h.version,
    code: page('\t:Button#cta:\n\t:Card#one:'),
  })
  expect(written.saved).toBe(true)
  const cta = written.elements.find((e: { ref?: string }) => e.ref === 'cta')
  const one = written.elements.find((e: { ref?: string }) => e.ref === 'one')
  // `:Button#cta:` used to be stored as an empty leaf — the ref defeated the expansion
  expect(cta.childCount).toBeGreaterThan(0)
  const part = (row: { parts: { type: string; id: string; hidden?: boolean; hiddenBy?: string }[] }, type: string) =>
    row.parts.find((p) => p.type === type)!
  // the card's button sits in a footer the component hides until asked
  expect(part(one, 'Button').hidden).toBe(true)
  expect(part(one, 'Button').hiddenBy).toBeTruthy()

  const edited = await call('edit_elements', {
    pageId: h.id,
    version: written.version,
    edits: [
      { ref: 'cta', variants: { variant: 'outline' } },
      { id: part(cta, 'span').id, content: 'Get started' },
      { id: part(one, 'h3').id, content: 'First card' },
      { id: part(one, 'span').id, content: 'Read more' },
      { id: part(one, 'Button').hiddenBy, hidden: false },
    ],
  })
  expect(edited.failed).toBe(0)

  const out = await html()
  expect(out).toContain('>Get started<')
  expect(out).toContain('>First card<')
  expect(out).toContain('>Read more<')
  expect(out).toContain('border-input') // the outline option, worn
})

test("an instance's own line takes no classes or bindings", async () => {
  const { call, home, stored, html } = await session()
  await call('add_library_components', { keys: ['card'] })
  const h = await home()
  const written = await call('set_page_code', {
    pageId: h.id,
    version: h.version,
    code: page('\t:Button#cta:\n\t:Card#one:'),
  })
  const one = written.elements.find((e: { ref?: string }) => e.ref === 'one')
  const nested = one.parts.find((p: { type: string }) => p.type === 'Button')

  const edited = await call('edit_elements', {
    pageId: h.id,
    version: written.version,
    edits: [
      // on the page node this rendered nowhere while reporting success…
      { ref: 'cta', addClasses: ['mt-8'] },
      // …and on a nested one it landed on Button's root: a box around every button
      { id: nested.id, addClasses: ['w-full'] },
    ],
  })
  expect(edited.failed).toBe(2)
  expect(JSON.stringify(edited.failures)).toContain('wrap the instance in a :div')

  const button = stored().components.find((c: { name: string }) => c.name === 'Button')
  expect(button.root.classes).toBeUndefined()
  expect(await html()).not.toContain('w-full')
})

test('a component is written from scratch, and edited as the board edits it', async () => {
  const { call, home, stored, html } = await session()
  await call('add_library_components', { keys: ['button'] })

  const made = await call('create_component', {
    name: 'promo',
    category: 'Sections',
    code: ':section\n\t:h2:\n\t:Button:\nsection:',
  })
  expect(made.saved).toBe(true)
  expect(made.name).toBe('Promo')
  const node = (type: string) => made.nodes.find((n: { type: string }) => n.type === type)
  expect(node('span').in).toBe('Button')

  // no page holds an instance yet: the component is addressed directly
  const styled = await call('edit_elements', {
    componentId: made.componentId,
    verbose: true,
    edits: [
      { id: node('section').id, addClasses: ['py-12'] },
      { id: node('h2').id, content: 'Launch week' },
      // what Promo says about ITS button — not what Button says
      { id: node('span').id, content: 'Join' },
      { id: node('Button').id, variants: { variant: 'secondary' } },
      // a look is Button's, whoever it was reached through
      { id: node('button').id, addClasses: ['rounded-full'] },
      // and a binding in there would be Button's too
      { id: node('button').id, bindInteractions: [{ interactionId: 'x', trigger: 'click' }] },
    ],
  })
  expect(styled.failed).toBe(1)
  expect(JSON.stringify(styled.results)).toContain('what Promo says about its Button')
  expect(JSON.stringify(styled.failures)).toContain('Wrap the instance')

  const button = stored().components.find((c: { name: string }) => c.name === 'Button')
  expect(button.root.children[0].classes).toContain('rounded-full')
  expect(button.root.children[0].children[1].content).toBe('Button')

  const h = await home()
  const written = await call('set_page_code', {
    pageId: h.id,
    version: h.version,
    code: page('\t:Promo:\n\t:Button:'),
  })
  expect(written.saved).toBe(true)
  const out = await html()
  expect(out).toContain('>Launch week<')
  expect(out).toContain('>Join<') // Promo's button
  expect(out).toContain('>Button<') // a button of its own
  expect(out).toContain('py-12')
})

test('rename, duplicate, detach and delete keep every page in step', async () => {
  const { call, home, stored, html } = await session()
  const added = await call('add_library_components', { keys: ['card'] })
  const card = added.added.find((a: { name: string }) => a.name === 'Card')
  const h = await home()
  let written = await call('set_page_code', {
    pageId: h.id,
    version: h.version,
    code: page('\t:Card#one:\n\t:Card#two:'),
  })

  const renamed = await call('update_component', { componentId: card.componentId, name: 'tile', category: 'Cards' })
  expect(renamed.renamed).toEqual({ from: 'Card', to: 'Tile' })
  expect(renamed.versions).toHaveLength(1)
  expect(stored().pages[0].code).toContain(':Tile#one')
  expect(stored().pages[0].code).not.toContain('Card')

  const copy = await call('duplicate_component', { componentId: card.componentId, name: 'WideTile' })
  expect(copy.name).toBe('WideTile')

  const detached = await call('detach_instance', {
    pageId: h.id,
    version: renamed.versions[0].version,
    ref: 'two',
  })
  expect(detached.saved).toBe(true)
  expect(stored().pages[0].code.match(/:Tile/g)).toHaveLength(1)

  // still used once: refused, then detached and deleted
  const refused = await call('delete_component', { componentId: card.componentId })
  expect(refused.reason).toBe('in-use')
  const deleted = await call('delete_component', { componentId: card.componentId, detach: true })
  expect(deleted.detached).toBe(1)
  expect(stored().pages[0].code).not.toContain('Tile')

  // both cards are still on the page, as plain elements
  const out = await html()
  expect(out.match(/>Card title</g)).toHaveLength(2)
  written = await call('get_page', { pageId: h.id })
  // always present, so "clean" and "nobody checked" are different answers
  expect(written.diagnostics).toEqual([])
})

test('a list keeps its filter inside a component, and an instance can narrow it', async () => {
  const { call, home, html } = await session()
  const col = await call('create_collection', { name: 'conversation' })
  await call('update_collection', { collectionId: col.collection.id, addFields: [{ name: 'status', type: 'text' }] })
  await call('upsert_entries', {
    collectionId: col.collection.id,
    entries: [
      { name: 'A', values: { title: 'Alpha', status: 'active' } },
      { name: 'B', values: { title: 'Beta', status: 'waiting' } },
    ],
  })
  const h = await home()
  let w = await call('set_page_code', {
    pageId: h.id,
    version: h.version,
    code: page('\t:div#inbox\n\t\t:collection-list#list[conversation]\n\t\t\t:h3[title]:\n\t\tcollection-list:\n\tdiv:'),
  })
  await call('edit_elements', {
    pageId: h.id,
    version: w.version,
    edits: [{ ref: 'list', listQuery: { filter: { field: 'status', equals: 'active' } } }],
  })
  w = await call('get_page', { pageId: h.id, elements: 'refs' })
  const made = await call('create_component', {
    pageId: h.id,
    id: w.elements.find((e: { ref?: string }) => e.ref === 'inbox').id,
    name: 'Inbox',
    version: w.version,
  })
  expect(made.saved).toBe(true)
  // the filter moved to the master with the rest of the node state — and used
  // to be ignored there by every renderer
  let out = await html()
  expect(out).toContain('Alpha')
  expect(out).not.toContain('Beta')
  const inbox = (await call('list_components', { names: ['Inbox'], includeNodes: true })).components[0]
  expect(inbox.nodes.find((n: { type: string }) => n.type === 'collection-list').listQuery).toBeTruthy()

  // an instance's own filter wins over the component's default
  w = await call('get_page', { pageId: h.id, elements: 'all' })
  const list = w.elements.find((e: { type: string }) => e.type === 'collection-list')
  await call('edit_elements', {
    pageId: h.id,
    version: w.version,
    edits: [{ id: list.id, listQuery: { filter: { field: 'status', equals: 'waiting' } } }],
  })
  out = await html()
  expect(out).toContain('Beta')
  expect(out).not.toContain('Alpha')

  // a field binding on the component's element is structure: every instance follows
  const h3 = inbox.nodes.find((n: { type: string }) => n.type === 'h3')
  const arg = await call('edit_elements', { componentId: inbox.id, edits: [{ id: h3.id, arg: 'status' }] })
  expect(arg.failed).toBe(0)
  expect(arg.alsoTouched).toHaveLength(1)
  expect(await html()).toContain('>waiting<')
})

test("an instance wears the default even when its host picked otherwise", async () => {
  const { call, home, html } = await session()
  await call('add_library_components', { keys: ['button'] })
  const card = await call('create_component', { name: 'Card', code: ':div\n\t:Button:\ndiv:' })
  const mirror = card.nodes.find((n: { type: string }) => n.type === 'Button')
  await call('edit_elements', { componentId: card.componentId, edits: [{ id: mirror.id, variants: { variant: 'outline' } }] })
  const h = await home()
  const w = await call('set_page_code', { pageId: h.id, version: h.version, code: page('\t:Card#c1:\n\t:Card#c2:') })
  const c2 = w.elements.find((e: { ref?: string }) => e.ref === 'c2').parts.find((p: { type: string }) => p.type === 'Button')
  await call('edit_elements', { pageId: h.id, version: w.version, edits: [{ id: c2.id, variants: { variant: 'default' } }] })
  const looks = [...(await html()).matchAll(/<button class="([^"]*)"/g)].map((m) =>
    m[1].includes('border-input') ? 'outline' : 'default',
  )
  expect(looks).toEqual(['outline', 'default'])
})

test('what a host cannot say about an instance is refused, not dropped', async () => {
  const { call, home } = await session()
  await call('add_library_components', { keys: ['button'] })
  const card = await call('create_component', { name: 'Card', code: ':div\n\t:Button:\ndiv:' })

  // a link on the instance's own line renders nowhere
  const h = await home()
  const link = await call('set_page_code', { pageId: h.id, version: h.version, code: page('\t:Card#c1:@/messages') })
  expect(link.saved).toBe(false)
  expect(link.diagnostics[0].message).toContain(":div@/messages")

  // a binding inside the nested block would be Button's — it used to be stripped silently
  const nested = await call('update_component', {
    componentId: card.componentId,
    code: ':Card\n\t:div\n\t\t:Button\n\t\t\t:button\n\t\t\t\t:icon:\n\t\t\t\t:span[title]:\n\t\t\t\t:icon:\n\t\t\tbutton:\n\t\tButton:\n\tdiv:\nCard:',
  })
  expect(nested.saved).toBe(false)
  expect(nested.message).toContain("Button's")

  // and the same through an arg edit on the mirror
  const span = card.nodes.find((n: { type: string }) => n.type === 'span')
  const arg = await call('edit_elements', { componentId: card.componentId, edits: [{ id: span.id, arg: 'title' }] })
  expect(arg.failed).toBe(1)
  expect(arg.failures[0].errors[0]).toContain('every Button everywhere')
})

test('publish warns about what a design review would send back', async () => {
  const { call, home } = await session()
  await call('add_library_components', { keys: ['select', 'navbar'] })
  await call('create_interaction', { name: 'Never bound', toClasses: 'hidden' })
  await call('update_settings', { motion: { transitions: { enabled: true, preset: 'fade' } } })
  const h = await home()
  const w = await call('set_page_code', {
    pageId: h.id,
    version: h.version,
    code: page('\t:Navbar:\n\t:Select:\n\t:select#raw\n\t\t:option:\n\tselect:'),
  })
  await call('edit_elements', { pageId: h.id, version: w.version, edits: [{ ref: 'raw', addClasses: ['h-9', 'rounded-lg'] }] })
  await call('create_page', { name: 'Two', slug: '/two' })
  const two = (await call('list_pages')).pages.find((p: { name: string }) => p.name === 'Two')
  await call('set_page_code', { pageId: two.id, version: two.version, code: page('\t:Navbar:') })

  const kinds = (await call('publish')).warnings.map((x: { kind: string }) => x.kind)
  // the raw select, not the library one (it has appearance-none and a drawn chevron)
  const native = (await call('publish')).warnings.find((x: { kind: string }) => x.kind === 'native-select')
  expect(native.message).toContain('1 :select')
  // the navbar is sticky and on every page: a body transition blinks it
  expect(kinds).toContain('body-transition-under-app-shell')
  expect(kinds).toContain('unused-effects')
  expect(kinds).not.toContain('unstyled-controls')
})
