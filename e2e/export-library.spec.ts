import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
// @ts-expect-error untyped server module
import { exportSite } from '../server/export.mjs'

// The bundled library, published. `npm run check:catalog` holds every entry to
// what can be checked as data; this is the rest — what only the exporter and a
// browser can answer. Does a component that holds a Button publish a button
// wearing the right option? Does a switch flip with no JavaScript at all? Does
// a click on a nested Button reach the binding on the wrapper around it?
//
// Every entry is added the way the editor adds one (what it holds first) and
// placed on one page, through the editor's own code from the runtime bundle.
//
// The fixture is exported into the e2e data dir's site/ (smoke.spec.ts
// republishes it afterwards, so clobbering it here is fine).

const SITE = join(resolve(import.meta.dirname, '..', '.e2e-data'), 'site')

const runtimePromise = import(
  /* @vite-ignore */ '../packages/guano/runtime/mcp-runtime.mjs' as string
).catch(() => null)

let html = ''

test.describe('the bundled library', () => {
  test.beforeAll(async () => {
    const rt = await runtimePromise
    test.skip(!rt, 'runtime/mcp-runtime.mjs missing — run `npm run build:mcp-runtime`')
    const project = rt.createProject('Library')
    project.settings.tokens = Object.entries(rt.CATALOG_TOKENS).map(([name, value]) => ({
      id: name,
      name,
      value,
    }))
    const add = (entry: { key: string }) => {
      const made = rt.materializeCatalogEntry(entry, project, (key: string) => {
        const have = project.components.find((c: { source?: string }) => c.source === key)
        return have ?? add(rt.catalogEntry(key))
      })
      project.components.push(made.def)
      project.interactions.push(...made.interactions)
      return made.def
    }
    for (const entry of rt.CATALOG) {
      if (!project.components.some((c: { source?: string }) => c.source === entry.key)) add(entry)
    }
    // one instance of each, written as a leaf and expanded like a page would
    const body = project.components.map((c: { name: string }) => `\t:${c.name}:`)
    const page = project.pages[0]
    page.status = 'published'
    page.path = '/'
    page.code = rt.expandComponentInstances(
      ['@setup', '\tname: Home', '\tslug: /', '\tstatus: published', 'setup@', ':body', ...body, 'body:'].join('\n'),
      project.components,
    )
    page.elements = rt.parseSyntax(page.code)
    expect(rt.validateDocument(page.code, project.components.map((c: { name: string }) => c.name), [], [], [])).toEqual([])
    await exportSite(project, SITE)
    html = await readFile(join(SITE, 'index.html'), 'utf8')
  })

  const buttonSaying = (label: string) =>
    new RegExp(`<button[^>]*class="([^"]*)"[^>]*>(?:(?!</button>).)*<span[^>]*>${label}</span>(?:(?!</button>).)*</button>`).exec(
      html,
    )

  test('a component that holds a Button publishes it wearing the right option', () => {
    // the call to action's button: secondary, and large
    const primary = buttonSaying('Start for free')![1]!.split(' ')
    expect(primary).toContain('bg-secondary')
    expect(primary).not.toContain('bg-primary')
    expect(primary).toContain('h-10')
    expect(primary).not.toContain('h-9') // replaced, not stacked
    // the hero's second action: outline, and large
    const outline = buttonSaying('Learn more')![1]!.split(' ')
    expect(outline).toContain('border-input')
    expect(outline).toContain('bg-background')
    expect(outline).not.toContain('bg-primary')
    expect(outline).toContain('h-10')
    // what no option touches comes from the base, for every one of them
    for (const classes of [primary, outline]) expect(classes).toContain('inline-flex')
  })

  test('a part is there only where it is shown', () => {
    // pagination's "Next" shows its trailing icon, "Previous" its leading one;
    // the plain Button shows neither of its two
    expect(buttonSaying('Next')![0]).toMatch(/<span[^>]*>Next<\/span><svg[^>]*data-icon="lucide:chevron-right"/)
    expect(buttonSaying('Previous')![0]).toMatch(/<svg[^>]*data-icon="lucide:chevron-left"[^>]*>.*<\/svg><span/)
    expect(buttonSaying('Button')![0]).not.toContain('<svg')
    // an icon-only button keeps its label out of the page, not just out of sight
    expect(html).not.toMatch(/<span[^>]*>Menu<\/span>/)
    // the card's footer is hidden until an instance shows it
    expect(html).not.toMatch(/<span[^>]*>Continue<\/span>/)
  })

  test('every class the library wears is in the stylesheet', async () => {
    const css = await readFile(join(SITE, 'assets', 'style.css'), 'utf8')
    // an override nobody wears on this page must ship too: the next instance may
    for (const cls of ['.h-8', '.h-10', '.bg-destructive', '.animate-spin', '.animate-pulse', '.border-collapse']) {
      expect(css, cls).toContain(cls)
    }
    expect(css).toContain('group-has-')
  })

  test('a switch flips with no JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    await page.goto('/')
    const track = page.locator('label:has-text("Airplane mode") > div')
    const before = await track.evaluate((el) => getComputedStyle(el).backgroundColor)
    await page.locator('label:has-text("Airplane mode")').click()
    await expect
      .poll(() => track.evaluate((el) => getComputedStyle(el).backgroundColor))
      .not.toBe(before)
    await context.close()
  })

  test('a tooltip shows on hover, and a real table is a table', async ({ page }) => {
    await page.goto('/')
    const tip = page.getByRole('tooltip')
    await expect(tip).toHaveCSS('opacity', '0')
    await page.getByRole('button', { name: 'Hover me' }).hover()
    await expect(tip).toHaveCSS('opacity', '1')

    await expect(page.locator('table thead th')).toHaveCount(3)
    await expect(page.locator('table tbody tr')).toHaveCount(3)
    await expect(page.locator('table tbody td').first()).toHaveText('INV-001')
  })

  test('a click on a nested Button reaches the binding around it', async ({ page }) => {
    await page.goto('/')
    // the sheet: opened by a Button it holds, closed by another
    const sheet = page.getByText('What this panel is for, in a line.')
    await expect(sheet).toBeHidden()
    await page.getByRole('button', { name: 'Open sheet' }).click()
    await expect(sheet).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(sheet).toBeHidden()

    // the alert dialog wants an answer: Escape is not one
    const question = page.getByText('This action cannot be undone.')
    await page.getByRole('button', { name: 'Delete account' }).click()
    await expect(question).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(question).toBeVisible()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(question).toBeHidden()
  })

  test('the sheet slides in rather than appearing', async ({ page }) => {
    // `hidden` → `block` cannot transition, so a sheet that moves has to start
    // laid out and merely invisible. Two effects: the layer fades, the panel
    // translates from the edge its `side` option parks it off.
    await page.goto('/')
    const panel = page
      .getByText('What this panel is for, in a line.')
      .locator('xpath=ancestor::*[@role="dialog"]')
    // v4 translate utilities drive the `translate` property, not `transform`
    const shift = () => panel.evaluate((p) => getComputedStyle(p).translate)
    // an interaction supplies its own `transition-all duration easing`, which
    // replaces the element's authored transition-* — so the author never has to
    // add one for the swap to animate
    const duration = await panel.evaluate((p) => getComputedStyle(p).transitionDuration)
    expect(duration).not.toBe('0s')

    const off = await shift()
    expect(off).not.toBe('none') // parked off its right edge
    await page.getByRole('button', { name: 'Open sheet' }).click()
    await expect.poll(shift).toBe('0px') // slid home
  })
})
