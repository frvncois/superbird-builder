// MCP-layer verification of the stress-test fixes, driving the real tool
// registry against the isolated instance's store.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createToolSet } from './packages/guano/mcp/tools.mjs'

const DATA = '/private/tmp/claude-501/-Users-frvncois-Documents-DEV-superbird-builder/c960e260-6594-45ad-a13b-7c39df399cf0/scratchpad/data'
const keyFile = (k) => join(DATA, 'store', k.replaceAll(':', '__') + '.json')

let pass = 0, fail = 0
const ok = (l, c, extra) => { if (c) { pass++; console.log(`PASS — ${l}`) } else { fail++; console.log(`FAIL — ${l}`, extra ?? '') } }

const runtime = await import('./packages/guano/runtime/mcp-runtime.mjs')
const api = {
  whoami: async () => {
    const r = await fetch('http://localhost:4199/api/auth/me')
    // no cookie here — emulate the token path by reading the server version file
    return { name: 'Demo', email: 'd@e.com', role: 'admin', serverVersion: SERVER_VERSION }
  },
  base: 'http://localhost:4199',
  storeGetRaw: async (k) => { try { return await readFile(keyFile(k), 'utf8') } catch { return null } },
  storeGetJson: async (k) => { const r = await api.storeGetRaw(k); return r ? JSON.parse(r) : null },
  storePutRaw: async (k, raw) => { await writeFile(keyFile(k), raw) },
  publish: async () => ({ ok: true }),
  mediaIndex: async () => ({ assets: [], folders: [] }),
  mediaUpload: async () => ({}),
}
const SERVER_VERSION = JSON.parse(await readFile('./packages/guano/package.json', 'utf8')).version

const ts = createToolSet({ api, runtime })
const call = (n, a = {}) => ts.toolMap.get(n).handler(a)
await call('set_target', { target: 'main', chosenByUser: true, acknowledgeMain: true })

// ---------- restart trap: version surfacing ----------
{
  const st = await call('get_status')
  ok(`get_status reports mcpVersion (${st.mcpVersion})`, typeof st.mcpVersion === 'string' && st.mcpVersion !== 'unknown')
  ok('get_status reports serverVersion', st.serverVersion === SERVER_VERSION, st.serverVersion)
  ok('get_status reports mcpStartedAt', typeof st.mcpStartedAt === 'string')
  ok('matching versions → no mismatch flag', !st.versionMismatch, st.versionWarning)
  const guide = await call('get_guide')
  ok('get_guide carries a version/hash header', /^<!-- guano handbook · mcp v.+ · [0-9a-f]{12} -->/.test(guide.guide), guide.guide.slice(0, 80))
}

