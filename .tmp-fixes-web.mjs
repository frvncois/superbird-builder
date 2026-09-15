// Browser verification of the stress-test fixes, replaying each reported bug
// against the published export and the editor.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createToolSet } from './packages/guano/mcp/tools.mjs'
import { chromium } from 'playwright'

const DIR = '/private/tmp/claude-501/-Users-frvncois-Documents-DEV-superbird-builder/c960e260-6594-45ad-a13b-7c39df399cf0/scratchpad'
const DATA = `${DIR}/data`
const keyFile = (k) => join(DATA, 'store', k.replaceAll(':', '__') + '.json')
const SITE = 'http://localhost:4199'
const ADMIN = 'http://localhost:5199'

let pass = 0, fail = 0
const ok = (l, c, extra) => { if (c) { pass++; console.log(`PASS — ${l}`) } else { fail++; console.log(`FAIL — ${l}`, extra ?? '') } }

// ---------- build the fixture through the real MCP tools ----------
const runtime = await import('./packages/guano/runtime/mcp-runtime.mjs')
const api = {
  whoami: async () => ({ name: 'Demo', email: 'd@e.com', role: 'admin' }),
  base: SITE,
  storeGetRaw: async (k) => { try { return await readFile(keyFile(k), 'utf8') } catch { return null } },
  storeGetJson: async (k) => { const r = await api.storeGetRaw(k); return r ? JSON.parse(r) : null },
  storePutRaw: async (k, raw) => { await writeFile(keyFile(k), raw) },
  publish: async () => ({ ok: true }),
  mediaIndex: async () => ({ assets: [], folders: [] }),
  mediaUpload: async () => ({}),
}
const ts = createToolSet({ api, runtime })
const call = (n, a = {}) => ts.toolMap.get(n).handler(a)
await call('set_target', { target: 'main', chosenByUser: true, acknowledgeMain: true })

// a collection so we can test per-repeat keys
await call('create_collection', { name: 'card', fields: [{ name: 'title', type: 'text' }] })
const cols = await call('list_collections')
const card = cols.collections.find((c) => c.name === 'card')
await call('upsert_entries', {
  collectionId: card.id,
  entries: [
    { name: 'One', values: { title: 'One' } },
    { name: 'Two', values: { title: 'Two' } },
    { name: 'Three', values: { title: 'Three' } },
  ],
})

const made = await call('create_animations', {
  items: [
    // Bug B: one timeline that moves the element AND cascades its children
    { name: 'Move+Cascade', steps: [
      { tracks: [{ prop: 'y', from: 60, to: 0 }], duration: 400, easing: 'linear' },
      { tracks: [{ prop: 'opacity', from: 0, to: 1 }], duration: 400, easing: 'linear', stagger: 200 },
    ] },
    // Bug C: an entrance with an explicit from
    { name: 'FadeUp', steps: [
      { tracks: [{ prop: 'opacity', from: 0, to: 1 }, { prop: 'y', from: 40, to: 0 }], duration: 600, easing: 'ease-out' },
    ] },
    // units: a percentage marquee
    { name: 'Marquee', steps: [
      { tracks: [{ prop: 'x', from: '0%', to: '-50%' }], duration: 2000, easing: 'linear', repeat: -1 },
    ] },
    // clip wipe
    { name: 'Wipe', steps: [
      { tracks: [{ prop: 'clipBottom', from: 100, to: 0 }], duration: 800, easing: 'linear' },
    ] },
    // Bug F: an infinite hover loop
    { name: 'Spin', steps: [
      { tracks: [{ prop: 'rotate', from: 0, to: 360 }], duration: 300, easing: 'linear', repeat: -1 },
    ] },
    // appearAt threshold
    { name: 'LateFade', steps: [
      { tracks: [{ prop: 'opacity', from: 0, to: 1 }], duration: 300, easing: 'linear' },
    ] },
  ],
})
const byName = Object.fromEntries(made.created.map((a) => [a.name, a.id]))
ok('fixture animations created', made.created.length === 6, JSON.stringify(made))

