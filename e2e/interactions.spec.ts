import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
// server modules under test — plain ESM, safe to import into the spec runner
// @ts-expect-error untyped server module
import { exportSite } from '../server/export.mjs'

// PLAN-PARITY §1.1 — interaction STATE is keyed by (interaction, target), not by
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
        code: '',
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
                htmlId: 'hA',
                interactions: [
                  { id: 'b3', interactionId: OPEN, trigger: 'click', targetId: 'pA', group: 'faq' },
                ],
              }),
              node('hB', 'button', {
                htmlId: 'hB',
                interactions: [
                  { id: 'b4', interactionId: OPEN, trigger: 'click', targetId: 'pB', group: 'faq' },
                ],
              }),
              node('pA', 'div', { htmlId: 'pA', classes: 'hidden' }),
              node('pB', 'div', { htmlId: 'pB', classes: 'hidden' }),
              // --- dismissible bar, remembered for the session ---
              node('bar', 'div', { htmlId: 'bar', children: [
                node('dismiss', 'button', {
                  htmlId: 'dismiss',
                  interactions: [
                    { id: 'b5', interactionId: HIDE, trigger: 'click', targetId: 'bar',
                      action: 'on', once: 'session' },
                  ],
                }),
              ] }),
              // --- §1.2: external link on a non-anchor element ---
              node('card', 'div', {
                htmlId: 'card',
                link: 'https://example.com/',
                attributes: { target: '_blank', 'aria-label': 'Example', title: 'Ex' },
                children: [node('cardText', 'text', { content: 'go' })],
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
    ],
    animations: [],
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
