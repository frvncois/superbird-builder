// Superbird server: auth, editor storage, publishing, static site.
// POST /api/auth/setup|login|logout, GET /api/auth/me — session cookie
// GET/PUT/DELETE /api/store[...]  🔒 the editor's persistence (per key)
// /api/media[...]                 🔒 media library (see media.mjs)
// /media/:id, /media/thumb/:id    🌐 library bytes (falls back to exported site)
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
import { readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportSite } from './export.mjs'
import { handleMedia, handleMediaFile, originAllowed } from './media.mjs'
import { fail, send, timingSafeEqualStr, writeAtomic } from './util.mjs'
import {
  ROLES,
  acceptInvite,
  clearCookieHeader,
  createFirstAdmin,
  createInvite,
  createSession,
  deleteUser,
  destroySession,
  findInviteByToken,
  findUserByEmail,
  hasValidRole,
  inviteAllowed,
  inviteView,
  listInvites,
  listInvitesPublic,
  listMembers,
  listUsers,
  loginAllowed,
  needsSetup,
  recordInviteAttempt,
  recordLoginFailure,
  revokeInvite,
  updateInvite,
  sessionCookieHeader,
  sessionTokenOf,
  sessionUser,
  setUserRole,
  updateUser,
  userProfile,
  verifyLogin,
  verifyUserPassword,
} from './auth.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
// SB_DATA_DIR overrides the runtime data location (deploys / isolated e2e);
// defaults to server/data. Use an ABSOLUTE path — the exporter's write-path
// backstop rejects a relative one. auth.mjs and media.mjs honor the same var.
const DATA_DIR = process.env.SB_DATA_DIR || join(ROOT, 'server', 'data')
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

const isEmail = (v) => typeof v === 'string' && /.+@.+\..+/.test(v)

async function handleAuth(req, res, path) {
  if (path === '/api/auth/me' && req.method === 'GET') {
    if (needsSetup()) return send(res, 401, JSON.stringify({ needsSetup: true }))
    const user = sessionUser(req)
    if (!user) return send(res, 401, JSON.stringify({ needsSetup: false }))
    return send(res, 200, JSON.stringify(userProfile(user)))
  }
  if (path === '/api/auth/setup' && req.method === 'POST') {
    // bootstrap the first admin — only when no users exist yet
    if (!needsSetup()) return fail(res, 403, 'account already exists')
    const body = await readBody(req)
    let email, password, name
    try {
      ;({ email, password, name } = JSON.parse(body ?? ''))
    } catch {
      return fail(res, 400, 'invalid request')
    }
    if (!isEmail(email)) return fail(res, 400, 'invalid email')
    if (typeof password !== 'string' || password.length < 8) {
      return fail(res, 400, 'password must be at least 8 characters')
    }
    const user = await createFirstAdmin(email, password, typeof name === 'string' ? name : '')
    if (!user) return fail(res, 403, 'account already exists')
    return send(res, 200, JSON.stringify(userProfile(user)), 'application/json', {
      'set-cookie': sessionCookieHeader(createSession(user.id)),
    })
  }
  if (path === '/api/auth/update' && req.method === 'POST') {
    const user = sessionUser(req)
    if (!user) return fail(res, 401, 'unauthorized')
    const body = await readBody(req)
    let name, email, password, currentPassword
    try {
      ;({ name, email, password, currentPassword } = JSON.parse(body ?? ''))
    } catch {
      return fail(res, 400, 'invalid request')
    }
    if (email !== undefined && !isEmail(email)) {
      return fail(res, 400, 'invalid email')
    }
    if (password !== undefined && password !== '') {
      if (typeof password !== 'string' || password.length < 8) {
        return fail(res, 400, 'password must be at least 8 characters')
      }
      if (!verifyUserPassword(user, currentPassword ?? '')) {
        return fail(res, 403, 'current password is incorrect')
      }
    }
    // guard against colliding with another user's email
    if (email && email.toLowerCase() !== user.email) {
      const clash = findUserByEmail(email)
      if (clash && clash.id !== user.id) {
        return fail(res, 409, 'that email is already in use')
      }
    }
    const updated = await updateUser(user.id, { name, email, password })
    return send(res, 200, JSON.stringify(userProfile(updated)))
  }
  if (path === '/api/auth/login' && req.method === 'POST') {
    if (needsSetup()) return fail(res, 403, 'no account yet')
    const ip = req.socket.remoteAddress ?? '?'
    const body = await readBody(req)
    let email, password
    try {
      ;({ email, password } = JSON.parse(body ?? ''))
    } catch {
      return fail(res, 400, 'invalid request')
    }
    if (!loginAllowed(ip, email)) {
      return fail(res, 429, 'too many attempts — try again later')
    }
    const user = verifyLogin(email, password)
    if (!user) {
      recordLoginFailure(ip, email)
      return fail(res, 401, 'invalid credentials')
    }
    // never issue a session to an un-provisioned account (no valid role)
    if (!hasValidRole(user)) {
      return fail(res, 403, 'account is not provisioned — contact an admin')
    }
    return send(res, 200, JSON.stringify(userProfile(user)), 'application/json', {
      'set-cookie': sessionCookieHeader(createSession(user.id)),
    })
  }
  if (path === '/api/auth/logout' && req.method === 'POST') {
    const token = sessionTokenOf(req)
    if (token) destroySession(token)
    return send(res, 200, JSON.stringify({ ok: true }), 'application/json', {
      'set-cookie': clearCookieHeader(),
    })
  }
  return fail(res, 404, 'not found')
}