const pages = await call('list_pages')
const pageId = pages.pages[0].id
const v0 = await call('get_page', { pageId, format: 'code' })
const filler = Array.from({ length: 8 }, () => '\t:paragraph:').join('\n')
await call('set_page_code', {
  pageId, version: v0.version,
  code: [
    ':body',
    '\t:h1:',                 // FadeUp (appear, from → no flash)
    '\t:div',                 // Move+Cascade (load)
    '\t\t:paragraph:',
    '\t\t:paragraph:',
    '\tdiv:',
    '\t:h2:',                 // Marquee (load, percent) + Spin (hover) → composition
    '\t:h3:',                 // Wipe (load)
    filler,
    '\t:collection-list[card]',
    '\t\t:h4:',               // per-repeat appear
    '\tcollection-list:',
    filler,
    '\t:h5:',                 // LateFade with appearAt
    'body:',
  ].join('\n'),
})
const p1 = await call('get_page', { pageId, includeInteractions: true })
const byType = (t) => (p1.elements ?? []).filter((e) => e.type === t)
const one = (t) => byType(t)[0]

const edits = [
  { id: one('h1').id, bindAnimations: [{ animationId: byName.FadeUp, trigger: 'appear' }] },
  { id: one('div').id, bindAnimations: [{ animationId: byName['Move+Cascade'], trigger: 'load' }] },
  { id: one('h2').id, bindAnimations: [
    { animationId: byName.Marquee, trigger: 'load' },
    { animationId: byName.Spin, trigger: 'hover' },
  ] },
  { id: one('h3').id, bindAnimations: [{ animationId: byName.Wipe, trigger: 'load' }] },
  { id: one('h4').id, bindAnimations: [{ animationId: byName.FadeUp, trigger: 'appear' }] },
  { id: one('h5').id, bindAnimations: [{ animationId: byName.LateFade, trigger: 'appear', appearAt: 0.8 }] },
]
for (const e of (p1.elements ?? []).filter((x) => x.type === 'paragraph')) {
  edits.push({ id: e.id, content: 'Filler paragraph with enough words to occupy real vertical space. '.repeat(4) })
}
const applied = await call('edit_elements', { pageId, version: p1.version, edits })
ok('fixture bound', applied.saved === true && applied.failed === 0, JSON.stringify(applied).slice(0, 300))

// ---------- publish ----------
const browser = await chromium.launch()
const admin = await (await browser.newContext()).newPage()
await admin.goto(`${ADMIN}/admin/login`, { waitUntil: 'networkidle' })
await admin.fill('input[type=email]', 'demo@example.com')
await admin.fill('input[type=password]', 'demopassword123')
await admin.press('input[type=password]', 'Enter')
await admin.waitForURL(/\/admin\/?$/, { timeout: 20000 })
await admin.waitForTimeout(3000)
const status = await admin.evaluate(async () => {
  const map = await (await fetch('/api/store?keys=guano-project:main', { credentials: 'include' })).json()
  const r = await fetch('/api/published?method=server', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' }, body: map['guano-project:main'],
  })
  return r.status
})
ok(`publish ok (${status})`, status === 200)

const ctx = await browser.newContext({ viewport: { width: 1200, height: 700 } })
const site = await ctx.newPage()
await site.goto(`${SITE}/`, { waitUntil: 'domcontentloaded' })
const html = await site.content()

// ---------- Bug C: no-flash first frame in the HTML ----------
{
  const raw = await (await fetch(`${SITE}/`)).text()
  const h1Tag = /<h1[^>]*>/.exec(raw)?.[0] ?? ''
  ok('appear target carries an inline first frame', /style="[^"]*opacity:0/.test(h1Tag), h1Tag)
  ok('first frame includes the transform', /translateY\(40px\)/.test(h1Tag), h1Tag)
  const h3Tag = /<h3[^>]*>/.exec(raw)?.[0] ?? ''
  ok('clip wipe primes its inset', /clip-path:inset\(0% 0% 100% 0%\)/.test(h3Tag), h3Tag)
}

