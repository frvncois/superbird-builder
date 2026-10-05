import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
// server modules under test — plain ESM, safe to import into the spec runner
// @ts-expect-error untyped server module
import { exportSite } from '../server/export.mjs'

// interaction STATE is keyed by (interaction, target), not by
// binding. Keyed by binding, an element opened by trigger A could never be closed
// by trigger B, so every modal became a trap and the to-classes were applied
// twice. These tests pin the whole contract: shared state, action modes,
// dismissal, exclusive groups, and §1.2 link-attribute hoisting.
//
// The fixture is exported with the real exporter into the e2e data dir's site/
// and then driven in a real browser, so the emitted JSON *and* the runtime that
// consumes it are both under test. (smoke.spec.ts republishes the site dir
// afterwards, so clobbering it here is fine.)

const SITE = join(resolve(import.meta.dirname, '..', '.e2e-data'), 'site')

const SHOW = 'i-show'
const OPEN = 'i-open'
const HIDE = 'i-hide'
const FADE = 'a-fade'
const PIN = 'i-pin'

const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  children: [],
  ...extra,
})

function fixture() {
  return {
    pages: [
      {
        id: 'p1',
        name: 'Home',
        path: '/',
        status: 'published',
        elements: [
          node('body', 'body', {
            children: [
              // --- modal: one effect, three triggers ---
              node('open', 'button', {
                content: 'Open',
                htmlId: 'open',
                interactions: [
                  { id: 'b1', interactionId: SHOW, trigger: 'click', targetId: 'modal', action: 'on' },
                ],
              }),
              node('modal', 'div', {
                htmlId: 'modal',
                // a small panel, not `inset-0`: the outside-click test needs a
                // real "outside" to click, and a full-bleed overlay has none
                classes: 'fixed top-0 left-0 w-64 h-64 hidden',
                children: [
                  node('close', 'button', {
                    content: 'X',
                    htmlId: 'close',
                    interactions: [
                      {
                        id: 'b2',
                        interactionId: SHOW,
                        trigger: 'click',
                        targetId: 'modal',
                        action: 'off',
                        closeOn: ['outside', 'escape'],
                      },
                    ],
                  }),
                  // an inner surface with no bindings of its own: clicking it is
                  // unambiguously "inside the modal, not on a control"
                  node('panelBody', 'div', { htmlId: 'panelBody', classes: 'w-32 h-32' }),
                ],
              }),
              // --- exclusive accordion group ---
              node('hA', 'button', {
                // a button holds its words in a child — with none it has no box to click
                children: [node('hAText', 'span', { content: 'A' })],
                htmlId: 'hA',
                interactions: [
                  { id: 'b3', interactionId: OPEN, trigger: 'click', targetId: 'pA', group: 'faq' },
                ],
              }),
              node('hB', 'button', {
                // a button holds its words in a child — with none it has no box to click
                children: [node('hBText', 'span', { content: 'B' })],
                htmlId: 'hB',
                interactions: [
                  { id: 'b4', interactionId: OPEN, trigger: 'click', targetId: 'pB', group: 'faq' },
                ],
              }),
              node('pA', 'div', { htmlId: 'pA', classes: 'hidden' }),
              node('pB', 'div', { htmlId: 'pB', classes: 'hidden' }),
              // --- an interaction whose TARGET is an <svg> ---
              // On an SVG element `className` is a read-only SVGAnimatedString,
              // so the runtime's `el.className.split(…)` threw while BUILDING
              // its target list — taking every interaction on the route down
              // with it, not just this one. An :icon is a void leaf rendering
              // <svg>, so a chevron that flips is all it took.
              node('chevronBtn', 'button', {
                children: [node('chevronLabel', 'span', { content: 'Toggle' })],
                htmlId: 'chevron-btn',
                interactions: [
                  { id: 'b9', interactionId: SHOW, trigger: 'click', targetId: 'chevron' },
                ],
              }),
              node('chevron', 'icon', {
                htmlId: 'chevron',
                classes: 'size-4',
                svg: '<svg viewBox="0 0 24 24" data-icon="chevron-down"><path d="m6 9 6 6 6-6"/></svg>',
              }),
              // --- dismissible bar, remembered for the session ---
              node('bar', 'div', { htmlId: 'bar', children: [
                node('dismiss', 'button', {
                  // a button holds its words in a child — with none it has no box to click
                  children: [node('dismissText', 'span', { content: 'Dismiss' })],
                  htmlId: 'dismiss',
                  interactions: [
                    { id: 'b5', interactionId: HIDE, trigger: 'click', targetId: 'bar',
                      action: 'on', once: 'session' },
                  ],
                }),
              ] }),
              // --- an animated panel: ONE timeline, two buttons ---
              node('animOpen', 'button', {
                content: 'Open panel',
                htmlId: 'anim-open',
                animations: [
                  { id: 'ab1', animationId: FADE, trigger: 'click', targetId: 'animPanel', action: 'on' },
                ],
              }),
              node('animClose', 'button', {
                content: 'Close panel',
                htmlId: 'anim-close',
                animations: [
                  { id: 'ab2', animationId: FADE, trigger: 'click', targetId: 'animPanel', action: 'off' },
                ],
              }),
              node('animPanel', 'div', { htmlId: 'anim-panel', classes: 'opacity-0' }),
              // --- the two engines take the same triggers ---
              // a class change on `load`: a state the page simply starts in
              node('loaded', 'div', {
                htmlId: 'loaded',
                classes: 'hidden',
                interactions: [{ id: 'b6', interactionId: SHOW, trigger: 'load' }],
              }),
              // a timeline on `scrolled`: a header that shrinks by tweening
              node('shrink', 'div', {
                htmlId: 'shrink',
                classes: 'opacity-0',
                animations: [
                  { id: 'ab4', animationId: FADE, trigger: 'scrolled', scrollAt: 40 },
                ],
              }),
              // tall enough that the threshold can actually be crossed
              node('tall', 'div', { htmlId: 'tall', classes: 'h-[300vh]' }),
              // --- §1.2: external link on a non-anchor element ---
              node('card', 'div', {
                htmlId: 'card',
                link: 'https://example.com/',
                // a hover timeline: symmetric, so it has no state to share and
                // must emit no state key
                animations: [{ id: 'ab3', animationId: FADE, trigger: 'hover' }],
                attributes: { target: '_blank', 'aria-label': 'Example', title: 'Ex' },
                children: [node('cardText', 'text', { content: 'go' })],
              }),
              // --- E6: a base `sticky` and a fired `fixed` are both `position` ---
              // The conflict table grouped `display` and `visibility` and
              // nothing else, so a header pinned `sticky` that an interaction
              // switched to `fixed` kept both classes and the winner came down
              // to which rule Tailwind happened to emit last.
              node('pinBtn', 'button', {
                children: [node('pinText', 'span', { content: 'Pin' })],
                htmlId: 'pin-btn',
                interactions: [
                  { id: 'b10', interactionId: PIN, trigger: 'click', targetId: 'header' },
                ],
              }),
              node('header', 'div', {
                htmlId: 'header',
                classes: 'sticky top-0 flex flex-row items-start overflow-visible',
              }),
              // --- §2.1: decorative alt + boolean download ---
              node('img', 'image', { src: 'https://example.com/a.png', attributes: { alt: '' } }),
              node('pdf', 'link', {
                content: 'PDF',
                link: 'https://example.com/a.pdf',
                attributes: { download: '' },
              }),
            ],
          }),
        ],
      },
    ],
    components: [],
    collections: [],
    interactions: [
      { id: SHOW, name: 'Show', toClasses: 'flex', duration: 'duration-300', easing: 'ease-out' },
      { id: OPEN, name: 'Open', toClasses: 'block', duration: 'duration-200', easing: 'ease-out' },
      { id: HIDE, name: 'Hide', toClasses: 'hidden', duration: 'duration-200', easing: 'ease-out' },
      {
        id: PIN,
        name: 'Pin',
        toClasses: 'fixed flex-col items-center overflow-hidden',
        duration: 'duration-200',
        easing: 'ease-out',
      },
    ],
    animations: [
      {
        id: FADE,
        name: 'Fade panel',
        steps: [
          {
            id: 'fs1',
            tracks: [{ prop: 'opacity', from: 0, to: 1 }],
            duration: 120,
            easing: 'linear',
          },
        ],
      },
    ],
    breakpoints: [],
    comments: [],
    locales: ['en'],
    defaultLocale: 'en',
    settings: {
      publishing: { method: 'server', github: { repo: '', branch: '' } },
      seo: { siteName: 'T', titleTemplate: '%s', description: '' },
      domain: '',
      smtp: {},
      integrations: { stripe: {}, mailing: {} },
      tokens: [],
      customCode: { head: '' },
      fonts: { family: 'sans' },
    },
  }
}

