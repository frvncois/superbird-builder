// Focused re-test of the two scroll-dependent fixes, on a page tall enough for
// the targets to start OFF screen, and asserted inside the 3s safety-net window.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createToolSet } from './packages/guano/mcp/tools.mjs'
import { chromium } from 'playwright'

const DATA = '/private/tmp/claude-501/-Users-frvncois-Documents-DEV-superbird-builder/c960e260-6594-45ad-a13b-7c39df399cf0/scratchpad/data'
const keyFile = (k) => join(DATA, 'store', k.replaceAll(':', '__') + '.json')
let pass = 0, fail = 0
const ok = (l, c, extra) => { if (c) { pass++; console.log(`PASS — ${l}`) } else { fail++; console.log(`FAIL — ${l}`, extra ?? '') } }

const runtime = await import('./packages/guano/runtime/mcp-runtime.mjs')
const api = {
  whoami: async () => ({ name: 'Demo', email: 'd@e.com', role: 'admin' }), base: 'http://localhost:4199',
  storeGetRaw: async (k) => { try { return await readFile(keyFile(k), 'utf8') } catch { return null } },
  storeGetJson: async (k) => { const r = await api.storeGetRaw(k); return r ? JSON.parse(r) : null },
  storePutRaw: async (k, raw) => { await writeFile(keyFile(k), raw) },
  publish: async () => ({ ok: true }), mediaIndex: async () => ({ assets: [], folders: [] }), mediaUpload: async () => ({}),
}
const ts = createToolSet({ api, runtime })
const call = (n, a = {}) => ts.toolMap.get(n).handler(a)
await call('set_target', { target: 'main', chosenByUser: true, acknowledgeMain: true })

// make the page MUCH taller so the list and the late fade start off screen
const pages = await call('list_pages')
const pageId = pages.pages[0].id
const v = await call('get_page', { pageId, format: 'code' })
const filler = Array.from({ length: 30 }, () => '\t:paragraph:').join('\n')
await call('set_page_code', {
  pageId, version: v.version,
  code: [':body', filler, '\t:collection-list[card]', '\t\t:h4:', '\tcollection-list:', filler, '\t:h5:', 'body:'].join('\n'),
})
const p1 = await call('get_page', { pageId, includeInteractions: true })
const anims = (await call('list_animations')).animations
const fade = anims.find((a) => a.name === 'FadeUp')
const late = anims.find((a) => a.name === 'LateFade')
const h4 = (p1.elements ?? []).find((e) => e.type === 'h4')
const h5 = (p1.elements ?? []).find((e) => e.type === 'h5')
const edits = [
  { id: h4.id, bindAnimations: [{ animationId: fade.id, trigger: 'appear' }] },
  { id: h5.id, bindAnimations: [{ animationId: late.id, trigger: 'appear', appearAt: 0.8 }] },
]
for (const e of (p1.elements ?? []).filter((x) => x.type === 'paragraph')) {
  edits.push({ id: e.id, content: 'Filler paragraph with plenty of words to occupy vertical space. '.repeat(4) })
}
const applied = await call('edit_elements', { pageId, version: p1.version, edits })
ok('tall fixture bound', applied.saved && applied.failed === 0, JSON.stringify(applied).slice(0, 200))

const browser = await chromium.launch()
const admin = await (await browser.newContext()).newPage()
await admin.goto('http://localhost:5199/admin/login', { waitUntil: 'networkidle' })
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

// ---------- Bug E: only the visible cards play ----------
{
  const p = await ctx.newPage()
  await p.goto('http://localhost:4199/', { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(900) // inside the 3s safety-net window
  const geo = await p.evaluate(() => ({
    vh: innerHeight, docH: document.body.scrollHeight,
    cards: Array.from(document.querySelectorAll('h4')).map((e) => ({
      top: Math.round(e.getBoundingClientRect().top), style: e.getAttribute('style'),
    })),
  }))
  ok(`page is tall enough (${geo.docH}px) and cards start off screen`,
     geo.cards.every((c) => c.top > geo.vh), JSON.stringify(geo.cards.map((c) => c.top)))
  ok('offscreen cards have NOT played', geo.cards.every((c) => /opacity:\s*0(\D|$)/.test(c.style ?? '')),
     JSON.stringify(geo.cards))
  // scroll so the cards are ON screen — jumping to the very bottom would move
  // them past the viewport between two observer ticks (they'd never intersect)
  await p.evaluate(() => {
    const el = document.querySelector('h4')
    window.scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight / 2)
  })
  await p.waitForTimeout(1200)
  const after = await p.evaluate(() =>
    Array.from(document.querySelectorAll('h4')).map((e) => e.getAttribute('style')))
  ok('each card plays once scrolled to', after.every((s) => /opacity:\s*1/.test(s ?? '')), JSON.stringify(after))
  await p.close()
}

// ---------- appearAt: waits for the threshold ----------
{
  const p = await ctx.newPage()
  await p.goto('http://localhost:4199/', { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(400)
  // park the late-fade element just inside the bottom edge (below the 80% mark)
  await p.evaluate(() => {
    const el = document.querySelector('h5')
    const y = el.getBoundingClientRect().top + scrollY - (innerHeight - 30)
    window.scrollTo(0, y)
  })
  await p.waitForTimeout(500)
  const barely = await p.evaluate(() => {
    const el = document.querySelector('h5')
    return { top: Math.round(el.getBoundingClientRect().top), vh: innerHeight, style: el.getAttribute('style') }
  })
  ok(`element sits below the 80% line (top ${barely.top} of ${barely.vh})`, barely.top > barely.vh * 0.8, JSON.stringify(barely))
  ok('appearAt has NOT fired yet', /opacity:\s*0(\D|$)/.test(barely.style ?? ''), JSON.stringify(barely))
  await p.evaluate(() => window.scrollBy(0, 300)) // push it past the threshold
  await p.waitForTimeout(600)
  const fired = await p.evaluate(() => document.querySelector('h5').getAttribute('style'))
  ok('appearAt fires once past the threshold', /opacity:\s*1/.test(fired ?? ''), fired)
  await p.close()
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
