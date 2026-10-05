import { test, expect } from '@playwright/test'
import { mcpSession, pageHtml } from './fixtures/mcpSession'

// The reads that returned nothing, or everything.
//
// E18: `get_page {ref}` scoped the HTML correctly and answered `elements: []`,
// so the one read meant to be targeted returned the markup and none of the
// addresses. E19: `elementIds` given a `#ref` filtered the summary down to
// nothing, silently. E20: `edit_structure`'s `elements` is documented as "the
// ops said what changed" and returned every row on the page.

const PAGE = [
  '<header data-ref="top" class="flex"><span>logo</span></header>',
  '<section data-ref="hero" class="p-8">',
  '  <h1 data-ref="title">T</h1>',
  '  <Card data-ref="promo" />',
  '</section>',
  '<footer data-ref="foot"><span>f</span></footer>',
].join('\n')

async function built() {
  const s = await mcpSession()
  await s.seed(['card'])
  const home = await s.home()
  await s.call('set_page_html', { pageId: home.id, html: pageHtml(PAGE), version: home.version })
  return { s, pageId: home.id }
}

test.describe('a subtree read', () => {
  test('by ref returns the subtree’s rows, not an empty list', async () => {
    const { s, pageId } = await built()
    const r = await s.call('get_page', { pageId, ref: 'hero' })
    const rows = r.elements as { ref?: string; type: string }[]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].ref).toBe('hero')
    expect(rows.map((e) => e.ref)).toContain('title')
    // and only the subtree: the header and footer are not in it
    expect(rows.map((e) => e.ref)).not.toContain('top')
    expect(rows.map((e) => e.ref)).not.toContain('foot')
  })

  test('by ref and by id agree', async () => {
    const { s, pageId } = await built()
    const full = await s.call('get_page', { pageId, elements: 'own' })
    const heroId = (full.elements as { ref?: string; id: string }[]).find((e) => e.ref === 'hero')!
      .id
    const byRef = await s.call('get_page', { pageId, ref: 'hero', elements: 'own' })
    const byId = await s.call('get_page', { pageId, id: heroId, elements: 'own' })
    expect(byRef.elements).toEqual(byId.elements)
    expect(byRef.html).toBe(byId.html)
  })

  test('ref-parts on a subtree lists that subtree’s instances', async () => {
    const { s, pageId } = await built()
    const r = await s.call('get_page', { pageId, ref: 'hero', elements: 'ref-parts' })
    const rows = r.elements as { ref?: string; parts?: unknown[] }[]
    expect(rows.map((e) => e.ref)).toEqual(['promo'])
    expect(rows[0].parts?.length).toBeGreaterThan(0)
  })

  test('a subtree address that matches nothing is refused, not emptied', async () => {
    const { s, pageId } = await built()
    await expect(s.call('get_page', { pageId, ref: 'nope' })).rejects.toThrow(/nope/)
  })
})

test.describe('elementIds', () => {
  test('takes a #ref, a short data-id and a full id alike', async () => {
    const { s, pageId } = await built()
    const full = await s.call('get_page', { pageId, elements: 'own' })
    const titleId = (full.elements as { ref?: string; id: string }[]).find(
      (e) => e.ref === 'title',
    )!.id
    const shortTop = /<header data-id="([0-9a-f]+)"/.exec(full.html)![1]

    const r = await s.call('get_page', { pageId, elementIds: ['hero', shortTop, titleId] })
    const rows = r.elements as { ref?: string; id: string }[]
    expect(rows).toHaveLength(3)
    expect(rows.map((e) => e.ref).sort()).toEqual(['hero', 'title', 'top'])
    expect(r.unknownIds).toBeUndefined()
  })

  test('an address that matches nothing is reported', async () => {
    const { s, pageId } = await built()
    const r = await s.call('get_page', { pageId, elementIds: ['hero', 'ghost'] })
    expect((r.elements as unknown[]).length).toBe(1)
    expect(r.unknownIds).toEqual(['ghost'])
  })
})

test.describe('edit_structure’s element summary', () => {
  test('is scoped to what the ops touched, plus the refs', async () => {
    const { s, pageId } = await built()
    const before = await s.call('get_page', { pageId, elements: 'none' })
    const whole = ((await s.call('get_page', { pageId, elements: 'refs' })).elements as unknown[])
      .length

    const r = await s.call('edit_structure', {
      pageId,
      version: before.version,
      ops: [
        {
          op: 'insert',
          parent: 'hero',
          html: '<div data-ref="box" class="mt-4"><p data-ref="line">x</p></div>',
        },
      ],
    })
    expect(r.saved).toBe(true)
    const rows = r.elements as { ref?: string; type: string }[]
    // the inserted block, whole
    expect(rows.map((e) => e.ref)).toContain('box')
    expect(rows.map((e) => e.ref)).toContain('line')
    // the refs stay, because they are the addresses the next call needs
    expect(rows.map((e) => e.ref)).toContain('top')
    // but not every row on the page: the untouched <span>s are gone
    expect(rows.length).toBeLessThan(whole)
    expect(rows.some((e) => e.type === 'span' && !e.ref)).toBe(false)
  })

  test('"own" still means the whole page', async () => {
    const { s, pageId } = await built()
    const before = await s.call('get_page', { pageId, elements: 'none' })
    const r = await s.call('edit_structure', {
      pageId,
      version: before.version,
      ops: [{ op: 'insert', parent: 'hero', html: '<p data-ref="line">x</p>' }],
      elements: 'own',
    })
    const rows = r.elements as { type: string; ref?: string }[]
    expect(rows.some((e) => e.ref === 'foot')).toBe(true)
    expect(rows.some((e) => e.type === 'span' && !e.ref)).toBe(true)
  })
})

// E24: a `refused` entry beside a bare `saved: true` reads as a clean success.
// `saved` says the store was written; `partial` says not all of it landed.
test.describe('partial-write semantics', () => {
  test('set_page_html says partial when something was refused', async () => {
    const s = await mcpSession()
    await s.seed(['card'])
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<Card data-ref="promo" />'),
      version: home.version,
    })
    const page = await s.home()
    // a class on an instance wrapper renders nowhere, so the writer refuses it
    const r = await s.call('set_page_html', {
      pageId: page.id,
      html: pageHtml('<Card data-ref="promo" class="mt-8" />\n<p data-ref="after">x</p>'),
      version: page.version,
      elements: 'none',
    })
    expect(r.saved).toBe(true)
    expect(r.partial).toBe(true)
    expect(JSON.stringify(r.refused)).toContain('class')
    // the rest of the page DID land, which is why `saved` is true
    const after = await s.call('get_page', { pageId: page.id, elements: 'none' })
    expect(after.html).toContain('data-ref="after"')
  })

  test('a clean write says nothing about partial', async () => {
    const s = await mcpSession()
    const home = await s.home()
    const r = await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<p data-ref="p">x</p>'),
      version: home.version,
      elements: 'none',
    })
    expect(r.saved).toBe(true)
    expect(r.partial).toBeUndefined()
    expect(r.refused).toBeUndefined()
  })
})
