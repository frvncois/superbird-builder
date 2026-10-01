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
