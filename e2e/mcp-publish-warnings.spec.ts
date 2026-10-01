import { test, expect } from '@playwright/test'
import { mcpSession, pageCode, type McpSession } from './fixtures/mcpSession'

// `publish` returns design warnings, never refusals. They are the only review an
// agent gets, so a FALSE one costs real work: the Cocoapp session rebound a
// perfectly good staggered entrance from `load` to `appear` to clear
// `load-animation-moves-layout`, which did not apply to it in the first place.
// The cases below are the checks that review asked for, and the ones it got wrong.

/** a grid of 14 cards — over the 12-descendant threshold the check uses */
const GRID = [
  '\t:section#grid',
  ...Array.from({ length: 14 }, () => '\t\t:span:'),
  '\tsection:',
].join('\n')

/** bind `animationId` to #grid with the given trigger */
async function bindToGrid(s: McpSession, animationId: string, trigger: string) {
  const home = await s.home()
  await s.call('set_page_code', { pageId: home.id, code: pageCode(GRID), version: home.version })
  const after = await s.home()
  await s.call('edit_elements', {
    pageId: after.id,
    version: after.version,
    edits: [{ ref: 'grid', bindAnimations: [{ animationId, trigger }] }],
  })
}

const moveStep = (stagger?: number) => ({
  duration: 420,
  easing: 'quart-out',
  ...(stagger === undefined ? {} : { stagger }),
  tracks: [
    { prop: 'opacity', from: 0, to: 1 },
    { prop: 'y', from: 14, to: 0 },
  ],
})

test.describe('publish design warnings', () => {
  test('a load animation that moves a big container is flagged', async () => {
    const s = await mcpSession()
    const { created } = await s.call('create_animations', {
      items: [{ name: 'Slide in', steps: [moveStep()] }],
    })
    await bindToGrid(s, created[0].id, 'load')
    expect(await s.kinds()).toContain('load-animation-moves-layout')
  })

  test('a STAGGERED load animation is not flagged — it moves the children, not the container', async () => {
    const s = await mcpSession()
    const { created } = await s.call('create_animations', {
      items: [{ name: 'Cards stagger in', steps: [moveStep(70)] }],
    })
    await bindToGrid(s, created[0].id, 'load')
    // splitByStagger (shared/motion.js) sends a staggered track to the
    // container's children; the container itself is never transformed, which is
    // exactly the "small items, staggered" shape the warning recommends
    expect(await s.kinds()).not.toContain('load-animation-moves-layout')
  })

  test('a timeline that staggers one step and moves the container in another is still flagged', async () => {
    const s = await mcpSession()
    const { created } = await s.call('create_animations', {
      items: [{ name: 'Mixed', steps: [moveStep(70), moveStep()] }],
    })
    await bindToGrid(s, created[0].id, 'load')
    expect(await s.kinds()).toContain('load-animation-moves-layout')
  })

  test('an opacity-only load animation is never flagged', async () => {
    const s = await mcpSession()
    const { created } = await s.call('create_animations', {
      items: [
        { name: 'Fade', steps: [{ duration: 300, easing: 'ease-out', tracks: [{ prop: 'opacity', from: 0, to: 1 }] }] },
      ],
    })
    await bindToGrid(s, created[0].id, 'load')
    expect(await s.kinds()).not.toContain('load-animation-moves-layout')
  })
})

