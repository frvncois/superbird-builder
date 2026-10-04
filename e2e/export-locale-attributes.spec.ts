import { test, expect } from '@playwright/test'
import { mcpSession, pageHtml } from './fixtures/mcpSession'

// Attribute TEXT a visitor reads — a placeholder, an icon button's aria-label,
// an image's alt — is translatable, and a component's placement can override it.
//
// Neither was possible. The Cocoapp prototype shipped English placeholders and
// aria-labels on every French route, and could not reuse the library's Input for
// a search field because `placeholder` is shared by every instance: it copied
// Input's class string onto plain `:input:` elements instead and lost the
// component.

test.describe('attribute text per placement and per locale', () => {
  async function page() {
    const s = await mcpSession()
    await s.call('update_settings', { addLocales: ['fr'] })
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<input data-ref="search" />\n<input data-ref="name" />'),
      version: home.version,
    })
    return s
  }

  test('a locale overrides a placeholder, and the base shows elsewhere', async () => {
    const s = await page()
    let after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [{ ref: 'search', attributes: { type: 'search', placeholder: 'Search contacts' } }],
    })
    after = await s.home()
    const r = await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      locale: 'fr',
      edits: [{ ref: 'search', attributes: { placeholder: 'Rechercher des contacts' } }],
    })
    expect(r.failed).toBe(0)

    const routes = await s.exportAll()
    expect(routes['index.html']).toContain('placeholder="Search contacts"')
    expect(routes['fr/index.html']).toContain('placeholder="Rechercher des contacts"')
    // `type` is structural and the same in every language
    expect(routes['fr/index.html']).toContain('type="search"')
  })

  test('only text attributes are localizable', async () => {
    const s = await page()
    const after = await s.home()
    const r = await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      locale: 'fr',
      edits: [{ ref: 'search', attributes: { type: 'tel' } }],
    })
    expect(r.failed).toBe(1)
    expect(JSON.stringify(r)).toContain('localizable')
  })

  test('the worklist lists attribute text, so "nothing left" means it', async () => {
    const s = await page()
    const after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [
        { ref: 'search', attributes: { placeholder: 'Search contacts' } },
        { ref: 'name', attributes: { 'aria-label': 'Full name', type: 'text' } },
      ],
    })

    const wl = await s.call('get_translation_worklist', { locale: 'fr' })
    const attrs = wl.items.filter((i: { kind: string }) => i.kind === 'attribute')
    expect(attrs.map((a: { attribute: string }) => a.attribute).sort()).toEqual([
      'aria-label',
      'placeholder',
    ])
    expect(attrs[0].base).toEqual({ untrusted: true, text: 'Search contacts' })
    // `type` is not offered — it is structural
    expect(JSON.stringify(attrs)).not.toContain('"type":"text"')

    // and translating one through set_translations lands
    const one = attrs.find((a: { attribute: string }) => a.attribute === 'placeholder')
    const w = await s.call('set_translations', {
      locale: 'fr',
      items: [
        {
          kind: 'attribute',
          pageId: one.pageId,
          id: one.id,
          attribute: 'placeholder',
          content: 'Rechercher',
        },
      ],
    })
    expect(w.written).toBe(1)
    expect((await s.exportAll())['fr/index.html']).toContain('placeholder="Rechercher"')
  })

  test('one placement overrides a component’s attribute without touching the others', async () => {
    const s = await mcpSession()
    await s.seed(['input'])
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<Input data-ref="a" />\n<Input data-ref="b" />'),
      version: home.version,
    })
    const after = await s.home()
    // the master's placeholder is shared; THIS placement says something else
    const inside = (await s.call('get_page', { pageId: after.id, elements: 'all' })).elements.filter(
      (e: { type: string }) => e.type === 'input',
    )
    expect(inside).toHaveLength(2)
    const r = await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [
        { id: inside[0].id, instanceAttributes: { placeholder: 'Search contacts' } },
        { id: inside[1].id, instanceAttributes: { placeholder: 'Your email' } },
      ],
    })
    expect(r.failed).toBe(0)

    const html = await s.html()
    expect(html).toContain('placeholder="Search contacts"')
    expect(html).toContain('placeholder="Your email"')
    // and the shared `type` still comes from the master
    expect((html.match(/type="text"/g) ?? []).length).toBe(2)
  })

  // The language switcher. `@locale:<code>` is THIS route in another locale —
  // a plain `/…` link cannot express it, because internal links are prefixed
  // with the CURRENT locale and from /fr every path leads back to /fr/….
  //
  // Every reader tested `startsWith('locale:')` while the stored sentinel
  // carries the `@`, exactly as `@item` does — so the href resolved to null
  // and the switcher shipped as an `<a>` with no destination at all, on every
  // route, in both languages.
  test('an @locale: link exports the same route in the other language', async () => {
    const s = await mcpSession()
    await s.call('update_settings', { addLocales: ['fr'] })
    const home = await s.home()
    await s.call('create_page', { name: 'About', slug: '/about' })
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml(
        [
          '<a data-ref="to-fr" href="@locale:fr"><span>FR</span></a>',
          '<a data-ref="to-en" href="@locale:en"><span>EN</span></a>',
        ].join('\n'),
      ),
      version: home.version,
    })
    const about = (await s.call('list_pages', {})).pages.find(
      (p: { slug: string }) => p.slug === '/about',
    )
    await s.call('set_page_html', {
      pageId: about.id,
      html: pageHtml('<a data-ref="to-fr" href="@locale:fr"><span>FR</span></a>'),
      version: about.version,
    })

    const routes = await s.exportAll()
    // from the English home, FR goes to /fr — and EN to the route itself
    expect(routes['index.html']).toContain('href="/fr"')
    expect(routes['index.html']).toContain('href="/"')
    // from the French home it is still /fr: the switcher names a language,
    // it does not toggle
    expect(routes['fr/index.html']).toContain('href="/fr"')
    // and it re-prefixes THIS route, not the home page
    expect(routes['about/index.html']).toContain('href="/fr/about"')
    expect(routes['fr/about/index.html']).toContain('href="/fr/about"')
    // never an anchor with no destination, which is what shipped before
    expect(routes['index.html']).not.toMatch(/<a class=[^>]*><span>FR<\/span>/)
  })
})
