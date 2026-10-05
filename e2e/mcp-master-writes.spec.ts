import { test, expect } from '@playwright/test'
import { mcpSession, pageHtml } from './fixtures/mcpSession'

// Writing to a component MASTER, from the two angles the Harbour run tripped
// over: E1, a binding target addressed by the short `data-id` a component read
// prints, which this one path resolved raw and refused; and E16, a master write
// that returned no `version`, so the next one had to call list_components (22 KB
// for a dozen components) purely to find the hash it was just handed on a page.

test.describe('a binding inside a master', () => {
  test('the short data-id from the component read is a usable target', async () => {
    const s = await mcpSession()
    const made = await s.call('create_component', {
      name: 'Sheet',
      html:
        '<div class="relative"><button data-id="x" class="px-2"><span>Open</span></button>' +
        '<div class="hidden fixed inset-0"><p>panel</p></div></div>',
    })
    const panel = /<div data-id="([0-9a-f]+)" class="hidden/.exec(made.html)![1]
    const trigger = /<button data-id="([0-9a-f]+)"/.exec(made.html)![1]
    expect(panel).toHaveLength(8)

    const { created } = await s.call('create_interactions', {
      items: [{ name: 'Reveal', toClasses: 'flex' }],
    })
    const interactionId = created[0].id

    const r = await s.call('edit_elements', {
      componentId: made.componentId,
      edits: [
        {
          id: trigger,
          bindInteractions: [{ interactionId, trigger: 'click', targetId: panel, action: 'on' }],
        },
      ],
    })
    expect(r.failures ?? []).toEqual([])
    expect(r.edited).toBe(1)

    // it is stored as the master's own node id, which is what the exporter
    // matches — the short form was only an address
    const def = s
      .stored()
      .components.find((c: { id: string }) => c.id === made.componentId)
    const bound = JSON.stringify(def)
    expect(bound).toContain('"trigger":"click"')
  })

  test('a target that is not in the component says so, and names both id forms', async () => {
    const s = await mcpSession()
    const made = await s.call('create_component', {
      name: 'Panel',
      html: '<div><button class="px-2"><span>Open</span></button></div>',
    })
    const trigger = /<button data-id="([0-9a-f]+)"/.exec(made.html)![1]
    const { created } = await s.call('create_interactions', {
      items: [{ name: 'Reveal', toClasses: 'flex' }],
    })
    const r = await s.call('edit_elements', {
      componentId: made.componentId,
      edits: [
        {
          id: trigger,
          bindInteractions: [
            { interactionId: created[0].id, trigger: 'click', targetId: 'deadbeef' },
          ],
        },
      ],
    })
    const why = JSON.stringify(r.failures)
    expect(why).toContain('not an element of Panel')
    expect(why).toContain('data-id')
  })
})

test.describe('every master write hands back its version', () => {
  test('edit_elements {componentId}', async () => {
    const s = await mcpSession()
    const made = await s.call('create_component', {
      name: 'Card',
      html: '<div class="p-4"><h3>T</h3></div>',
    })
    const r = await s.call('edit_elements', {
      componentId: made.componentId,
      edits: [{ id: /<h3 data-id="([0-9a-f]+)"/.exec(made.html)![1], content: 'Title' }],
    })
    expect(r.saved).toBe(true)
    expect(typeof r.version).toBe('string')
    // and it is the CURRENT one: a write with it is accepted, not stale
    const next = await s.call('update_component', {
      componentId: made.componentId,
      html: '<div class="p-6"><h3>T</h3></div>',
      version: r.version,
    })
    expect(next.saved).toBe(true)
  })

  test('update_component with only a name, and set_component_variants', async () => {
    const s = await mcpSession()
    const made = await s.call('create_component', {
      name: 'Pill',
      html: '<span class="rounded-full">x</span>',
    })
    const renamed = await s.call('update_component', { componentId: made.componentId, name: 'Chip' })
    expect(renamed.saved).toBe(true)
    expect(typeof renamed.version).toBe('string')
    // the rename changes the master's root type, so the version really moved
    expect(renamed.version).not.toBe(made.version)

    const vars = await s.call('set_component_variants', {
      componentId: made.componentId,
      variants: [{ name: 'tone', options: ['default', 'warn'], default: 'default' }],
    })
    expect(vars.saved).toBe(true)
    expect(typeof vars.version).toBe('string')

    // the version from the last write is accepted by the next one
    const html = await s.call('update_component', {
      componentId: made.componentId,
      html: '<span class="rounded-full px-2">x</span>',
      version: vars.version,
    })
    expect(html.saved).toBe(true)
  })
})

