// Superbird server: auth, editor storage, publishing, static site.
// POST /api/auth/setup|login|logout, GET /api/auth/me — session cookie
// GET/PUT/DELETE /api/store[...]  🔒 the editor's persistence (per key)
// POST /api/published             🔒 snapshot + static export
// GET  /api/published             🌐 public (smtp redacted)
// /admin*, /assets/*              → the built SPA from dist/ (the editor)
// everything else                 → the exported static site
//
// Dev:    node server/index.mjs   (REQUIRED alongside `npm run dev` —
//         the editor boots from /api; vite proxies /api here)
// Deploy: npm run build && NODE_ENV=production PORT=80 node server/index.mjs
//         (needs node_modules; the session cookie is Secure automatically
//         under NODE_ENV=production — COOKIE_SECURE=0 forces it off, =1 on;
//         PUBLISH_TOKEN optionally allows CI publishes)

import { createServer } from 'node:http'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportSite } from './export.mjs'
import {
  clearCookieHeader,
  createAccount,
  createSession,
  destroySession,
  getAccount,
  loginAllowed,
  recordFailure,
  requireSession,
  sessionCookieHeader,
  sessionTokenOf,
  updateAccount,
  verifyPassword,
} from './auth.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DATA_DIR = join(ROOT, 'server', 'data')
const SNAPSHOT = join(DATA_DIR, 'published.json')
const SITE = join(DATA_DIR, 'site')
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.PORT) || 4174
const TOKEN = process.env.PUBLISH_TOKEN || ''
const MAX_BODY = 10 * 1024 * 1024 // data-URL images make snapshots heavy

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ico': 'image/x-icon',
}

function send(res, status, body, type = 'application/json', headers = {}) {
  res.writeHead(status, { 'content-type': type, ...headers })
  res.end(body)
}

/** reads a request body with the size cap; null when too large */
async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

// ---------- auth endpoints ----------

async function handleAuth(req, res, path) {
  const profile = () => ({ email: getAccount().email, name: getAccount().name ?? '' })

  if (path === '/api/auth/me' && req.method === 'GET') {
    if (!getAccount()) return send(res, 401, JSON.stringify({ needsSetup: true }))
    if (!requireSession(req)) return send(res, 401, JSON.stringify({ needsSetup: false }))
    return send(res, 200, JSON.stringify(profile()))
  }
  if (path === '/api/auth/setup' && req.method === 'POST') {
    if (getAccount()) return send(res, 403, JSON.stringify({ error: 'account already exists' }))
    const body = await readBody(req)
    let email, password, name
    try {
      ;({ email, password, name } = JSON.parse(body ?? ''))
    } catch {
      return send(res, 400, JSON.stringify({ error: 'invalid request' }))
    }
    if (!/.+@.+\..+/.test(email ?? '')) {
      return send(res, 400, JSON.stringify({ error: 'invalid email' }))
    }
    if (typeof password !== 'string' || password.length < 8) {
      return send(res, 400, JSON.stringify({ error: 'password must be at least 8 characters' }))
    }
    await createAccount(email, password, typeof name === 'string' ? name : '')
    const token = createSession()
    return send(res, 200, JSON.stringify(profile()), 'application/json', {
      'set-cookie': sessionCookieHeader(token),
    })
  }
  if (path === '/api/auth/update' && req.method === 'POST') {
    if (!requireSession(req)) return send(res, 401, JSON.stringify({ error: 'unauthorized' }))
    const body = await readBody(req)
    let name, email, password, currentPassword
    try {
      ;({ name, email, password, currentPassword } = JSON.parse(body ?? ''))
    } catch {
      return send(res, 400, JSON.stringify({ error: 'invalid request' }))
    }
    if (email !== undefined && !/.+@.+\..+/.test(email)) {
      return send(res, 400, JSON.stringify({ error: 'invalid email' }))
    }
    if (password !== undefined && password !== '') {
      if (typeof password !== 'string' || password.length < 8) {
        return send(res, 400, JSON.stringify({ error: 'password must be at least 8 characters' }))
      }
      if (!verifyPassword(currentPassword ?? '')) {
        return send(res, 403, JSON.stringify({ error: 'current password is incorrect' }))
      }
    }
    await updateAccount({ name, email, password })
    return send(res, 200, JSON.stringify(profile()))
  }
  if (path === '/api/auth/login' && req.method === 'POST') {
    if (!getAccount()) return send(res, 403, JSON.stringify({ error: 'no account yet' }))
    const ip = req.socket.remoteAddress ?? '?'
    if (!loginAllowed(ip)) {
      return send(res, 429, JSON.stringify({ error: 'too many attempts — try again later' }))
    }
    const body = await readBody(req)
    let email, password
    try {
      ;({ email, password } = JSON.parse(body ?? ''))
    } catch {
      return send(res, 400, JSON.stringify({ error: 'invalid request' }))
    }
    const ok =
      typeof email === 'string' &&
      email.toLowerCase() === getAccount().email &&
      typeof password === 'string' &&
      verifyPassword(password)
    if (!ok) {
      recordFailure(ip)
      return send(res, 401, JSON.stringify({ error: 'invalid credentials' }))
    }
    const token = createSession()
    return send(res, 200, JSON.stringify({ email: getAccount().email }), 'application/json', {
      'set-cookie': sessionCookieHeader(token),
    })
  }
  if (path === '/api/auth/logout' && req.method === 'POST') {
    const token = sessionTokenOf(req)
    if (token) destroySession(token)
    return send(res, 200, JSON.stringify({ ok: true }), 'application/json', {
      'set-cookie': clearCookieHeader(),
    })
  }
  return send(res, 404, JSON.stringify({ error: 'not found' }))
}

