import { test, expect } from '@playwright/test'
// In-process, like mcp-components and mcp-tools-security: the toolset and its
// bundled runtime are plain ESM driven against an in-memory store. No server,
// no browser, no login — so this spec cannot disturb smoke.spec's first-run flow.
// @ts-expect-error untyped package module
import { createToolSet } from '../packages/guano/mcp/tools.mjs'

// `publish` returns design warnings, never refusals. They are the only review an
// agent gets, so a FALSE one costs real work: the Cocoapp session rebound a
// perfectly good staggered entrance from `load` to `appear` to clear
// `load-animation-moves-layout`, which did not apply to it in the first place.

const runtimePromise = import(
  /* @vite-ignore */ '../packages/guano/runtime/mcp-runtime.mjs' as string
).catch(() => null)

const page = (body: string) =>
  `@setup\n\tname: Home\n\tslug: /\n\tstatus: published\n\tlocale: en\n:body\n${body}\nbody:`

async function session() {
  const runtime = await runtimePromise
  test.skip(!runtime, 'runtime/mcp-runtime.mjs missing — run `npm run build:mcp-runtime`')
  const store = new Map([['guano-project:main', JSON.stringify(runtime.createProject('T'))]])
  const api = {
    base: 'http://localhost:4174',
    whoami: async () => ({ id: 'u1', email: 'a@b.c', role: 'admin', name: 'A' }),
    storeGetRaw: async (k: string) => store.get(k) ?? null,
    storeGetJson: async (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null),
    storePutRaw: async (k: string, v: string) => void store.set(k, v),
    publish: async () => ({ routes: 1, bytes: 1 }),
    mediaIndex: async () => ({ assets: [], folders: [] }),
    mediaUpload: async () => ({ id: 'm1' }),
  }
  const set = createToolSet({ api, runtime })
  set.setTarget('main')
  const call = (name: string, args: Record<string, unknown> = {}) =>
    set.toolMap.get(name)!.handler(args)
  const home = async () => (await call('list_pages')).pages[0]
  const kinds = async () =>
    ((await call('publish')).warnings ?? []).map((w: { kind: string }) => w.kind)
  return { call, home, kinds }
}

/** a grid of 14 cards — over the 12-descendant threshold the check uses */
const GRID = [
  '\t:section#grid',
  ...Array.from({ length: 14 }, () => '\t\t:span:'),
  '\tsection:',
].join('\n')

/** bind `animationId` to #grid with the given trigger */
async function bindToGrid(
  s: Awaited<ReturnType<typeof session>>,
  animationId: string,
  trigger: string,
) {
  const home = await s.home()
  await s.call('set_page_code', { pageId: home.id, code: page(GRID), version: home.version })
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
    const s = await session()
    const { created } = await s.call('create_animations', {
      items: [{ name: 'Slide in', steps: [moveStep()] }],
    })
    await bindToGrid(s, created[0].id, 'load')
    expect(await s.kinds()).toContain('load-animation-moves-layout')
  })

  test('a STAGGERED load animation is not flagged — it moves the children, not the container', async () => {
    const s = await session()
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
    const s = await session()
    const { created } = await s.call('create_animations', {
      items: [{ name: 'Mixed', steps: [moveStep(70), moveStep()] }],
    })
    await bindToGrid(s, created[0].id, 'load')
    expect(await s.kinds()).toContain('load-animation-moves-layout')
  })

  test('an opacity-only load animation is never flagged', async () => {
    const s = await session()
    const { created } = await s.call('create_animations', {
      items: [
        { name: 'Fade', steps: [{ duration: 300, easing: 'ease-out', tracks: [{ prop: 'opacity', from: 0, to: 1 }] }] },
      ],
    })
    await bindToGrid(s, created[0].id, 'load')
    expect(await s.kinds()).not.toContain('load-animation-moves-layout')
  })
})
