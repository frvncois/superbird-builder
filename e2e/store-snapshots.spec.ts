import { test, expect, request as pwRequest, type APIRequestContext } from '@playwright/test'

// /api/snapshots: the project package (store + media) kept ON the server and
// listed, so a restore point is one click rather than a download kept
// somewhere safe. Restoring one is the import. Admin-only, like both.
//
// API-level spec: bootstraps its own admin like store-roles, so it does not
// depend on ordering beyond sorting after smoke.spec.ts.

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }

test('a snapshot is taken, listed, downloadable, restorable and deletable', async ({ baseURL }) => {
  const admin = await pwRequest.newContext({ baseURL })
  let res = await admin.post('/api/auth/login', { data: ADMIN })
  if (!res.ok()) {
    res = await admin.post('/api/auth/setup', { data: { ...ADMIN, name: 'Smoke Co' } })
    expect(res.ok()).toBeTruthy()
  }

  // the store reads as {key: rawJsonString}; writes take the raw string
  const MAIN = 'guano-project:main'
  const readMain = async () =>
    JSON.parse(((await (await admin.get(`/api/store?keys=${MAIN}`)).json()) as Record<string, string>)[MAIN]!)

  // what Main says now, so a restore can be proven to bring it back
  const main = await readMain()
  expect(Array.isArray(main.pages)).toBeTruthy()

  res = await admin.post('/api/snapshots')
  expect(res.ok()).toBeTruthy()
  const snap = (await res.json()) as { id: string; createdAt: number; bytes: number }
  expect(snap.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/)
  expect(snap.bytes).toBeGreaterThan(0)

  const list = (await (await admin.get('/api/snapshots')).json()) as { id: string; bytes: number }[]
  expect(list.map((s) => s.id)).toContain(snap.id)

  // a name is a sidecar: it shows in the list and goes away with the snapshot
  res = await admin.patch(`/api/snapshots/${snap.id}`, { data: { name: '  Before redesign  ' } })
  expect(res.ok()).toBeTruthy()
  const named = (await (await admin.get('/api/snapshots')).json()) as { id: string; name: string }[]
  expect(named.find((s) => s.id === snap.id)?.name).toBe('Before redesign')

  // the download is the package zip itself
  res = await admin.get(`/api/snapshots/${snap.id}`)
  expect(res.ok()).toBeTruthy()
  expect(res.headers()['content-type']).toContain('application/zip')
  expect((await res.body()).subarray(0, 2).toString()).toBe('PK')

  // change Main, then restore: the snapshot's Main is back
  const changed = { ...main, name: 'Changed after snapshot' }
  expect((await admin.put(`/api/store/${MAIN}`, { data: JSON.stringify(changed) })).ok()).toBeTruthy()
  expect((await readMain()).name).toBe('Changed after snapshot')
  res = await admin.post(`/api/snapshots/${snap.id}/restore`)
  expect(res.ok()).toBeTruthy()
  expect((await readMain()).name).toBe(main.name)

  expect((await admin.delete(`/api/snapshots/${snap.id}`)).ok()).toBeTruthy()
  const after = (await (await admin.get('/api/snapshots')).json()) as { id: string }[]
  expect(after.map((s) => s.id)).not.toContain(snap.id)

  // an id that is not a snapshot id never reaches the filesystem
  expect((await admin.get('/api/snapshots/..%2F..%2Fusers.json')).status()).toBe(400)
  expect((await admin.get('/api/snapshots/2099-01-01T00-00-00-000Z')).status()).toBe(404)
})

test('snapshots are admin-only', async ({ baseURL }) => {
  const anon = await pwRequest.newContext({ baseURL })
  expect((await anon.get('/api/snapshots')).status()).toBe(401)
  expect((await anon.post('/api/snapshots')).status()).toBe(401)
})
