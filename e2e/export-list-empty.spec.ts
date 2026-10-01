import { test, expect } from '@playwright/test'
import { mcpSession, pageCode } from './fixtures/mcpSession'

// `:list-empty` is a list's empty state: a direct child that renders only when
// there is nothing to repeat, and is never repeated itself.
//
// Without it a list that matched nothing rendered as a blank gap. The Cocoapp
// review flagged exactly this ("Empty and loading states for every list" is a
// design standard the tools could not express), and the closed conversation that
// appeared in no tab had no "nothing here" to show either.

test.describe('a list’s empty state', () => {
  async function page(code: string, entries: { name: string }[]) {
    const s = await mcpSession()
    const c = (await s.call('create_collection', { name: 'item', detailRoutes: false }))
      .collection
    if (entries.length) await s.call('upsert_entries', { collectionId: c.id, entries })
    const home = await s.home()
    const r = await s.call('set_page_code', {
      pageId: home.id,
      code: pageCode(code),
      version: home.version,
    })
    return { s, r }
  }

  const LIST = [
    '\t:collection-list#rows[item]',
    '\t\t:paragraph#row:',
    '\t\t:list-empty#none',
    '\t\t\t:text#noneText:',
    '\t\tlist-empty:',
    '\tcollection-list:',
  ].join('\n')

  test('it renders when the list is empty, and not when it is not', async () => {
    const withEntries = await page(LIST, [{ name: 'One' }, { name: 'Two' }])
    expect(withEntries.r.saved).toBe(true)
    let after = await withEntries.s.home()
    await withEntries.s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [
        { ref: 'row', content: 'A row' },
        { ref: 'none', addClasses: ['italic'] },
      ],
    })
    let html = await withEntries.s.html()
    expect((html.match(/A row/g) ?? []).length).toBe(2)
    expect(html).not.toContain('italic')

    const noEntries = await page(LIST, [])
    after = await noEntries.s.home()
    await noEntries.s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [
        { ref: 'row', content: 'A row' },
        { ref: 'none', addClasses: ['italic'] },
      ],
    })
    html = await noEntries.s.html()
    // the empty block renders, and the row template does NOT
    expect(html).toContain('italic')
    expect(html).not.toContain('A row')
  })

  test('it is never repeated, even when the list has entries', async () => {
    const { s } = await page(LIST, [{ name: 'One' }, { name: 'Two' }, { name: 'Three' }])
    const after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [{ ref: 'none', addClasses: ['border-dashed'] }],
    })
    const html = await s.html()
    expect((html.match(/border-dashed/g) ?? []).length).toBe(0)
  })

  test('a filter that matches nothing shows it, which is the whole point', async () => {
    const s = await mcpSession()
    const c = (await s.call('create_collection', { name: 'item', detailRoutes: false }))
      .collection
    await s.call('update_collection', {
      collectionId: c.id,
      addFields: [{ name: 'status', type: 'text' }],
    })
    await s.call('upsert_entries', {
      collectionId: c.id,
      entries: [{ name: 'One', values: { status: 'active' } }],
    })
    const home = await s.home()
    await s.call('set_page_code', { pageId: home.id, code: pageCode(LIST), version: home.version })
    const after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [
        { ref: 'rows', listQuery: { filter: { field: 'status', equals: 'closed' } } },
        { ref: 'row', content: 'A row' },
        { ref: 'noneText', content: 'No closed conversations' },
      ],
    })
    const html = await s.html()
    expect(html).toContain('No closed conversations')
    expect(html).not.toContain('A row')
  })

  test('written outside a list it is refused with a diagnostic', async () => {
    const { r } = await page('\t:list-empty#none\n\t\t:text:\n\tlist-empty:', [])
    expect(r.saved).toBe(false)
    expect(JSON.stringify(r.diagnostics)).toContain('empty state')
  })
})