// ---------- authed key-value store (the editor's persistence) ----------

const STORE_DIR = join(DATA_DIR, 'store')
const STORE_KEY_RE = /^[A-Za-z0-9:_-]{1,100}$/

const storeFile = (key) => join(STORE_DIR, key.replaceAll(':', '__') + '.json')

async function handleStore(req, res, path, query) {
  if (!requireSession(req)) return send(res, 401, JSON.stringify({ error: 'unauthorized' }))

  if (path === '/api/store' && req.method === 'GET') {
    const keys = (query.get('keys') ?? '').split(',').filter(Boolean)
    if (!keys.length || keys.some((k) => !STORE_KEY_RE.test(k))) {
      return send(res, 400, JSON.stringify({ error: 'invalid keys' }))
    }
    const out = {}
    for (const key of keys) {
      try {
        out[key] = await readFile(storeFile(key), 'utf8')
      } catch {
        out[key] = null
      }
    }
    return send(res, 200, JSON.stringify(out))
  }

  const key = decodeURIComponent(path.slice('/api/store/'.length))
  if (!STORE_KEY_RE.test(key)) return send(res, 400, JSON.stringify({ error: 'invalid key' }))

  if (req.method === 'PUT') {
    const body = await readBody(req)
    if (body === null) return send(res, 400, JSON.stringify({ error: 'too large' }))
    await mkdir(STORE_DIR, { recursive: true })
    const file = storeFile(key)
    await writeFile(`${file}.tmp`, body)
    await rename(`${file}.tmp`, file)
    return send(res, 200, JSON.stringify({ ok: true }))
  }
  if (req.method === 'DELETE') {
    await rm(storeFile(key), { force: true })
    return send(res, 200, JSON.stringify({ ok: true }))
  }
  return send(res, 404, JSON.stringify({ error: 'not found' }))
}