// ---------- guide no longer contradicts itself (Bug G) ----------
{
  const { guide } = await call('get_guide')
  ok('gaps section no longer claims class-swap only', !/Interactions are \*\*class-swap only\*\*/.test(guide))
  ok('gaps section still names the real gaps',
     /character-level text splitting/.test(guide) && /route\/page-exit transitions/.test(guide))
  ok('stagger semantics corrected', /Only the STAGGERED\s+step's tracks move the children/.test(guide))
  ok('units documented', /"110%"/.test(guide) && /"50vw"/.test(guide))
  ok('clip documented', /clipBottom: 100 → 0/.test(guide))
  ok('batch create documented', /create_animations \{items/.test(guide))
}

// ---------- batch create (L-A) ----------
{
  const r = await call('create_animations', {
    items: [
      { name: 'B1', steps: [{ tracks: [{ prop: 'opacity', from: 0, to: 1 }], duration: 300, easing: 'ease-out' }] },
      { name: 'B2', steps: [{ tracks: [{ prop: 'x', from: '0%', to: '-100%' }], duration: 1000, easing: 'linear', repeat: -1 }] },
      { name: 'Bad', steps: [{ tracks: [{ prop: 'wobble', to: 1 }], duration: 100, easing: 'linear' }] },
      { name: 'B3', steps: [{ tracks: [{ prop: 'clipBottom', from: 100, to: 0 }], duration: 800, easing: 'quart-out' }] },
      { name: 'B4', steps: [{ tracks: [{ prop: 'y', from: 40, to: 0 }], duration: 500, easing: 'ease-out', stagger: 90, staggerSelector: 'img' }] },
    ],
  })
  ok('batch saved the valid items', r.saved && r.created.length === 4, JSON.stringify(r).slice(0, 200))
  ok('batch reported the invalid one', r.failures?.length === 1 && r.failures[0].name === 'Bad', JSON.stringify(r.failures))
  const list = await call('list_animations')
  ok('library holds the batch', list.animations.filter((a) => /^B\d$/.test(a.name)).length === 4)
  ok('quart easings advertised', list.easings.includes('quart-out') && list.easings.includes('quart-in-out'))
  ok('clip props advertised', list.properties.includes('clipBottom'))
}

// ---------- units + clip validation reach the agent ----------
{
  const bad = await call('create_animation', {
    name: 'Mixed', steps: [{ tracks: [{ prop: 'x', from: '0px', to: '-100%' }], duration: 100, easing: 'linear' }],
  })
  ok('mixed units rejected with an explanation',
     bad.saved === false && /mixes units/.test(bad.error), JSON.stringify(bad))
  const ok1 = await call('create_animation', {
    name: 'Percent', steps: [{ tracks: [{ prop: 'x', from: '0%', to: '-50%' }], duration: 100, easing: 'linear' }],
  })
  ok('percent values accepted', ok1.saved === true, JSON.stringify(ok1))
}

// ---------- breakpoints discoverable (L-I) ----------
{
  const s = await call('get_settings')
  ok('get_settings exposes breakpoints', Array.isArray(s.breakpoints) && s.breakpoints.length > 0, JSON.stringify(s.breakpoints))
  ok('breakpoints carry ids', s.breakpoints.every((b) => b.id && b.name), JSON.stringify(s.breakpoints))
}

// ---------- appearAt binding round-trips ----------
{
  const pages = await call('list_pages')
  const pageId = pages.pages[0].id
  const v = await call('get_page', { pageId, format: 'code' })
  await call('set_page_code', { pageId, version: v.version, code: ':body\n\t:h1:\n\t:div\n\t\t:paragraph:\n\t\t:paragraph:\n\tdiv:\nbody:' })
  const p = await call('get_page', { pageId, includeInteractions: true })
  const h1 = (p.elements ?? []).find((e) => e.type === 'h1')
  const anims = (await call('list_animations')).animations
  const b1 = anims.find((a) => a.name === 'B1')
  const r = await call('edit_elements', {
    pageId, version: p.version,
    edits: [{ id: h1.id, bindAnimations: [{ animationId: b1.id, trigger: 'appear', appearAt: 0.8 }] }],
  })
  ok('appearAt binding accepted', r.saved === true, JSON.stringify(r))
  const after = await call('get_page', { pageId, includeInteractions: true })
  const bound = (after.elements ?? []).find((e) => e.id === h1.id)
  const mine = (bound?.animations ?? []).find((x) => x.bindingId === (r.edited ? undefined : undefined) || x.appearAt !== undefined)
  ok('appearAt round-trips through get_page', mine?.appearAt === 0.8, JSON.stringify(bound?.animations))
  const badAt = await call('edit_elements', {
    pageId, version: after.version,
    edits: [{ id: h1.id, bindAnimations: [{ animationId: b1.id, trigger: 'appear', appearAt: 5 }] }],
  })
  ok('out-of-range appearAt refused', JSON.stringify(badAt).includes('appearAt must be'), JSON.stringify(badAt).slice(0, 200))
}

// ---------- delete_interaction (report §0 gap) ----------
{
  const made = await call('create_interaction', { name: 'Temp swap', toClasses: 'opacity-100' })
  ok('interaction created', made.saved === true)
  const pages = await call('list_pages')
  const pageId = pages.pages[0].id
  const p = await call('get_page', { pageId, includeInteractions: true })
  const h1 = (p.elements ?? []).find((e) => e.type === 'h1')
  await call('edit_elements', {
    pageId, version: p.version,
    edits: [{ id: h1.id, bindInteractions: [{ interactionId: made.interaction.id, trigger: 'hover' }] }],
  })
  const del = await call('delete_interaction', { interactionId: made.interaction.id })
  ok('delete_interaction unbinds everywhere', del.saved === true && del.unbound >= 1, JSON.stringify(del))
  const list = await call('list_interactions')
  ok('interaction gone from the library', !list.interactions.some((i) => i.id === made.interaction.id))
  ok('deleting an unknown interaction reports not-found',
     (await call('delete_interaction', { interactionId: 'nope' })).reason === 'not-found')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