test.describe('what a review sends back', () => {
  test('a binding whose target is not on the page is flagged', async () => {
    const s = await mcpSession()
    const { created } = await s.call('create_interactions', {
      items: [{ name: 'Show', toClasses: 'flex' }],
    })
    const home = await s.home()
    await s.call('set_page_code', {
      pageId: home.id,
      code: pageCode(
        '\t:button#open\n\t\t:span:\n\tbutton:\n\t:div#panel\n\t\t:span:\n\tdiv:',
      ),
      version: home.version,
    })
    let after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [
        { ref: 'open', bindInteractions: [{ interactionId: created[0].id, targetRef: 'panel', trigger: 'click' }] },
      ],
    })
    // the target is there, so nothing is wrong yet
    expect(await s.kinds()).not.toContain('binding-target-unreachable')

    // now remove the panel but keep the binding: it points at nothing
    after = await s.home()
    await s.call('set_page_code', {
      pageId: after.id,
      code: pageCode('\t:button#open\n\t\t:span:\n\tbutton:'),
      version: after.version,
    })
    expect(await s.kinds()).toContain('binding-target-unreachable')
  })

  test('a button inside a linked container is flagged', async () => {
    const s = await mcpSession()
    const home = await s.home()
    // :div@/reports exports as <a>…</a>, and a :button inside it is invalid
    await s.call('set_page_code', {
      pageId: home.id,
      code: pageCode('\t:div#card@/reports\n\t\t:button\n\t\t\t:span:\n\t\tbutton:\n\tdiv:'),
      version: home.version,
    })
    const kinds = await s.kinds()
    expect(kinds).toContain('interactive-inside-link')
  })

  test('a heavy row template over many entries is flagged, a small one is not', async () => {
    const s = await mcpSession()
    const c = (await s.call('create_collection', { name: 'contact', detailRoutes: false })).collection
    await s.call('upsert_entries', {
      collectionId: c.id,
      entries: Array.from({ length: 12 }, (_, i) => ({ name: `Person ${i}` })),
    })
    const home = await s.home()
    const smallRow = '\t:collection-list[contact]\n\t\t:div\n\t\t\t:span:\n\t\tdiv:\n\tcollection-list:'
    await s.call('set_page_code', { pageId: home.id, code: pageCode(smallRow), version: home.version })
    expect(await s.kinds()).not.toContain('heavy-repeat')

    // a 40-node drawer in every row is what made one route 300 KB
    const heavyRow = [
      '\t:collection-list[contact]',
      '\t\t:div',
      ...Array.from({ length: 45 }, () => '\t\t\t:span:'),
      '\t\tdiv:',
      '\tcollection-list:',
    ].join('\n')
    const after = await s.home()
    await s.call('set_page_code', { pageId: after.id, code: pageCode(heavyRow), version: after.version })
    expect(await s.kinds()).toContain('heavy-repeat')
  })

  test('attribute text on a multilingual site is flagged as untranslatable', async () => {
    const s = await mcpSession()
    const home = await s.home()
    await s.call('set_page_code', {
      pageId: home.id,
      code: pageCode('\t:input#search:'),
      version: home.version,
    })
    const after = await s.home()
    await s.call('edit_elements', {
      pageId: after.id,
      version: after.version,
      edits: [{ ref: 'search', attributes: { placeholder: 'Search contacts' } }],
    })
    // one locale: nothing to say
    expect(await s.kinds()).not.toContain('untranslated-attributes')

    await s.call('update_settings', { addLocales: ['fr'] })
    expect(await s.kinds()).toContain('untranslated-attributes')
  })

  test('a trigger and a target in two different repeats is flagged', async () => {
    const s = await mcpSession()
    const c = (await s.call('create_collection', { name: 'row', detailRoutes: false })).collection
    await s.call('upsert_entries', {
      collectionId: c.id,
      entries: [{ name: 'One' }, { name: 'Two' }],
    })
    const { created } = await s.call('create_interactions', {
      items: [{ name: 'Show', toClasses: 'flex' }],
    })
    const home = await s.home()
    // two sibling lists: a trigger in one cannot know WHICH row of the other to
    // drive, so the key can never match and the click does nothing
    await s.call('set_page_code', {
      pageId: home.id,
      code: pageCode(
        [
          '\t:collection-list[row]',
          '\t\t:button#rowOpen',
          '\t\t\t:span:',
          '\t\tbutton:',
          '\tcollection-list:',
          '\t:collection-list[row]',
          '\t\t:div#rowPanel',
          '\t\t\t:span:',
          '\t\tdiv:',
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
        {
          ref: 'rowOpen',
          bindInteractions: [
            { interactionId: created[0].id, targetRef: 'rowPanel', trigger: 'click' },
          ],
        },
      ],
    })
    expect(await s.kinds()).toContain('binding-target-unreachable')
  })

  test('a heavy export is flagged by its per-route weight', async () => {
    // a backstop above heavy-repeat, which catches the usual cause. 150 KB of
    // HTML for one route is already a lot of inlined structure; the Cocoapp
    // prototype averaged 67 KB and is NOT what this is for.
    const heavy = await mcpSession('T', { routes: 26, bytes: 26 * 200_000 })
    expect(await heavy.kinds()).toContain('route-size')

    const cocoapp = await mcpSession('T', { routes: 26, bytes: 1_734_037 })
    expect(await cocoapp.kinds()).not.toContain('route-size')
  })
})