async function handleGet(res) {
  try {
    const data = await readFile(SNAPSHOT)
    // Public endpoint (the SPA preview fetches it): expose only what a
    // visitor may see — published pages only (no drafts), no editorial
    // comments, and never the mail credentials. Mirrors what the static
    // export renders (enumerateRoutes drops drafts too).
    const parsed = JSON.parse(data)
    const publicSnapshot = {
      ...parsed,
      pages: Array.isArray(parsed.pages)
        ? parsed.pages.filter((p) => p.status === 'published')
        : [],
      comments: [],
      settings: parsed.settings ? { ...parsed.settings, smtp: undefined } : parsed.settings,
    }
    send(res, 200, JSON.stringify(publicSnapshot))
  } catch {
    send(res, 404, JSON.stringify({ error: 'nothing published yet' }))
  }
}

async function handlePost(req, res) {
  // the session is the credential; PUBLISH_TOKEN stays as a CI escape hatch
  const bearerOk = TOKEN && req.headers.authorization === `Bearer ${TOKEN}`
  if (!requireSession(req) && !bearerOk) {
    return send(res, 401, JSON.stringify({ error: 'unauthorized' }))
  }
  const raw = await readBody(req)
  if (raw === null) return send(res, 400, JSON.stringify({ error: 'snapshot too large' }))
  let parsed
  try {
    parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.pages) || !parsed.pages.length) throw new Error('no pages')
  } catch {
    return send(res, 400, JSON.stringify({ error: 'invalid project snapshot' }))
  }
  await mkdir(DATA_DIR, { recursive: true })
  const tmp = `${SNAPSHOT}.tmp`
  await writeFile(tmp, raw)
  await rename(tmp, SNAPSHOT) // atomic: readers never see a partial write
  // static export: on failure the snapshot stays saved and the previous
  // exported site stays live (atomic swap inside exportSite)
  try {
    const stats = await exportSite(parsed, SITE)
    send(res, 200, JSON.stringify({ ok: true, ...stats }))
  } catch (err) {
    // full detail to the server log only; the client gets a generic
    // message (never leak fs paths / compiler internals in the response)
    console.error(err)
    send(res, 500, JSON.stringify({ error: 'export failed — check the server logs' }))
  }
}

async function handleStatic(req, res) {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname))

  // the editor SPA: /admin routes, its built assets, and real dist files
  const distFile = join(DIST, path)
  const isDistFile =
    distFile.startsWith(DIST) && extname(distFile) !== '' && existsSync(distFile)
  if (path === '/admin' || path.startsWith('/admin/') || path.startsWith('/assets/') || isDistFile) {
    const target = isDistFile ? distFile : join(DIST, 'index.html')
    try {
      const data = await readFile(target)
      return send(res, 200, data, MIME[extname(target)] ?? 'application/octet-stream')
    } catch {
      return send(res, 404, 'Not found — run `npm run build` first.', 'text/plain')
    }
  }

  // the published static site (exported media lives under /media/,
  // never /assets/, to avoid colliding with the SPA bundles above)
  const exact = join(SITE, path)
  const target =
    exact.startsWith(SITE) && extname(exact) !== '' && existsSync(exact)
      ? exact
      : join(SITE, path, 'index.html')
  try {
    const data = await readFile(target)
    send(res, 200, data, MIME[extname(target)] ?? 'application/octet-stream')
  } catch {
    try {
      send(res, 404, await readFile(join(SITE, '404.html')), MIME['.html'])
    } catch {
      send(res, 404, 'Nothing published yet.', 'text/plain')
    }
  }
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x')
    const path = url.pathname
    if (path === '/api/published' && req.method === 'GET') return await handleGet(res)
    if (path === '/api/published' && req.method === 'POST') return await handlePost(req, res)
    if (path.startsWith('/api/auth/')) return await handleAuth(req, res, path)
    if (path === '/api/store' || path.startsWith('/api/store/')) {
      return await handleStore(req, res, path, url.searchParams)
    }
    if (path.startsWith('/api/')) return send(res, 404, JSON.stringify({ error: 'not found' }))
    return await handleStatic(req, res)
  } catch (err) {
    console.error(err)
    send(res, 500, JSON.stringify({ error: 'internal error' }))
  }
}).listen(PORT, () => {
  console.log(`superbird server on http://localhost:${PORT}${TOKEN ? ' (publish token required)' : ''}`)
})
