import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'

// FINDINGS S2: contributors must not be able to DELETE store keys (the PUT
// guard already blocks customCode/smtp changes). API-level spec — runs on the
// same isolated server as the rest of the suite and bootstraps its own users,
// so it does not depend on spec ordering.

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }
const CONTRIB = { email: 'contrib@example.com', password: 'contrib-pass-1' }
const PROJECT_KEY = 'guano-project:main'

async function login(ctx: APIRequestContext, creds: { email: string; password: string }) {
  return ctx.post('/api/auth/login', { data: creds })
}

test('contributor store permissions: PUT unchanged ok, sensitive PUT and DELETE 403', async ({
  baseURL,
}) => {
  // --- admin session (create the first admin if this spec runs first) ---
  const admin = await pwRequest.newContext({ baseURL })
  let res = await login(admin, ADMIN)
  if (!res.ok()) {
    res = await admin.post('/api/auth/setup', { data: { ...ADMIN, name: 'Smoke Co' } })
    expect(res.ok()).toBeTruthy()
  }

  // --- ensure a project blob exists for the guard's stored baseline ---
  let projectBody: string
  const existing = await admin.get(`/api/store?keys=${PROJECT_KEY}`)
  const stored = (await existing.json()) as Record<string, string>
  if (stored[PROJECT_KEY]) {
    projectBody = stored[PROJECT_KEY]
  } else {
    projectBody = JSON.stringify({ name: 'Roles Co', pages: [], settings: {} })
    res = await admin.put(`/api/store/${PROJECT_KEY}`, { data: projectBody })
    expect(res.ok()).toBeTruthy()
  }

  // --- invite + accept a contributor ---
  res = await admin.post('/api/users/invite', {
    data: { name: 'Contrib', email: CONTRIB.email, role: 'contributor' },
  })
  let contribCtx: APIRequestContext
  if (res.ok()) {
    const { token } = await res.json()
    contribCtx = await pwRequest.newContext({ baseURL })
    res = await contribCtx.post(`/api/invite/${token}/accept`, {
      data: { password: CONTRIB.password },
    })
    expect(res.ok()).toBeTruthy()
  } else {
    // already invited+accepted on a previous run against the same data dir
    contribCtx = await pwRequest.newContext({ baseURL })
    res = await login(contribCtx, CONTRIB)
    expect(res.ok()).toBeTruthy()
  }

  // --- contributor autosave shape: PUT with sensitive fields unchanged → ok ---
  res = await contribCtx.put(`/api/store/${PROJECT_KEY}`, { data: projectBody })
  expect(res.status()).toBe(200)

  // --- contributor PUT that alters customCode → 403 (existing guard) ---
  const tampered = JSON.parse(projectBody)
  tampered.settings = { ...(tampered.settings ?? {}), customCode: { head: '<script>evil()</script>' } }
  res = await contribCtx.put(`/api/store/${PROJECT_KEY}`, { data: JSON.stringify(tampered) })
  expect(res.status()).toBe(403)

  // --- contributor DELETE of any store key → 403 (S2 fix) ---
  res = await contribCtx.delete(`/api/store/${PROJECT_KEY}`)
  expect(res.status()).toBe(403)
  res = await contribCtx.delete('/api/store/guano-branches')
  expect(res.status()).toBe(403)

  // --- the project blob is still there, and admins can still delete keys ---
  const after = (await (await admin.get(`/api/store?keys=${PROJECT_KEY}`)).json()) as Record<
    string,
    string
  >
  expect(after[PROJECT_KEY]).toBeTruthy()
  res = await admin.put('/api/store/scratch-role-spec', { data: '{"x":1}' })
  expect(res.ok()).toBeTruthy()
  res = await admin.delete('/api/store/scratch-role-spec')
  expect(res.status()).toBe(200)

  await admin.dispose()
  await contribCtx.dispose()
})