// ---------- Bug D: `contents` ships in the CSS ----------
{
  const css = await (await fetch(`${SITE}/assets/style.css`)).text()
  ok('contents utility compiled', /\.contents\s*\{\s*display:\s*contents/.test(css.replace(/\s+/g, ' ')) || /display:contents/.test(css))
}

// ---------- Bug E: per-repeat keys ----------
{
  const raw = await (await fetch(`${SITE}/`)).text()
  const keys = [...raw.matchAll(/data-atgt="([^"]+)"/g)].map((m) => m[1])
  const h4Keys = keys.filter((k) => k.includes('@e'))
  ok(`collection repeats get distinct keys (${h4Keys.length})`, new Set(h4Keys).size === h4Keys.length && h4Keys.length === 3,
     JSON.stringify(h4Keys))
}

await site.waitForTimeout(1800)

// ---------- Bug B: element moves AND children cascade ----------
{
  const res = await site.evaluate(() => {
    const div = document.querySelector('div[data-anim]')
    if (!div) return null
    return {
      parent: div.getAttribute('style'),
      kids: Array.from(div.children).map((c) => c.getAttribute('style')),
    }
  })
  ok('staggered timeline still moves the element', !!res && /translateY/.test(res.parent ?? ''), JSON.stringify(res))
  ok('…and cascades its children', !!res && res.kids.every((k) => /opacity/.test(k ?? '')), JSON.stringify(res))
}

// ---------- units: percentage marquee ----------
{
  const style = await site.locator('h2').first().getAttribute('style')
  ok('percent unit survives into the CSS', /translateX\(-?\d+(\.\d+)?%\)/.test(style ?? ''), style)
}

// ---------- L-E: two plays compose on one element ----------
{
  // the marquee never stops, so Playwright's hover would wait forever for a
  // "stable" element — dispatch the event the runtime actually listens for
  await site.locator('h2').first().dispatchEvent('mouseenter')
  await site.waitForTimeout(250)
  const style = await site.locator('h2').first().getAttribute('style')
  ok('marquee x and hover rotate compose', /translateX\([^)]*\)/.test(style ?? '') && /rotate\([^)]*\)/.test(style ?? ''), style)

  // ---------- Bug F: leaving rewinds within one cycle ----------
  await site.waitForTimeout(900) // let the 300ms loop run several cycles
  await site.locator('h2').first().dispatchEvent('mouseleave')
  await site.waitForTimeout(500) // one cycle (300ms) + slack
  const after = await site.locator('h2').first().getAttribute('style')
  ok('infinite hover loop rewinds within one cycle', !/rotate\(/.test(after ?? ''), after)
}

// ---------- appearAt: does not fire at the first pixel ----------
{
  await site.evaluate(() => window.scrollTo(0, 0))
  await site.waitForTimeout(300)
  const h5 = site.locator('h5').first()
  await h5.evaluate((el) => el.scrollIntoView({ block: 'end' })) // just barely visible
  await site.waitForTimeout(400)
  const barely = await h5.getAttribute('style')
  await site.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await site.waitForTimeout(700)
  const fully = await h5.getAttribute('style')
  ok('appearAt holds at the viewport edge, fires once past the threshold',
     /opacity:\s*0(\D|$)/.test(barely ?? '') && /opacity:\s*1/.test(fully ?? ''), `${barely} → ${fully}`)
}

// ---------- Bug E in motion: only the visible card animates ----------
{
  const fresh = await ctx.newPage()
  await fresh.goto(`${SITE}/`, { waitUntil: 'domcontentloaded' })
  await fresh.waitForTimeout(1200)
  const states = await fresh.evaluate(() =>
    Array.from(document.querySelectorAll('h4')).map((el) => el.getAttribute('style')),
  )
  ok(`offscreen cards have not played (${JSON.stringify(states)})`,
     states.length === 3 && states.some((s) => /opacity:\s*0(\D|$)/.test(s ?? '')), JSON.stringify(states))
  await fresh.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await fresh.waitForTimeout(1200)
  const after = await fresh.evaluate(() =>
    Array.from(document.querySelectorAll('h4')).map((el) => el.getAttribute('style')),
  )
  ok('each card plays once it is scrolled to', after.every((s) => /opacity:\s*1/.test(s ?? '')), JSON.stringify(after))
  await fresh.close()
}

// ---------- regression: reduced motion + noanim ----------
{
  const rm = await (await browser.newContext({ reducedMotion: 'reduce' })).newPage()
  await rm.goto(`${SITE}/`, { waitUntil: 'networkidle' })
  await rm.waitForTimeout(400)
  ok('reduced motion lands on the end state', /opacity:\s*1/.test((await rm.locator('h1').first().getAttribute('style')) ?? ''))
  await rm.close()
  const na = await (await browser.newContext()).newPage()
  await na.goto(`${SITE}/?noanim`, { waitUntil: 'networkidle' })
  await na.waitForTimeout(400)
  ok('?noanim lands on the end state', /opacity:\s*1/.test((await na.locator('h1').first().getAttribute('style')) ?? ''))
  await na.close()
}

await site.screenshot({ path: `${DIR}/fx-site.png` })
await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
