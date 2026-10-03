import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'

// POST /api/preview renders the posted snapshot to its OWN site, on its own
// port, and touches nothing live.
//
// Without it publishing was the only way to render anything, so the Cocoapp
// review session published six of its seven times purely to look — each one
// replacing the live origin with a half-built draft. The preview also includes
// DRAFT pages, which a publish drops and which are exactly what you need to see
// while building.
//
// API-level spec: bootstraps its own admin like store-roles, so it does not
// depend on ordering beyond sorting after smoke.spec.ts.

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }

const login = (ctx: APIRequestContext, creds = ADMIN) =>
  ctx.post('/api/auth/login', { data: creds })

/** a two-page project: one published, one draft */
const snapshot = () => ({
  name: 'Preview Co',
  pages: [
    {
      id: 'p1',
      name: 'Home',
      path: '/',
      status: 'published',
      elements: [
        {
          id: 'b1',
          type: 'body',
          children: [{ id: 'h1', type: 'h1', content: 'Live home', children: [] }],
        },
      ],
    },
    {
      id: 'p2',
      name: 'Draft',
      path: '/draft',
      status: 'draft',
      elements: [
        {
          id: 'b2',
          type: 'body',
          children: [{ id: 'h2', type: 'h1', content: 'Work in progress', children: [] }],
        },
      ],
    },
  ],
  components: [],
  collections: [],
  interactions: [],
  animations: [],
  breakpoints: [],
  comments: [],
  locales: ['en'],
  defaultLocale: 'en',
  settings: {
    publishing: { method: 'server', github: { repo: '', branch: '' } },
    seo: { siteName: 'P', titleTemplate: '%s', description: '' },
    domain: '',
    smtp: {},
    integrations: { stripe: {}, mailing: {} },
    tokens: [],
    customCode: { head: '' },
    fonts: { family: 'sans' },
  },
})

test('a preview renders to its own site, includes drafts, and leaves the live one alone', async ({
  baseURL,
}) => {
  const admin = await pwRequest.newContext({ baseURL })
  let res = await login(admin)
  if (!res.ok()) {
    res = await admin.post('/api/auth/setup', { data: { ...ADMIN, name: 'Smoke Co' } })
    expect(res.ok()).toBeTruthy()
  }

  // what the live site says now, so we can prove the preview did not touch it
  const liveBefore = await (await admin.get('/')).text()

  res = await admin.post('/api/preview', { data: snapshot() })
  expect(res.ok()).toBeTruthy()
  const body = (await res.json()) as { routes: number; bytes: number; url: string }
  expect(body.routes).toBe(2) // the draft is rendered too
  expect(body.url).toMatch(/^http:\/\/[^/]+:\d+\/$/)

  // the preview answers on its own port
  const previewCtx = await pwRequest.newContext({ baseURL: body.url })
  const home = await previewCtx.get('/')
  expect(home.ok()).toBeTruthy()
  expect(await home.text()).toContain('Live home')
  // unfinished work is never indexed
  expect(home.headers()['x-robots-tag']).toContain('noindex')

  // the DRAFT page renders here, which a publish would have dropped
  const draft = await previewCtx.get('/draft/')
  expect(draft.ok()).toBeTruthy()
  expect(await draft.text()).toContain('Work in progress')

  // the editor is not reachable from the preview port
  expect((await previewCtx.get('/admin/')).status()).toBe(404)
  expect((await previewCtx.get('/api/preview')).status()).toBe(404)

  // and the live site is exactly as it was
  expect(await (await admin.get('/')).text()).toBe(liveBefore)

  await previewCtx.dispose()
  await admin.dispose()
})

test('a preview needs a session', async ({ baseURL }) => {
  const anon = await pwRequest.newContext({ baseURL })
  const res = await anon.post('/api/preview', { data: snapshot() })
  expect(res.status()).toBe(401)
  await anon.dispose()
})
