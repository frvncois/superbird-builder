import { test, expect } from '@playwright/test'
import { mcpSession, pageCode } from './fixtures/mcpSession'

// The tool CONTRACTS an agent depends on, driven in-process. Every case here
// comes from something that cost the Cocoapp session real calls: a response too
// big to read, a key that is absent when it should be an empty array, a whole
// list resent to add one item, a batch form that exists for one tool and not
// its twin.

test.describe('get_guide', () => {
  test('a bare call returns the rules and the map, not the whole handbook', async () => {
    const s = await mcpSession()
    const bare = await s.call('get_guide')
    // the first call of the Cocoapp session came back "exceeds maximum allowed
    // tokens" and cost four more calls to recover before any work started
    expect(JSON.stringify(bare).length).toBeLessThan(12_000)
    expect(bare.goldenRules).toContain('## The golden rules')
    expect(bare.sections.length).toBeGreaterThan(10)
    expect(bare.next).toContain('get_guide')
  })

  test('the whole handbook is still reachable, and one section stays one section', async () => {
    const s = await mcpSession()
    const all = await s.call('get_guide', { section: 'all' })
    expect(all.guide).toContain('<!-- guano handbook')
    expect(all.guide.length).toBeGreaterThan(50_000)

    const one = await s.call('get_guide', { section: 'animations' })
    expect(one.guide).toContain('## Animations')
    expect(one.guide.length).toBeLessThan(all.guide.length / 4)

    // asking for the toc explicitly gets the map alone
    const toc = await s.call('get_guide', { section: 'toc' })
    expect('goldenRules' in toc).toBe(false)
  })

  test('the described size is computed, not a stale number in prose', async () => {
    const s = await mcpSession()
    const claimed = Number(/(\d+) KB/.exec(s.tool('get_guide').description)![1])
    const actual = Math.round((await s.call('get_guide', { section: 'all' })).guide.length / 1024)
    expect(Math.abs(claimed - actual)).toBeLessThanOrEqual(1)
  })
})

test.describe('get_page', () => {
  test('diagnostics is always present, so "clean" and "not checked" differ', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_code', {
      pageId: home.id,
      code: pageCode('\t:h1:'),
      version: home.version,
    })
    const page = await s.call('get_page', { pageId: home.id, elements: 'none' })
    // the key used to be omitted when empty, so a validated page and an
    // unvalidated one read identically
    expect(page.diagnostics).toEqual([])
  })
})

test.describe('component node rows', () => {
  test('add_library_components reports a node’s attributes, like list_components does', async () => {
    const s = await mcpSession()
    const added = await s.call('add_library_components', { keys: ['input'], includeNodes: true })
    const row = added.added[0].nodes.find((n: { type: string }) => n.type === 'input')
    // the two row shapes had drifted: list_components reported `attributes` and
    // add_library_components did not, so a field copied from the library kept
    // the entry's own demo placeholder and nobody saw it until a screenshot
    expect(row.attributes).toEqual({ type: 'text' })

    const listed = await s.call('list_components', { names: ['Input'], includeNodes: true })
    const same = listed.components[0].nodes.find((n: { type: string }) => n.type === 'input')
    expect(same.attributes).toEqual(row.attributes)
  })

  test('list_components keeps the full binding view the other rows summarize', async () => {
    const s = await mcpSession()
    await s.call('add_library_components', { keys: ['sheet'] })
    const listed = await s.call('list_components', { names: ['Sheet'], includeNodes: true })
    const bound = listed.components[0].nodes.filter((n: { interactions?: unknown[] }) => n.interactions?.length)
    expect(bound.length).toBeGreaterThan(0)
    expect(bound[0].interactions[0]).toHaveProperty('bindingId')
    expect(bound[0].interactions[0]).toHaveProperty('trigger')
  })

  test('the library reports the interactions it added by name, not as a count', async () => {
    const s = await mcpSession()
    const added = await s.call('add_library_components', { keys: ['sheet'] })
    // a bare `interactionsAdded: 2` named nothing an agent could then rename,
    // rebind or delete
    expect(Array.isArray(added.interactionsAdded)).toBe(true)
    expect(added.interactionsAdded[0]).toHaveProperty('id')
    expect(added.interactionsAdded.map((i: { name: string }) => i.name).join(' ')).toContain('Sheet')
  })
})