/** classes on an element, as a set */
const classesOf = async (page: import('@playwright/test').Page, id: string) =>
  new Set(
    ((await page.locator(`#${id}`).getAttribute('class')) ?? '').split(/\s+/).filter(Boolean),
  )

test.describe('interactions', () => {
  test.beforeAll(async () => {
    await exportSite(fixture(), SITE)
  })

  test('the emitted keys identify EFFECTS, not triggers', async () => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    const fx = JSON.parse(/id="int-fx"[^>]*>([^<]*)</.exec(html)![1]!)

    // one state key for the modal, whatever the number of triggers
    const modalKeys = Object.keys(fx).filter((k) => k.startsWith(`${SHOW}:modal`))
    expect(modalKeys).toEqual([`${SHOW}:modal`])

    const metas = [...html.matchAll(/data-int="([^"]*)"/g)]
      .map((m) => JSON.parse(m[1]!.replaceAll('&quot;', '"').replaceAll('&amp;', '&')))
      .flat()
    const open = metas.find((i) => i.k === 'b1')
    const close = metas.find((i) => i.k === 'b2')
    expect(open.s).toBe(close.s) // THE fix: one shared state key
    expect(open.a).toBe('on')
    expect(close.a).toBe('off')
    expect(close.c).toEqual(['outside', 'escape'])

    // the target lists its state key once, and its transition setup once —
    // three bindings used to mean three copies of both
    const tag = /<div[^>]*id="modal"[^>]*>/.exec(html)![0]!
    expect(tag.match(/i-show:modal/g)!).toHaveLength(1)
    expect(tag.match(/duration-300/g)!).toHaveLength(1)
    // the conflicting base class is keyed by state key, so `hidden` is dropped
    // while the effect is on
    const fxrm = JSON.parse(/id="int-fxrm"[^>]*>([^<]*)</.exec(html)![1]!)
    expect(fxrm[`${SHOW}:modal`]).toBe('hidden')
  })

  test('a click play is keyed per (animation, target), not per binding', async () => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    const metas = [...html.matchAll(/data-anim="([^"]*)"/g)]
      .map((m) => JSON.parse(m[1]!.replaceAll('&quot;', '"').replaceAll('&amp;', '&')))
      .flat()

    const open = metas.find((m) => m.k === 'ab1')
    const close = metas.find((m) => m.k === 'ab2')
    // THE fix: both clicks drive ONE play, so the close button can rewind what
    // the open button ran. Keyed per binding, it rewound a play of its own that
    // nothing had ever started.
    expect(open.s).toBe(close.s)
    expect(open.s).toBe(`${FADE}:animPanel`)
    expect(open.ac).toBe('on')
    expect(close.ac).toBe('off')

    // a hover drives both directions itself, so it has no state to share and
    // stays keyed per binding — no `s` on the wire at all
    expect(metas.find((m) => m.k === 'ab3').s).toBeUndefined()

    // the panel lists both bindings as targets, so either key resolves it
    const tag = /<div[^>]*id="anim-panel"[^>]*>/.exec(html)![0]!
    expect(tag).toContain('ab1')
    expect(tag).toContain('ab2')
  })

  test('an animated panel is opened by one button and rewound by another', async ({ page }) => {
    await page.goto('/')
    const panel = page.locator('#anim-panel')
    const opacity = () => panel.evaluate((el) => getComputedStyle(el).opacity)
    expect(await opacity()).toBe('0')

    await page.locator('#anim-open').click()
    await expect.poll(opacity).toBe('1')

    // the regression this guards: a DIFFERENT binding on a DIFFERENT element
    // rewinds the play the open button started. Before the play was keyed by
    // (animation, target) this click found nothing under its own key and the
    // panel stayed open, with both the editor and publish reporting success.
    await page.locator('#anim-close').click()
    await expect.poll(opacity).toBe('0')
  })

  test('the two engines answer the same triggers', async ({ page }) => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')

    // a class change on load rides in data-int like any other trigger…
    const metas = [...html.matchAll(/data-int="([^"]*)"/g)]
      .map((m) => JSON.parse(m[1]!.replaceAll('&quot;', '"').replaceAll('&amp;', '&')))
      .flat()
    expect(metas.find((i) => i.k === 'b6').t).toBe('load')

    // …and a timeline on scrolled carries its threshold
    const anims = [...html.matchAll(/data-anim="([^"]*)"/g)]
      .map((m) => JSON.parse(m[1]!.replaceAll('&quot;', '"').replaceAll('&amp;', '&')))
      .flat()
    const shrink = anims.find((m) => m.k === 'ab4')
    expect(shrink.t).toBe('scrolled')
    expect(shrink.at2).toBe(40)

    await page.goto('/')
    // the load state is on from the first frame — never off, no viewport wait
    expect(await classesOf(page, 'loaded')).toContain('flex')

    // and the scrolled timeline plays past its threshold, rewinding above it
    const opacity = () =>
      page.locator('#shrink').evaluate((el) => getComputedStyle(el).opacity)
    expect(await opacity()).toBe('0')
    await page.evaluate(() => window.scrollTo(0, 400))
    await expect.poll(opacity).toBe('1')
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect.poll(opacity).toBe('0')
  })

  test('a modal opens, and every dismissal path closes it', async ({ page }) => {
    await page.goto('/')
    expect(await classesOf(page, 'modal')).toContain('hidden')

    await page.locator('#open').click()
    let cls = await classesOf(page, 'modal')
    expect(cls).toContain('flex')
    expect(cls).not.toContain('hidden')

    // THE regression: the close button is a DIFFERENT binding on the same effect
    await page.locator('#close').click()
    expect(await classesOf(page, 'modal')).toContain('hidden')

    // 'on' is idempotent (not a toggle), and classes never accumulate.
    // dispatchEvent, not click(): an open `fixed inset-0` modal covers its own
    // opener — which is precisely why the old per-binding keying was fatal, and
    // is real modal behaviour, not a fixture artefact.
    await page.locator('#open').dispatchEvent('click')
    await page.locator('#open').dispatchEvent('click')
    const raw = (await page.locator('#modal').getAttribute('class')) ?? ''
    expect(raw.split(/\s+/).filter((c) => c === 'flex')).toHaveLength(1)

    // Escape
    await page.keyboard.press('Escape')
    expect(await classesOf(page, 'modal')).toContain('hidden')

    // a click inside must NOT dismiss; a click outside must
    await page.locator('#open').dispatchEvent('click')
    await page.locator('#panelBody').click()
    expect(await classesOf(page, 'modal')).toContain('flex')
    await page.locator('#close').click() // the X is inside too — it closes by action
    expect(await classesOf(page, 'modal')).toContain('hidden')

    await page.locator('#open').dispatchEvent('click')
    await page.mouse.click(600, 500) // genuinely outside the panel
    expect(await classesOf(page, 'modal')).toContain('hidden')
  })

  test('an exclusive group keeps one panel open', async ({ page }) => {
    await page.goto('/')
    await page.locator('#hA').click()
    expect(await classesOf(page, 'pA')).toContain('block')

    await page.locator('#hB').click()
    expect(await classesOf(page, 'pB')).toContain('block')
    expect(await classesOf(page, 'pA')).toContain('hidden') // A closed itself

    await page.locator('#hB').click() // no action set → still a toggle
    expect(await classesOf(page, 'pB')).toContain('hidden')
  })

  test('a remembered dismissal survives a reload', async ({ page }) => {
    await page.goto('/')
    expect(await classesOf(page, 'bar')).not.toContain('hidden')
    await page.locator('#dismiss').click()
    expect(await classesOf(page, 'bar')).toContain('hidden')

    await page.reload()
    expect(await classesOf(page, 'bar')).toContain('hidden')
  })

  test('an svg target toggles, and does not take the page down with it', async ({ page }) => {
    await page.goto('/')
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))

    // the svg itself flips…
    expect(await classesOf(page, 'chevron')).not.toContain('flex')
    await page.locator('#chevron-btn').click()
    expect(await classesOf(page, 'chevron')).toContain('flex')
    // …and it keeps the class it was authored with: the runtime recomputes the
    // whole list from a captured base, so a lost base would strip `size-4`
    expect(await classesOf(page, 'chevron')).toContain('size-4')

    // the real regression: EVERY OTHER interaction on the route still works.
    // The throw happened in the collection loop, so one svg target left the
    // modal, the menu and the accordion all dead.
    await page.locator('#open').click()
    expect(await classesOf(page, 'modal')).not.toContain('hidden')
    expect(errors).toEqual([])
  })

  test('a fired class evicts the base class on the SAME property (E6)', async ({ page }) => {
    await page.goto('/')
    const before = await classesOf(page, 'header')
    expect(before).toContain('sticky')
    expect(before).toContain('flex-row')
    expect(before).toContain('items-start')
    expect(before).toContain('overflow-visible')

    await page.locator('#pin-btn').click()
    const after = await classesOf(page, 'header')
    // the fired half is on…
    expect(after).toContain('fixed')
    expect(after).toContain('flex-col')
    expect(after).toContain('items-center')
    expect(after).toContain('overflow-hidden')
    // …and the base half is GONE, not merely outweighed: two classes on one
    // property resolve by stylesheet order, which the author cannot see
    expect(after).not.toContain('sticky')
    expect(after).not.toContain('flex-row')
    expect(after).not.toContain('items-start')
    expect(after).not.toContain('overflow-visible')
    // a base class on a DIFFERENT property is untouched
    expect(after).toContain('top-0')
    expect(after).toContain('flex')

    // and it really is `position: fixed` in the browser
    expect(
      await page.locator('#header').evaluate((el) => getComputedStyle(el).position),
    ).toBe('fixed')
  })

  test('link attributes land on the generated anchor, not the inner element', async () => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    const anchor = /<a href="https:\/\/example\.com\/"[^>]*>/.exec(html)![0]!
    expect(anchor).toContain('target="_blank"')
    expect(anchor).toContain('aria-label="Example"')
    // never shipped without the opener guard, even if the author forgot `rel`
    expect(anchor).toContain('rel="noopener noreferrer"')

    const inner = /<a href="https:\/\/example\.com\/"[^>]*><div([^>]*)>/.exec(html)![1]!
    expect(inner).not.toMatch(/target=|aria-label=|rel=/)
  })

  test('empty and boolean attributes survive sanitization', async () => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    // a decorative image needs alt="" — it used to be dropped as "not allowed"
    expect(/<img[^>]*alt=""/.test(html)).toBe(true)
    // boolean attributes serialize bare: download="" would be wrong markup
    expect(/<a[^>]*a\.pdf[^>]*\sdownload[ >]/.test(html)).toBe(true)
  })
})
