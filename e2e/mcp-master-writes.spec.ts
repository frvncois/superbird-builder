import { test, expect } from '@playwright/test'
import { mcpSession } from './fixtures/mcpSession'

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