// E21: `<svg data-icon="mail" />` is the form the guide's own page-html example
// uses, and it was a WRITE in `set_page_html` (which accepted the echoed
// `lucide:…` spelling) and a refusal in `create_component`. Both writers take a
// bundled icon name now; the table is imported only when markup mentions one.
test.describe('an icon by name is a write form in every writer', () => {
  test('create_component, set_page_html and edit_structure all take it', async () => {
    const s = await mcpSession()
    const made = await s.call('create_component', {
      name: 'Note',
      html: '<div class="flex gap-2"><svg data-icon="mail" class="size-4" /><span>Mail</span></div>',
    })
    expect(made.saved).toBe(true)
    // stored as real markup, reported back in the canonical `lucide:` spelling
    expect(made.html).toContain('data-icon="lucide:mail"')

    const home = await s.home()
    const w = await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<svg data-ref="i" data-icon="arrow-right" class="size-5" />'),
      version: home.version,
      elements: 'none',
    })
    expect(w.saved).toBe(true)
    expect(w.refused).toBeUndefined()

    const page = await s.home()
    const e = await s.call('edit_structure', {
      pageId: page.id,
      version: page.version,
      ops: [{ op: 'insert', after: 'i', html: '<svg data-ref="j" data-icon="check" class="size-5" />' }],
      elements: 'none',
    })
    expect(e.saved).toBe(true)

    // the real paths are in the published HTML, not a placeholder
    const html = await s.html()
    expect(html).toContain('data-icon="lucide:arrow-right"')
    expect(html).toContain('data-icon="lucide:check"')
    expect(html).toMatch(/<svg[^>]*class="size-5"[^>]*><path/)
  })

  test('echoing the name a read printed changes nothing', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<svg data-ref="i" data-icon="mail" class="size-5" />'),
      version: home.version,
      elements: 'none',
    })
    const read = await s.call('get_page', { pageId: home.id, elements: 'none' })
    const before = JSON.stringify(s.stored())
    const again = await s.call('set_page_html', {
      pageId: home.id,
      html: read.html,
      version: read.version,
      elements: 'none',
    })
    expect(again.refused).toBeUndefined()
    expect(JSON.stringify(s.stored())).toBe(before)
  })

  test('a name no bundled icon has is refused, pointing at list_icons', async () => {
    const s = await mcpSession()
    const home = await s.home()
    const r = await s.call('set_page_html', {
      pageId: home.id,
      html: pageHtml('<svg data-ref="i" data-icon="not-an-icon" />'),
      version: home.version,
      elements: 'none',
    })
    expect(r.partial).toBe(true)
    expect(JSON.stringify(r.refused)).toContain('list_icons')
  })
})

// E37 / D6: a `<button>` inside a component takes `type="submit"` per
// placement, for the same reason a `<link>` takes a destination — one Button
// serving a form's submit and its reset is the point of having one Button.
test('a button is an instance part, addressable per placement', async () => {
  const s = await mcpSession()
  const made = await s.call('create_component', {
    name: 'Btn',
    html: '<button class="px-3 py-1"><span>Go</span></button>',
  })
  expect(made.saved).toBe(true)
  const home = await s.home()
  await s.call('set_page_html', {
    pageId: home.id,
    html: pageHtml(
      '<form data-ref="f" class="grid gap-2">' +
        '<input class="border" name="email" />' +
        '<Btn data-ref="send" /><Btn data-ref="clear" /></form>',
    ),
    version: home.version,
  })
  const page = await s.call('get_page', { pageId: home.id, elements: 'ref-parts' })
  const rows = page.elements as { ref: string; parts: { part: string }[] }[]
  const send = rows.find((r) => r.ref === 'send')!
  expect(send.parts.map((p) => p.part)).toContain('button')

  const r = await s.call('edit_elements', {
    pageId: page.pageId,
    version: page.version,
    edits: [
      { ref: 'send', part: 'button', instanceAttributes: { type: 'submit' } },
      { ref: 'clear', part: 'button', instanceAttributes: { type: 'reset' } },
    ],
  })
  expect(r.failed).toBe(0)

  // each placement renders its own type, from ONE component
  const html = await s.html()
  expect(html).toContain('type="submit"')
  expect(html).toContain('type="reset"')
})
