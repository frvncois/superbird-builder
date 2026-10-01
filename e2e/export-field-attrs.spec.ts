import { test, expect } from '@playwright/test'
import { mcpSession, pageCode } from './fixtures/mcpSession'

// `node.fieldAttrs` binds an ATTRIBUTE's value to a collection field, which is
// the only way presentation can follow DATA.
//
// Without it the Cocoapp prototype could not render a status pill in two
// colours (every status looked the same yellow), could not show a channel as an
// icon, and every edit form rendered empty because an input's `value` could not
// be bound. The checks here read the EXPORTED HTML: a tool reporting success for
// something that renders nowhere is the bug class this guards.

test.describe('attribute values bound to fields', () => {
  async function seeded() {
    const s = await mcpSession()
    const c = (await s.call('create_collection', { name: 'convo', detailRoutes: false }))
      .collection
    await s.call('update_collection', {
      collectionId: c.id,
      addFields: [
        { name: 'status', type: 'text' },
        { name: 'phone', type: 'text' },
      ],
    })
    await s.call('upsert_entries', {
      collectionId: c.id,
      entries: [
        { name: 'Jade', values: { status: 'waiting', phone: '555-0100' } },
        { name: 'Amelie', values: { status: 'active', phone: '555-0199' } },
      ],
    })
    return s
  }

  test('a data-* attribute follows the entry, so one pill styles per status', async () => {
    const s = await seeded()
    const home = await s.home()
    await s.call('set_page_code', {
      pageId: home.id,
      code: pageCode(
        [
          '\t:collection-list[convo]',
          '\t\t:span#pill[status]:',
          '\tcollection-list:',
        ].join('\n'),
      ),
      version: home.version,
    })
    const after = await s.home()
    const r = await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [
        {
          ref: 'pill',
          fieldAttrs: { 'data-status': 'status' },
          addClasses: ['data-[status=waiting]:bg-yellow-200', 'data-[status=active]:bg-green-200'],
        },
      ],
    })
    expect(r.failed).toBe(0)

    const html = await s.html()
    // one element in the code, two in the markup, each carrying ITS entry's value
    expect(html).toContain('data-status="waiting"')
    expect(html).toContain('data-status="active"')
    // and the variant classes are on both, so the cascade does the rest
    expect((html.match(/data-\[status=waiting\]:bg-yellow-200/g) ?? []).length).toBe(2)
  })

  test('an input’s value is pre-filled from the entry it edits', async () => {
    const s = await seeded()
    const home = await s.home()
    await s.call('set_page_code', {
      pageId: home.id,
      code: pageCode(
        ['\t:collection-list[convo]', '\t\t:input#phone:', '\tcollection-list:'].join('\n'),
      ),
      version: home.version,
    })
    const after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [
        {
          ref: 'phone',
          attributes: { type: 'tel', placeholder: 'Phone' },
          fieldAttrs: { value: 'phone' },
        },
      ],
    })

    const html = await s.html()
    expect(html).toContain('value="555-0100"')
    expect(html).toContain('value="555-0199"')
    // the static attributes still apply
    expect(html).toContain('placeholder="Phone"')
    expect(html).toContain('type="tel"')
  })

  test('the static value is the fallback outside entry scope, and for an empty field', async () => {
    const s = await seeded()
    // a third entry with no status at all
    const c = s.stored().collections[0]
    await s.call('upsert_entries', {
      collectionId: c.id,
      entries: [{ name: 'Blank', values: { status: '' } }],
    })
    const home = await s.home()
    await s.call('set_page_code', {
      pageId: home.id,
      code: pageCode(
        [
          '\t:span#outside:',
          '\t:collection-list[convo]',
          '\t\t:span#inside:',
          '\tcollection-list:',
        ].join('\n'),
      ),
      version: home.version,
    })
    const after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [
        { ref: 'outside', attributes: { 'data-status': 'none' }, fieldAttrs: { 'data-status': 'status' } },
        { ref: 'inside', attributes: { 'data-status': 'none' }, fieldAttrs: { 'data-status': 'status' } },
      ],
    })

    const html = await s.html()
    // outside any entry scope there is nothing to read, so the authored value
    // stands — a bound attribute stays authorable
    expect((html.match(/data-status="none"/g) ?? []).length).toBe(2) // #outside + the blank entry
    expect(html).toContain('data-status="waiting"')
  })

  test('an attribute name outside the allowlist is refused, not silently dropped', async () => {
    const s = await seeded()
    const home = await s.home()
    await s.call('set_page_code', {
      pageId: home.id,
      code: pageCode('\t:span#pill:'),
      version: home.version,
    })
    const after = await s.home()
    const r = await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [{ ref: 'pill', fieldAttrs: { onclick: 'status' }, verbose: true }],
    })
    expect(JSON.stringify(r)).toContain('onclick')
    expect(s.stored().pages[0].elements[0].children[0].fieldAttrs).toBeUndefined()
  })
})
