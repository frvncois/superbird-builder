import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
// server modules under test — plain ESM, safe to import into the spec runner
// @ts-expect-error untyped server module
import { exportSite } from '../server/export.mjs'

// Site-wide motion (settings.motion): the appear-mode default, page
// transitions, and smooth scrolling. Exported with the real exporter into the
// e2e data dir and then driven in a real browser, so the emitted wire format
// AND the runtime that consumes it are both under test.
//
// The contract worth pinning here is mostly about what must NOT happen: an
// inherited "once" must cost nothing on the wire, a page must never be left
// hidden if the runtime doesn't arrive, and an intercepted link must always
// end up navigating. (smoke.spec.ts republishes the site dir afterwards, so
// clobbering it here is fine.)

const SITE = join(resolve(import.meta.dirname, '..', '.e2e-data'), 'site')

const FADE_IN = 'a-fade'

const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  children: [],
  ...extra,
})

/** `motion` is the settings.motion under test; pages are Home ⇄ About */
function fixture(motion: unknown) {
  const page = (id: string, name: string, path: string, linkTo: string) => ({
    id,
    name,
    path,
    status: 'published',
    elements: [
      node(`${id}-body`, 'body', {
        children: [
          node(`${id}-link`, 'link', { content: `to ${linkTo}`, htmlId: 'nav', link: linkTo }),
          node(`${id}-out`, 'link', {
            content: 'external',
            htmlId: 'ext',
            link: 'https://example.com/',
          }),
          // tall enough that the page actually scrolls
          node(`${id}-tall`, 'div', { htmlId: 'tall', classes: 'h-[300vh]' }),
          // inherits the site default
          node(`${id}-inherit`, 'div', {
            htmlId: 'inherit',
            animations: [{ id: `${id}-b1`, animationId: FADE_IN, trigger: 'appear', targetId: null }],
          }),
          // pins itself to once, whatever the site says
          node(`${id}-once`, 'div', {
            htmlId: 'once',
            animations: [
              {
                id: `${id}-b2`,
                animationId: FADE_IN,
                trigger: 'appear',
                targetId: null,
                appearMode: 'once',
              },
            ],
          }),
        ],
      }),
    ],
  })

  return {
    pages: [page('p1', 'Home', '/', '/about'), page('p2', 'About', '/about', '/')],
    components: [],
    collections: [],
    interactions: [],
    animations: [
      {
        id: FADE_IN,
        name: 'Fade in',
        steps: [
          {
            id: 's1',
            tracks: [{ prop: 'opacity', from: 0, to: 1 }],
            duration: 300,
            easing: 'ease-out',
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
      motion,
    },
  }
}

/** the same site with every animation binding stripped — nothing on the page
 * animates, so only settings.motion can pull the runtime in */
function fixtureWithoutAnimations(motion: unknown) {
  const project = fixture(motion)
  for (const page of project.pages) {
    for (const body of page.elements) {
      for (const child of body.children as Record<string, unknown>[]) delete child.animations
    }
  }
  project.animations = []
  return project
}

const animMetas = (html: string) =>
  [...html.matchAll(/data-anim="([^"]*)"/g)]
    .map((m) => JSON.parse(m[1]!.replaceAll('&quot;', '"').replaceAll('&amp;', '&')))
    .flat()

const jsonTag = (html: string, id: string) => {
  const found = new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(html)
  return found ? JSON.parse(found[1]!) : null
}

test.describe('site-wide motion', () => {
  test('the site appear default resolves at export, costing the wire nothing', async () => {
    await exportSite(fixture({ appearMode: 'replay' }), SITE)
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    const metas = animMetas(html)

    // inherited 'replay' travels; an explicit 'once' says nothing, because an
    // absent mode is already what the runtime plays once
    expect(metas.find((m) => m.k === 'p1-b1').o.m).toBe('replay')
    expect(metas.find((m) => m.k === 'p1-b2').o).toBeUndefined()
  })

  test('an inherited "once" emits no options at all', async () => {
    await exportSite(fixture({ appearMode: 'once' }), SITE)
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    for (const meta of animMetas(html)) expect(meta.o).toBeUndefined()
  })

  test('transitions ship their timelines in the existing library tag', async () => {
    await exportSite(fixture({ transitions: { enabled: true, preset: 'fade' } }), SITE)
    const html = await readFile(join(SITE, 'index.html'), 'utf8')

    const fx = jsonTag(html, 'site-fx')
    expect(fx.t).toEqual({ x: '__t-exit', e: '__t-enter' })
    const lib = jsonTag(html, 'anim-lib')
    expect(Object.keys(lib)).toEqual(expect.arrayContaining(['__t-exit', '__t-enter']))

    // the no-flash guard, and its self-release for a runtime that never arrives
    expect(html).toContain('html.gt-enter body{opacity:0}')
    expect(html).toContain("classList.add('gt-enter')")
    expect(html).toContain("classList.remove('gt-enter')")
  })

  test('smooth scroll alone still ships the runtime', async () => {
    await exportSite(fixtureWithoutAnimations({ scroll: { enabled: true, lerp: 0.12 } }), SITE)
    const html = await readFile(join(SITE, 'index.html'), 'utf8')

    expect(jsonTag(html, 'site-fx')).toEqual({ s: { l: 0.12 } })
    // nothing on the page animates, so the runtime ships for the setting alone
    expect(html).toContain('/assets/motion.js')
    expect(jsonTag(html, 'anim-lib')).toBeNull()
    // and there is no entrance to hide the page for
    expect(html).not.toContain('gt-enter')
  })

  test('nothing is emitted when the site sets no motion', async () => {
    await exportSite(fixtureWithoutAnimations(undefined), SITE)
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    expect(jsonTag(html, 'site-fx')).toBeNull()
    expect(html).not.toContain('gt-enter')
    expect(html).not.toContain('/assets/motion.js')
  })

  test.describe('in the browser', () => {
    test.beforeAll(async () => {
      await exportSite(fixture({ transitions: { enabled: true, preset: 'fade', duration: 200 } }), SITE)
    })

    test('the page reveals itself and an intercepted link still navigates', async ({ page }) => {
      await page.goto('/')
      // the enter transition runs to completion — the guard class is released
      // and the body is fully opaque, not stuck on its first frame
      await expect(page.locator('html')).not.toHaveClass(/gt-enter/)
      await expect
        .poll(() => page.evaluate(() => Number(getComputedStyle(document.body).opacity)))
        .toBeGreaterThan(0.99)

      await page.click('#nav')
      await page.waitForURL('**/about**', { timeout: 3000 })
      await expect
        .poll(() => page.evaluate(() => Number(getComputedStyle(document.body).opacity)))
        .toBeGreaterThan(0.99)
    })

    test('a finished slide leaves no transform behind on body', async ({ page }) => {
      // slide-up, not fade: this is the case that WRITES a transform. One left
      // on <body> makes it the containing block for every position:fixed
      // descendant — permanently, long after the transition — so a fixed header
      // would quietly stop being fixed. See clearWhenDone() in the runtime.
      await exportSite(
        fixture({ transitions: { enabled: true, preset: 'slide-up', duration: 200 } }),
        SITE,
      )
      await page.goto('/')
      // it really is a sliding transition: the transform lands first…
      await expect
        .poll(() => page.evaluate(() => document.body.style.transform || ''))
        .toContain('translateY')
      // …and is gone once the entrance finishes
      await expect
        .poll(() => page.evaluate(() => document.body.style.transform || ''), { timeout: 5000 })
        .toBe('')
    })

    test('?noanim navigates natively and never hides the page', async ({ page }) => {
      await page.goto('/?noanim')
      await expect(page.locator('html')).not.toHaveClass(/gt-enter/)
      expect(
        await page.evaluate(() => Number(getComputedStyle(document.body).opacity)),
      ).toBeCloseTo(1)
      await page.click('#nav')
      await page.waitForURL('**/about**', { timeout: 3000 })
    })
  })
})

// ---------------------------------------------------------------------------
// The `count` track: the ONE property that writes TEXT rather than style.
//
// THE LOAD-BEARING RULE: a count's `from` is NEVER baked into the exported
// HTML. The exporter writes initialStyle into the markup so an entrance does
// not flash its final state — which for a number would ship `0` as the text a
// visitor without JavaScript, and every visitor with reduced motion, reads
// forever. The authored text IS the final value; the runtime writes the first
// frame, and `still` mode never touches the text at all.

const COUNT = 'a-count'

function countFixture() {
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
              node('stat', 'span', {
                htmlId: 'stat',
                content: '18,000+',
                animations: [{ id: 'cb1', animationId: COUNT, trigger: 'load' }],
              }),
            ],
          }),
        ],
      },
    ],
    components: [],
    collections: [],
    interactions: [],
    animations: [
      {
        id: COUNT,
        name: 'Count up',
        steps: [
          {
            id: 'cs1',
            tracks: [{ prop: 'count', from: 0, to: 18000, format: { group: true, suffix: '+' } }],
            duration: 900,
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

test.describe('a count track', () => {
  test.beforeAll(async () => {
    await exportSite(countFixture(), SITE)
  })

  test('the authored number ships, and no first frame is baked over it', async () => {
    const html = await readFile(join(SITE, 'index.html'), 'utf8')
    const tag = /<span[^>]*id="stat"[^>]*>([^<]*)</.exec(html)!
    // the FINAL value is what the markup says — not `0`, and not a formatted 0
    expect(tag[1]).toBe('18,000+')
    // and nothing was baked: a count contributes no initial style at all
    expect(/<span[^>]*id="stat"[^>]*style=/.test(html)).toBe(false)
  })

  test('the runtime counts up to the authored text and stops there', async ({ page }) => {
    const seen: string[] = []
    await page.exposeFunction('record', (t: string) => void seen.push(t))
    await page.addInitScript(() => {
      // installed before the runtime, so every write it makes is observed
      document.addEventListener('DOMContentLoaded', () => {
        const el = document.getElementById('stat')
        if (!el) return
        new MutationObserver(() => {
          ;(window as unknown as { record: (t: string) => void }).record(el.textContent ?? '')
        }).observe(el, { childList: true, characterData: true, subtree: true })
      })
    })
    await page.goto('/')
    // it ends on the authored text…
    await expect.poll(() => page.locator('#stat').textContent(), { timeout: 5000 }).toBe('18,000+')
    // …having passed through something else on the way, grouped and suffixed
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.some((t) => t !== '18,000+' && /^[\d,]+\+$/.test(t))).toBe(true)
  })

  test('?noanim reads the authored number, written by nobody', async ({ page }) => {
    const writes: string[] = []
    await page.exposeFunction('record', (t: string) => void writes.push(t))
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const el = document.getElementById('stat')
        if (!el) return
        new MutationObserver(() => {
          ;(window as unknown as { record: (t: string) => void }).record(el.textContent ?? '')
        }).observe(el, { childList: true, characterData: true, subtree: true })
      })
    })
    await page.goto('/?noanim')
    expect(await page.locator('#stat').textContent()).toBe('18,000+')
    // `still` mode never touches the text: the end state IS what is in the
    // markup, so writing it would be churn — and a `0` first frame would be
    // what this visitor reads forever
    await page.waitForTimeout(500)
    expect(writes).toEqual([])
  })
})