// ---------- invites (public: link lookup + acceptance) ----------

async function handleInvite(req, res, path) {
  const ip = req.socket.remoteAddress ?? '?'
  if (!inviteAllowed(ip)) {
    return fail(res, 429, 'too many attempts — try again later')
  }
  recordInviteAttempt(ip)

  const rest = path.slice('/api/invite/'.length)
  const accept = rest.endsWith('/accept')
  const token = decodeURIComponent(accept ? rest.slice(0, -'/accept'.length) : rest)

  if (!accept && req.method === 'GET') {
    const invite = findInviteByToken(token)
    if (!invite) return fail(res, 404, 'invalid or expired invite')
    // inviteView carries invitedBy; add the project name for the welcome
    return send(res, 200, JSON.stringify({ ...inviteView(invite), projectName: await currentProjectName() }))
  }
  if (accept && req.method === 'POST') {
    const body = await readBody(req)
    let password
    try {
      ;({ password } = JSON.parse(body ?? ''))
    } catch {
      return fail(res, 400, 'invalid request')
    }
    if (typeof password !== 'string' || password.length < 8) {
      return fail(res, 400, 'password must be at least 8 characters')
    }
    const result = await acceptInvite(token, password)
    if (result.error) return fail(res, 400, result.error)
    return send(res, 200, JSON.stringify(userProfile(result.user)), 'application/json', {
      'set-cookie': sessionCookieHeader(createSession(result.user.id)),
    })
  }
  return fail(res, 404, 'not found')
}

// ---------- user management ----------

async function handleUsers(req, res, path) {
  const admin = sessionUser(req)
  if (!admin) return fail(res, 401, 'unauthorized')

  // team visibility for everyone: a redacted, read-only membership view (no
  // tokens/ids). Gated only on being authenticated — sits BEFORE the admin gate.
  if (path === '/api/users/members' && req.method === 'GET') {
    return send(res, 200, JSON.stringify({ users: listMembers(), invites: listInvitesPublic() }))
  }

  // everything else is admin-only
  if (admin.role !== 'admin') return fail(res, 403, 'forbidden')

  if (path === '/api/users' && req.method === 'GET') {
    return send(res, 200, JSON.stringify({ users: listUsers(), invites: listInvites() }))
  }
  if (path === '/api/users/invite' && req.method === 'POST') {
    const body = await readBody(req)
    let name, email, role
    try {
      ;({ name, email, role } = JSON.parse(body ?? ''))
    } catch {
      return fail(res, 400, 'invalid request')
    }
    if (!isEmail(email)) return fail(res, 400, 'invalid email')
    if (!ROLES.includes(role)) return fail(res, 400, 'invalid role')
    if (findUserByEmail(email)) {
      return fail(res, 409, 'that email already has an account')
    }
    // record who invited them, for the branded accept page
    const { invite, token } = await createInvite({ name, email, role, invitedBy: admin.name })
    return send(res, 200, JSON.stringify({ ...inviteView(invite), token }))
  }

  // /api/users/invite/:id  (revoke / edit)   and   /api/users/:id  (role / delete)
  const tail = path.slice('/api/users/'.length)
  if (tail.startsWith('invite/') && req.method === 'DELETE') {
    const ok = await revokeInvite(tail.slice('invite/'.length))
    return send(res, ok ? 200 : 404, JSON.stringify(ok ? { ok: true } : { error: 'not found' }))
  }
  if (tail.startsWith('invite/') && req.method === 'PATCH') {
    const body = await readBody(req)
    let patch
    try {
      patch = JSON.parse(body ?? '')
    } catch {
      return fail(res, 400, 'invalid request')
    }
    if (patch.role !== undefined && !ROLES.includes(patch.role)) {
      return fail(res, 400, 'invalid role')
    }
    const updated = await updateInvite(tail.slice('invite/'.length), patch)
    if (!updated) return fail(res, 404, 'not found')
    return send(res, 200, JSON.stringify(updated))
  }
  const id = tail
  if (id && req.method === 'PATCH') {
    const body = await readBody(req)
    let role
    try {
      ;({ role } = JSON.parse(body ?? ''))
    } catch {
      return fail(res, 400, 'invalid request')
    }
    if (!ROLES.includes(role)) return fail(res, 400, 'invalid role')
    const updated = await setUserRole(id, role)
    if (!updated) return fail(res, 409, 'cannot change that role')
    return send(res, 200, JSON.stringify(userProfile(updated)))
  }
  if (id && req.method === 'DELETE') {
    const ok = await deleteUser(id)
    if (!ok) return fail(res, 409, 'cannot remove that user')
    return send(res, 200, JSON.stringify({ ok: true }))
  }
  return fail(res, 404, 'not found')
}

