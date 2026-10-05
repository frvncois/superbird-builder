import { test, expect } from '@playwright/test'
import { mcpSession, pageHtml } from './fixtures/mcpSession'

// E3 / E38 / E5: `link` is per-instance with a component default, so what a
// HOST says about a nested instance belongs on its mirror — and `MIRROR_KEYS`
// did not carry it while both renderers read `node.link ?? master.link`,
// skipping the mirror layer entirely. The write was stored, `edit_elements` and
// `publish` both reported success, and the published page had no href at all.
// Then detach dropped it too, because `bakeMasterState` copied content, src,
// background and locales and nothing else a renderer resolves own-first.
//
// Everything here is checked against the EXPORTED HTML.

test.describe('a host’s link on a nested instance', () => {
  test('renders, per row, on the published page', async () => {
    const s = await mcpSession()
    await s.seed(['card'])
    // ProjectRow holds Button; the host — not Button — says where it goes
    const row = await s.call('create_component', {
      name: 'ProjectRow',
      html: '<div class="flex gap-2"><span data-field="title" /><Button /></div>',
    })
    const btn = /<button data-id="([0-9a-f]+)"/.exec(row.html)![1]
    const edit = await s.call('edit_elements', {
      componentId: row.componentId,
      edits: [{ id: btn, link: '@item' }],
    })
    expect(edit.saved).toBe(true)
    expect(edit.edited).toBe(1)

    const col = (await s.call('create_collection', { name: 'project' })).collection
    await s.call('upsert_entries', {
      collectionId: col.id,
      entries: [{ name: 'Alpha' }, { name: 'Beta' }],
    })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<collection-list source="project">\n  <ProjectRow />\n</collection-list>'),
      version: home.version,
    })

    const html = await s.html()
    // '@item' resolves per entry, so each row's button points at its own page
    expect(html).toContain('href="/project/alpha"')
    expect(html).toContain('href="/project/beta"')
  })

  test('a plain destination on the mirror beats the component’s own', async () => {
    const s = await mcpSession()
    const inner = await s.call('create_component', {
      name: 'NavLink',
      html: '<a class="underline" href="/home"><span>Home</span></a>',
    })
    const host = await s.call('create_component', {
      name: 'NavItem',
      html: '<li><NavLink /></li>',
    })
    const mirrorAnchor = /<a data-id="([0-9a-f]+)"/.exec(host.html)![1]
    await s.call('edit_elements', {
      componentId: host.componentId,
      edits: [{ id: mirrorAnchor, link: '/nav-b' }],
    })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<ul><NavItem /></ul>'),
      version: home.version,
    })
    const html = await s.html()
    expect(html).toContain('href="/nav-b"')
    expect(html).not.toContain('href="/home"')
    // and the inner component's own default still reaches a placement that
    // does NOT override it
    expect(inner.componentId).toBeTruthy()
    const after = await s.home()
    await s.call('set_page_html', {
      pageId: after.id,
      html: pageHtml('<ul><NavItem /></ul>\n<NavLink />'),
      version: after.version,
    })
    const both = await s.html()
    expect(both).toContain('href="/nav-b"')
    expect(both).toContain('href="/home"')
  })
})

test.describe('detaching keeps every resolved per-instance value', () => {
  test('nine links survive delete_component {detach}', async () => {
    const s = await mcpSession()
    const home = await s.home()
    const links = Array.from(
      { length: 9 },
      (_, i) => `  <a data-ref="nav-${i}" href="/p${i}" class="block"><span>Page ${i}</span></a>`,
    ).join('\n')
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml(`<nav data-ref="sidebar" class="w-64">\n${links}\n</nav>`),
      version: home.version,
    })

    // extract each link into a NavItem, the way the Harbour run did
    const page = await s.call('get_page', { pageId: home.id, elements: 'refs' })
    const items = (page.elements as { ref?: string }[])
      .filter((e) => e.ref?.startsWith('nav-'))
      .map((e, i) => ({ pageId: home.id, ref: e.ref, name: `NavItem${i}` }))
    expect(items).toHaveLength(9)
    const made = await s.call('create_components', {
      items,
      versions: [{ pageId: home.id, version: page.version }],
    })
    expect(made.saved).toBe(true)
    expect(made.created).toBe(9)

    // every link still renders while they are components…
    const asComponents = await s.html()
    for (let i = 0; i < 9; i++) expect(asComponents).toContain(`href="/p${i}"`)

    // …and still renders after each component is deleted with detach
    for (const c of made.components as { componentId: string }[]) {
      const r = await s.call('delete_component', { componentId: c.componentId, detach: true })
      expect(r.saved).toBe(true)
    }
    const detached = await s.html()
    for (let i = 0; i < 9; i++) expect(detached).toContain(`href="/p${i}"`)
    // the refs were ON the extracted blocks, so they hoisted onto the wrappers
    // and came back on detach — they are still the page's addresses
    const back = await s.call('get_page', { pageId: home.id, elements: 'refs' })
    expect((back.elements as { ref?: string }[]).filter((e) => e.ref?.startsWith('nav-'))).toHaveLength(9)
  })

  test('detach_instance keeps the link, the filter and the slider config', async () => {
    const s = await mcpSession()
    const col = (await s.call('create_collection', { name: 'post' })).collection
    await s.call('upsert_entries', {
      collectionId: col.id,
      entries: [{ name: 'One' }, { name: 'Two' }],
    })
    const feed = await s.call('create_component', {
      name: 'Feed',
      html: '<div><collection-list source="post"><a href="@item"><span data-field="title" /></a></collection-list></div>',
    })
    const listId = /<collection-list data-id="([0-9a-f]+)"/.exec(feed.html)![1]
    await s.call('edit_elements', {
      componentId: feed.componentId,
      edits: [{ id: listId, listQuery: { limit: 1 } }],
    })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<Feed data-ref="feed" />'),
      version: home.version,
    })
    const before = await s.html()
    expect(before.match(/href="\/post\//g) ?? []).toHaveLength(1) // the limit applies

    const after = await s.home()
    const r = await s.call('detach_instance', {
      pageId: after.id,
      ref: 'feed',
      version: after.version,
    })
    expect(r.saved).toBe(true)
    const detached = await s.html()
    // the filter and the per-entry link both came across
    expect(detached.match(/href="\/post\//g) ?? []).toHaveLength(1)
    expect(detached).toContain('href="/post/one"')
  })

  test('a detach says what it could not carry across', async () => {
    const s = await mcpSession()
    await s.seed(['button']) // Button has `variant` and `size` axes
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<Button data-ref="cta" />'),
      version: home.version,
    })
    const page = await s.home()
    const r = await s.call('detach_instance', {
      pageId: page.id,
      ref: 'cta',
      version: page.version,
    })
    expect(r.saved).toBe(true)
    expect(r.notes?.join(' ')).toContain('variant')
    expect(r.notes?.join(' ')).toContain('size')
  })

  test('extracting says which refs it dropped, and how to address them now', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml(
        '<div data-ref="card"><h3 data-ref="card-title">T</h3><p data-ref="card-body">B</p></div>',
      ),
      version: home.version,
    })
    const page = await s.home()
    const made = await s.call('create_component', {
      pageId: page.id,
      ref: 'card',
      name: 'Promo',
      version: page.version,
    })
    expect(made.saved).toBe(true)
    expect(made.droppedRefs).toEqual(['card-title', 'card-body'])
    expect(made.notes?.join(' ')).toContain('componentId')
  })
})