test.describe('design tokens', () => {
  test('addTokens adds without resending the whole palette', async () => {
    const s = await mcpSession()
    await s.call('update_settings', {
      tokens: [
        { name: 'brand', value: '#0D594A' },
        { name: 'cream', value: '#FFEDA6' },
      ],
    })
    // the session resent all 27 tokens to add two, because `tokens` replaces
    const r = await s.call('update_settings', { addTokens: [{ name: 'ink', value: '#111111' }] })
    expect(r.saved).toBe(true)
    expect(r.tokensChanged).toEqual({ added: ['ink'] })
    expect(r.tokens.map((t: { name: string }) => t.name).sort()).toEqual(['brand', 'cream', 'ink'])
  })

  test('addTokens re-values an existing token and keeps its id', async () => {
    const s = await mcpSession()
    await s.call('update_settings', { tokens: [{ name: 'brand', value: '#000000' }] })
    const before = s.stored().settings.tokens[0].id
    await s.call('update_settings', { addTokens: [{ name: 'brand', value: '#0D594A' }] })
    const after = s.stored().settings.tokens
    expect(after).toHaveLength(1)
    expect(after[0].value).toBe('#0D594A')
    expect(after[0].id).toBe(before) // same id, so merges stay quiet
  })

  test('removing a token that still styles something is refused, and says where', async () => {
    const s = await mcpSession()
    await s.call('update_settings', { tokens: [{ name: 'brand', value: '#0D594A' }] })
    const home = await s.home()
    await s.call('set_page_code', {
      pageId: home.id,
      code: pageCode('\t:h1#title:'),
      version: home.version,
    })
    const after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [{ ref: 'title', addClasses: ['bg-brand'] }],
    })

    const refused = await s.call('update_settings', { removeTokens: ['brand'] })
    expect(refused.saved).toBe(false)
    expect(refused.reason).toBe('tokens-in-use')
    expect(refused.inUse[0].token).toBe('brand')
    expect(refused.inUse[0].where).toContain('page')
    expect(s.stored().settings.tokens).toHaveLength(1) // nothing written

    const forced = await s.call('update_settings', { removeTokens: ['brand'], forcePurge: true })
    expect(forced.saved).toBe(true)
    expect(forced.tokens).toHaveLength(0)
  })

  test('an unused token is removed without ceremony', async () => {
    const s = await mcpSession()
    await s.call('update_settings', {
      tokens: [
        { name: 'brand', value: '#0D594A' },
        { name: 'unused', value: '#FFFFFF' },
      ],
    })
    const r = await s.call('update_settings', { removeTokens: ['unused'] })
    expect(r.saved).toBe(true)
    expect(r.tokensChanged).toEqual({ added: [], removed: ['unused'] })
    expect(r.tokens.map((t: { name: string }) => t.name)).toEqual(['brand'])
  })
})

test.describe('create_interactions', () => {
  test('a batch is one write, and reports each item', async () => {
    const s = await mcpSession()
    // a sliding sheet needs two effects and a tab strip four; the session made
    // eight one call at a time because only the animation side had a batch form
    const r = await s.call('create_interactions', {
      items: [
        { name: 'Sheet · open', toClasses: 'visible opacity-100' },
        { name: 'Sheet · slide in', toClasses: 'translate-x-0 translate-y-0' },
        { name: 'Tab · active', toClasses: 'bg-white', duration: 'duration-200' },
      ],
    })
    expect(r.saved).toBe(true)
    expect(r.created).toHaveLength(3)
    expect(r.failures).toBeUndefined()
    expect(s.stored().interactions).toHaveLength(3)
    expect(r.created[2].duration).toBe('duration-200')
    expect(r.created[0].duration).toBe('duration-300') // the default still applies
  })

  test('one bad item fails on its own and the rest are saved', async () => {
    const s = await mcpSession()
    const r = await s.call('create_interactions', {
      items: [
        { name: 'Good', toClasses: 'flex' },
        { name: 'Bad', toClasses: 'not-a-real-class' },
        { name: '', toClasses: 'flex' },
      ],
    })
    expect(r.saved).toBe(true)
    expect(r.created.map((i: { name: string }) => i.name)).toEqual(['Good'])
    expect(r.failures).toHaveLength(2)
    expect(r.failures[0].errors[0]).toContain('not-a-real-class')
    expect(r.failures[1].errors[0]).toContain('name')
    expect(s.stored().interactions).toHaveLength(1)
  })
})

test.describe('extracting a component', () => {
  test('create_component takes a ref, and reports the master’s nodes', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_code', {
      pageId: home.id,
      code: pageCode('\t:div#card\n\t\t:h3:\n\t\t:paragraph:\n\tdiv:'),
      version: home.version,
    })
    const after = await s.home()
    // the usual way to build a big component is to write it on a page with refs
    // and style it by ref — and then an id had to be fetched with a get_page
    // whose only purpose was this call
    const made = await s.call('create_component', {
      pageId: after.id,
      ref: 'card',
      name: 'Card',
      version: after.version,
    })
    expect(made.saved).toBe(true)
    expect(made.name).toBe('Card')
    // the addresses to style it with, which only the `code` path used to return
    // the extracted element stays inside the master, under the :Card root
    expect(made.nodes.map((n: { type: string }) => n.type)).toEqual(['Card', 'div', 'h3', 'paragraph'])
    expect(made.nodes[0].root).toBe(true)
    expect(s.stored().pages[0].code).toContain(':Card')
  })

  test('an unknown ref is refused by name, not by throwing', async () => {
    const s = await mcpSession()
    const home = await s.home()
    const r = await s.call('create_component', {
      pageId: home.id,
      ref: 'nope',
      name: 'Card',
      version: home.version,
    })
    expect(r.saved).toBe(false)
    expect(r.reason).toBe('no-such-ref')
    expect(r.message).toContain('#nope')
  })

  test('create_components resolves each item’s ref as the batch rewrites the page', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_code', {
      pageId: home.id,
      code: pageCode('\t:header#top\n\t\t:h1:\n\theader:\n\t:footer#bottom\n\t\t:span:\n\tfooter:'),
      version: home.version,
    })
    const after = await s.home()
    const r = await s.call('create_components', {
      items: [
        { pageId: after.id, ref: 'top', name: 'SiteHeader' },
        { pageId: after.id, ref: 'bottom', name: 'SiteFooter' },
      ],
      versions: [{ pageId: after.id, version: after.version }],
    })
    expect(r.saved).toBe(true)
    expect(r.created).toBe(2)
    const code = s.stored().pages[0].code
    expect(code).toContain(':SiteHeader')
    expect(code).toContain(':SiteFooter')
  })
})