// ---------- authed key-value store (the editor's persistence) ----------

const STORE_DIR = join(DATA_DIR, 'store')
const STORE_KEY_RE = /^[A-Za-z0-9:_-]{1,100}$/

const storeFile = (key) => join(STORE_DIR, key.replaceAll(':', '__') + '.json')

/** the current project name from the main-branch store blob (for the invite
 * welcome). Best-effort — '' when there's nothing stored yet. */
async function currentProjectName() {
  try {
    const name = JSON.parse(await readFile(storeFile('superbird-project:main'), 'utf8'))?.name
    return typeof name === 'string' ? name : ''
  } catch {
    return ''
  }
}

// canonical (key-order-insensitive) serialization, so a re-serialized but
// semantically identical field never reads as a change
function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  if (v && typeof v === 'object') {
    return (
      '{' +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + stableStringify(v[k]))
        .join(',') +
      '}'
    )
  }
  return JSON.stringify(v ?? null)
}

// the fields a contributor must never change: custom code (published as raw
// <script>) and mail credentials (SECURITY.md S1)
function sensitiveProjectFields(project) {
  const settings = project?.settings ?? {}
  return {
    smtp: settings.smtp ?? null,
    customCode: settings.customCode ?? null,
    pages: Array.isArray(project?.pages)
      ? project.pages.map((p) => [p?.id ?? null, p?.customCode ?? null])
      : [],
  }
}

/**
 * For a contributor writing a project key: reject (returns an error string)
 * when the write would change customCode or smtp vs the stored copy. The
 * contributor UI (content mode) can't touch those fields, so a legitimate
 * autosave carries them unchanged and passes; only a hand-crafted PUT trips
 * it. Returns null when the write is allowed.
 */
async function contributorProjectRejection(key, body) {
  let current
  try {
    current = JSON.parse(await readFile(storeFile(key), 'utf8'))
  } catch {
    // fail closed: a contributor has no legitimate reason to write a project
    // with no stored baseline (only an admin seeds one). A backup restore or
    // wiped seed must not silently open a write window for the whole blob.
    return 'contributors cannot create a project'
  }
  let incoming
  try {
    incoming = JSON.parse(body)
  } catch {
    return 'invalid project snapshot'
  }
  const before = stableStringify(sensitiveProjectFields(current))
  const after = stableStringify(sensitiveProjectFields(incoming))
  return before === after ? null : 'contributors cannot change custom code or mail settings'
}

const isProjectKey = (key) => key.startsWith('superbird-project:')

async function handleStore(req, res, path, query) {
  // any authenticated user (incl. contributors editing content) may use the store
  const user = sessionUser(req)
  if (!user) return fail(res, 401, 'unauthorized')

  if (path === '/api/store' && req.method === 'GET') {
    const keys = (query.get('keys') ?? '').split(',').filter(Boolean)
    if (!keys.length || keys.some((k) => !STORE_KEY_RE.test(k))) {
      return fail(res, 400, 'invalid keys')
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
  if (!STORE_KEY_RE.test(key)) return fail(res, 400, 'invalid key')

  if (req.method === 'PUT') {
    const body = await readBody(req)
    if (body === null) return fail(res, 400, 'too large')
    if (user.role === 'contributor' && isProjectKey(key)) {
      const rejection = await contributorProjectRejection(key, body)
      if (rejection) return fail(res, 403, rejection)
    }
    await writeAtomic(storeFile(key), body)
    return send(res, 200, JSON.stringify({ ok: true }))
  }
  if (req.method === 'DELETE') {
    await rm(storeFile(key), { force: true })
    return send(res, 200, JSON.stringify({ ok: true }))
  }
  return fail(res, 404, 'not found')
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
    fail(res, 404, 'nothing published yet')
  }
}

async function handlePost(req, res) {
  // the session is the credential; PUBLISH_TOKEN stays as a CI escape hatch.
  // Publishing is admin/editor only — contributors are content-only.
  const bearerOk = !!TOKEN && timingSafeEqualStr(req.headers.authorization ?? '', `Bearer ${TOKEN}`)
  if (!bearerOk) {
    const user = sessionUser(req)
    if (!user) return fail(res, 401, 'unauthorized')
    if (user.role === 'contributor') return fail(res, 403, 'forbidden')
  }
  const raw = await readBody(req)
  if (raw === null) return fail(res, 400, 'snapshot too large')
  let parsed
  try {
    parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.pages) || !parsed.pages.length) throw new Error('no pages')
  } catch {
    return fail(res, 400, 'invalid project snapshot')
  }
  await writeAtomic(SNAPSHOT, raw) // atomic: readers never see a partial write
  // static export: on failure the snapshot stays saved and the previous
  // exported site stays live (atomic swap inside exportSite)
  try {
    const stats = await exportSite(parsed, SITE)
    send(res, 200, JSON.stringify({ ok: true, ...stats }))
  } catch (err) {
    // full detail to the server log only; the client gets a generic
    // message (never leak fs paths / compiler internals in the response) —
    // except errors the exporter explicitly marked safe to expose
    console.error(err)
    if (err?.expose) return fail(res, 502, err.message)
    fail(res, 500, 'export failed — check the server logs')
  }
}

async function handleStatic(req, res) {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname))
  // content-type is authoritative (extension-mapped) — never sniffed
  const NOSNIFF = { 'x-content-type-options': 'nosniff' }

  // the editor SPA: /admin routes, its built assets, and real dist files
  const distFile = join(DIST, path)
  const isDistFile =
    distFile.startsWith(DIST) && extname(distFile) !== '' && existsSync(distFile)
  if (path === '/admin' || path.startsWith('/admin/') || path.startsWith('/assets/') || isDistFile) {
    const target = isDistFile ? distFile : join(DIST, 'index.html')
    try {
      const data = await readFile(target)
      return send(res, 200, data, MIME[extname(target)] ?? 'application/octet-stream', NOSNIFF)
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
    send(res, 200, data, MIME[extname(target)] ?? 'application/octet-stream', NOSNIFF)
  } catch {
    try {
      send(res, 404, await readFile(join(SITE, '404.html')), MIME['.html'], NOSNIFF)
    } catch {
      send(res, 404, 'Nothing published yet.', 'text/plain')
    }
  }
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x')
    const path = url.pathname
    // CSRF defense-in-depth (on top of the SameSite=Lax cookie): every
    // mutating API request must be same-origin. Non-browser clients send no
    // Origin header and pass — the CI bearer publish keeps working.
    if (path.startsWith('/api/') && req.method !== 'GET' && !originAllowed(req)) {
      return fail(res, 403, 'cross-origin request rejected')
    }
    if (path === '/api/published' && req.method === 'GET') return await handleGet(res)
    if (path === '/api/published' && req.method === 'POST') return await handlePost(req, res)
    if (path.startsWith('/api/auth/')) return await handleAuth(req, res, path)
    if (path.startsWith('/api/invite/')) return await handleInvite(req, res, path)
    if (path === '/api/users' || path.startsWith('/api/users/')) {
      return await handleUsers(req, res, path)
    }
    if (path === '/api/store' || path.startsWith('/api/store/')) {
      return await handleStore(req, res, path, url.searchParams)
    }
    if (path === '/api/media' || path.startsWith('/api/media/')) {
      return await handleMedia(req, res, path, url.searchParams)
    }
    if (path.startsWith('/api/')) return fail(res, 404, 'not found')
    // library assets first; unknown /media/ paths fall through to the
    // exported site (its hashed files live under the same prefix)
    if (path.startsWith('/media/')) {
      if (await handleMediaFile(req, res, path, url.searchParams)) return
    }
    return await handleStatic(req, res)
  } catch (err) {
    console.error(err)
    fail(res, 500, 'internal error')
  }
}).listen(PORT, () => {
  console.log(`superbird server on http://localhost:${PORT}${TOKEN ? ' (publish token required)' : ''}`)
})
