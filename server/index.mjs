// Guano server: auth, editor storage, publishing, static site.
// POST /api/auth/setup|login|logout, GET /api/auth/me — session cookie
// GET/PUT/DELETE /api/store[...]  🔒 the editor's persistence (per key)
// /api/media[...]                 🔒 media library (see media.mjs)
// /media/:id, /media/thumb/:id    🌐 library bytes (editor media library)
// POST /api/published             🔒 snapshot + static export
// /admin*                         → the built SPA from dist/ (the editor;
//                                   Vite base '/admin/' → /admin/assets/*)
// everything else                 → the exported static site (incl. /assets/*)
//
// Dev:    node server/index.mjs   (REQUIRED alongside `npm run dev` —
//         the editor boots from /api; vite proxies /api here)
// Deploy: npm run build && NODE_ENV=production PORT=80 node server/index.mjs
//         (needs node_modules; the session cookie is Secure automatically
//         under NODE_ENV=production — COOKIE_SECURE=0 forces it off, =1 on;
//         PUBLISH_TOKEN optionally allows CI publishes)

import { createServer } from 'node:http'
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportSite } from './export.mjs'
import {
  handleMedia,
  handleMediaFile,
  originAllowed,
  resetMediaIndexCache,
  mediaIndexData,
  mediaUploadFromBuffer,
} from './media.mjs'
import { pushSiteToGitHub } from './github.mjs'
import { createZip, readZip } from './zip.mjs'
import { DATA_DIR, fail, readDirFiles, send, timingSafeEqualStr, writeAtomic } from './util.mjs'
import {
  ROLES,
  acceptInvite,
  apiTokenAllowed,
  apiTokenCount,
  apiTokenUser,
  bootstrapConnectToken,
  clearCookieHeader,
  createApiToken,
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
  listApiTokens,
  recordApiTokenFailure,
  revokeApiToken,
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
  VerifyBusyError,
} from './auth.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
// data location resolution (env overrides, install-aware default) lives in
// util.mjs — one home for index/auth/media/export-media
if (!process.env.GUANO_DATA_DIR && process.env.SB_DATA_DIR) {
  console.warn('SB_DATA_DIR is deprecated — use GUANO_DATA_DIR')
}
const SNAPSHOT = join(DATA_DIR, 'published.json')
const SITE = join(DATA_DIR, 'site')
const MEDIA_DIR = join(DATA_DIR, 'media')
// server-managed publish config — the GitHub token lives here, NEVER in the
// /api/store project blob (which any authed user can read)
const PUBLISH_CONFIG = join(DATA_DIR, 'publish.json')
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.PORT) || 4174
const TOKEN = process.env.PUBLISH_TOKEN || ''
const MAX_BODY = 10 * 1024 * 1024 // data-URL images make snapshots heavy
const IMPORT_CAP = 512 * 1024 * 1024 // project package upload ceiling

// Behind a reverse proxy every socket carries the proxy's address, so rate
// limiting by socket IP throttles all users as one client and can't tell
// attackers apart. TRUST_PROXY=1 (only set it when a proxy is actually in
// front) switches to the LAST X-Forwarded-For hop — the one appended by the
// nearest proxy; earlier entries are client-controlled and trivially spoofed.
// Without a proxy the header must stay ignored, or anyone could mint fresh
// "IPs" per request and bypass the limiter entirely.
const TRUST_PROXY = process.env.TRUST_PROXY === '1'
function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for']
    const last = typeof xff === 'string' ? xff.split(',').pop().trim() : ''
    if (last) return last
  }
  return req.socket.remoteAddress ?? '?'
}

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

/** reads a request body as a raw Buffer with a size cap; null when too large
 * (zip uploads can't go through the utf8 readBody) */
async function readBodyRaw(req, cap) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > cap) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** the server-managed publish config (holds the GitHub token). Always returns
 * a well-formed shape so callers can read `.github.token` unconditionally. */
async function readPublishConfig() {
  try {
    const parsed = JSON.parse(await readFile(PUBLISH_CONFIG, 'utf8'))
    return { github: { token: parsed?.github?.token ?? '' } }
  } catch {
    return { github: { token: '' } }
  }
}

// ---------- auth endpoints ----------

const isEmail = (v) => typeof v === 'string' && /.+@.+\..+/.test(v)

/**
 * The user for a request: session cookie first, then a `guano_` API-token
 * bearer (the MCP server's credential), rate-limited per IP on failure.
 * Returns null when neither authenticates. The token resolves to its owner
 * with a LIVE role, so every existing role gate keeps working unchanged.
 * PUBLISH_TOKEN (CI, no `guano_` prefix) is handled separately in handlePost.
 */
function requestUser(req) {
  const session = sessionUser(req)
  if (session) return session
  const auth = req.headers.authorization ?? ''
  if (!auth.startsWith('Bearer guano_')) return null
  const ip = clientIp(req)
  if (!apiTokenAllowed(ip)) return null
  const user = apiTokenUser(auth.slice('Bearer '.length))
  if (!user) recordApiTokenFailure(ip)
  return user
}

async function handleAuth(req, res, path) {
  if (path === '/api/auth/me' && req.method === 'GET') {
    if (needsSetup()) return send(res, 401, JSON.stringify({ needsSetup: true }))
    // session cookie or a `guano_` API-token bearer — the MCP server calls this
    // on boot to fail fast on a bad URL/token and to learn who it is
    const user = requestUser(req)
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
  if (path === '/api/auth/connect' && req.method === 'POST') {
    // local-trust bootstrap for `guano connect`: the CLI writes a random nonce
    // into DATA_DIR and sends it here — being able to write the data dir IS
    // ownership of the instance, so no session/token is needed. Loopback only,
    // single-use nonce (deleted on every attempt, match or not).
    const ip = req.socket.remoteAddress
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) {
      return fail(res, 403, 'connect bootstrap is local-only')
    }
    const body = await readBody(req)
    let nonce, name
    try {
      ;({ nonce, name } = JSON.parse(body ?? ''))
    } catch {
      return fail(res, 400, 'invalid request')
    }
    const nonceFile = join(DATA_DIR, '.connect-nonce')
    let stored = null
    try {
      stored = await readFile(nonceFile, 'utf8')
    } catch {
      /* no nonce written */
    }
    await rm(nonceFile, { force: true })
    if (typeof nonce !== 'string' || nonce.length < 32 || !stored || !timingSafeEqualStr(stored, nonce)) {
      return fail(res, 403, 'nonce mismatch — run `guano connect` from the instance machine')
    }
    const minted = await bootstrapConnectToken(typeof name === 'string' ? name : '')
    if (!minted) return fail(res, 403, 'no admin account yet — open /admin and complete setup first')
    return send(res, 200, JSON.stringify(minted))
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
      try {
        if (!(await verifyUserPassword(user, currentPassword ?? ''))) {
          return fail(res, 403, 'current password is incorrect')
        }
      } catch (e) {
        if (e instanceof VerifyBusyError) return fail(res, 429, 'busy — try again shortly')
        throw e
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
    const ip = clientIp(req)
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
    let user
    try {
      user = await verifyLogin(email, password)
    } catch (e) {
      if (e instanceof VerifyBusyError) return fail(res, 429, 'busy — try again shortly')
      throw e
    }
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
  const ip = clientIp(req)
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

// ---------- API tokens (per-user bearer credentials for the MCP server) ----------

const API_TOKEN_LIMIT = 25 // per user — bounds api-tokens.json growth

async function handleTokens(req, res, path) {
  const user = requestUser(req)
  if (!user) return fail(res, 401, 'unauthorized')
  // admin + editor only — contributors are content-only and can't build
  if (user.role === 'contributor') return fail(res, 403, 'forbidden')

  if (path === '/api/tokens' && req.method === 'GET') {
    return send(res, 200, JSON.stringify({ tokens: listApiTokens(user.id) }))
  }
  if (path === '/api/tokens' && req.method === 'POST') {
    const body = await readBody(req)
    let name
    try {
      ;({ name } = JSON.parse(body ?? ''))
    } catch {
      return fail(res, 400, 'invalid request')
    }
    if (typeof name !== 'string' || !name.trim()) return fail(res, 400, 'a name is required')
    if (apiTokenCount(user.id) >= API_TOKEN_LIMIT) {
      return fail(res, 400, 'token limit reached — revoke one first')
    }
    // the raw token is returned exactly once here; only its hash is stored
    const { token, record } = await createApiToken(user.id, name.trim())
    return send(res, 200, JSON.stringify({ ...record, token }))
  }
  const id = path.slice('/api/tokens/'.length)
  if (id && req.method === 'DELETE') {
    // owner revokes their own; an admin may revoke anyone's (enforced in auth)
    const ok = await revokeApiToken(id, user)
    return send(res, ok ? 200 : 404, JSON.stringify(ok ? { ok: true } : { error: 'not found' }))
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
    const name = JSON.parse(await readFile(storeFile('guano-project:main'), 'utf8'))?.name
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
// <script>) and mail credentials
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
 * contributor UI (Preview) can't touch those fields, so a legitimate
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

const isProjectKey = (key) => key.startsWith('guano-project:')

// ---------- live change feed (SSE) ----------
// Editors subscribe to GET /api/events; every store write is broadcast with
// its source ('agent' = a guano_ bearer token, 'human' = a session cookie).
// The editor uses this to live-apply MCP agent edits and hard-lock the UI
// while an agent session is active.
const eventClients = new Set()

function broadcastStoreEvent(key, source) {
  if (!eventClients.size) return
  const payload = `data: ${JSON.stringify({ type: 'store-write', key, source, ts: Date.now() })}\n\n`
  for (const client of eventClients) client.write(payload)
}

function handleEvents(req, res) {
  const user = requestUser(req)
  if (!user) return fail(res, 401, 'unauthorized')
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  res.write(':connected\n\n')
  eventClients.add(res)
  const heartbeat = setInterval(() => res.write(':hb\n\n'), 25_000)
  req.on('close', () => {
    clearInterval(heartbeat)
    eventClients.delete(res)
  })
}

async function handleStore(req, res, path, query) {
  // any authenticated user (incl. contributors editing content) may use the
  // store — via session cookie OR a `guano_` API-token bearer (the MCP server)
  const user = requestUser(req)
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
    const viaToken = (req.headers.authorization ?? '').startsWith('Bearer guano_')
    broadcastStoreEvent(key, viaToken ? 'agent' : 'human')
    return send(res, 200, JSON.stringify({ ok: true }))
  }
  if (req.method === 'DELETE') {
    // mirror of the PUT guard, stricter: the contributor UI (Preview) never
    // deletes store keys at all, so any contributor DELETE is anomalous —
    // deleting the project/branch/baseline blobs is destruction, not editing
    if (user.role === 'contributor') {
      return fail(res, 403, 'contributors cannot delete stored data')
    }
    await rm(storeFile(key), { force: true })
    return send(res, 200, JSON.stringify({ ok: true }))
  }
  return fail(res, 404, 'not found')
}


async function handlePost(req, res, params) {
  // the session is the credential; PUBLISH_TOKEN stays as a CI escape hatch.
  // Publishing is admin/editor only — contributors are content-only.
  const bearerOk = !!TOKEN && timingSafeEqualStr(req.headers.authorization ?? '', `Bearer ${TOKEN}`)
  if (!bearerOk) {
    // session cookie or a `guano_` API-token bearer (editor+); the PUBLISH_TOKEN
    // CI escape hatch above bypasses this entirely
    const user = requestUser(req)
    if (!user) return fail(res, 401, 'unauthorized')
    if (user.role === 'contributor') return fail(res, 403, 'forbidden')
  }
  const method = ['server', 'zip', 'github'].includes(params.get('method'))
    ? params.get('method')
    : 'server'
  const raw = await readBody(req)
  if (raw === null) return fail(res, 400, 'snapshot too large')
  let parsed
  try {
    parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.pages) || !parsed.pages.length) throw new Error('no pages')
  } catch {
    return fail(res, 400, 'invalid project snapshot')
  }

  // github: fail fast on missing config BEFORE the (expensive) export
  let github
  if (method === 'github') {
    github = {
      ...(parsed.settings?.publishing?.github ?? {}),
      token: (await readPublishConfig()).github.token,
    }
    if (!github.repo || !github.branch || !github.token) {
      return fail(res, 400, 'github publishing is not configured (repo/branch/token)')
    }
  }

  await writeAtomic(SNAPSHOT, raw) // atomic: readers never see a partial write
  // static export: on failure the snapshot stays saved and the previous
  // exported site stays live (atomic swap inside exportSite). Every method
  // exports once, so the local site at `/` refreshes regardless of method.
  try {
    const stats = await exportSite(parsed, SITE)
    if (method === 'zip') {
      const zip = createZip(await readDirFiles(SITE))
      return send(res, 200, zip, 'application/zip', {
        'content-disposition': 'attachment; filename="guano-site.zip"',
        'x-export-routes': String(stats.routes),
        'x-export-bytes': String(stats.bytes),
      })
    }
    if (method === 'github') {
      const { commit } = await pushSiteToGitHub(SITE, github)
      return send(res, 200, JSON.stringify({ ok: true, ...stats, commit }))
    }
    send(res, 200, JSON.stringify({ ok: true, ...stats }))
  } catch (err) {
    // full detail to the server log only; the client gets a generic
    // message (never leak fs paths / compiler internals in the response) —
    // except errors explicitly marked safe to expose (exporter / github push)
    console.error(err)
    if (err?.expose) return fail(res, 502, err.message)
    fail(res, 500, 'export failed — check the server logs')
  }
}

// ---------- 🔒 GET/PUT /api/publish-config (server-side GitHub token) ----------

async function handlePublishConfig(req, res) {
  const user = sessionUser(req)
  if (!user) return fail(res, 401, 'unauthorized')
  if (user.role === 'contributor') return fail(res, 403, 'forbidden')

  if (req.method === 'GET') {
    const cfg = await readPublishConfig()
    // NEVER return the token in any shape — only whether one is set
    return send(res, 200, JSON.stringify({ github: { tokenSet: !!cfg.github.token } }))
  }
  if (req.method === 'PUT') {
    const body = await readBody(req)
    let patch
    try {
      patch = JSON.parse(body ?? '')
    } catch {
      return fail(res, 400, 'invalid request')
    }
    const cfg = await readPublishConfig()
    if (patch?.github && 'token' in patch.github) {
      cfg.github.token = String(patch.github.token ?? '').trim() // '' clears
    }
    await writeAtomic(PUBLISH_CONFIG, JSON.stringify(cfg))
    return send(res, 200, JSON.stringify({ ok: true, github: { tokenSet: !!cfg.github.token } }))
  }
  return fail(res, 404, 'not found')
}

// ---------- 🔒 project export / import (full backup package) ----------

// package layout inside the zip: manifest.json, store/<key>.json,
// media/index.json, media/files/*, media/thumbs/*.webp
const PACKAGE_FORMAT = 'guano-package'
// pre-rename backups stay importable; the post-import store migration
// normalizes their old key filenames
const LEGACY_PACKAGE_FORMAT = 'superbird-package'
const PACKAGE_VERSION = 1

/** GET /api/project-export — admin-only backup package (.zip). Excludes
 * users/sessions/invites/publish.json/published.json/site by construction:
 * none of them live under the store or media dirs we read here. */
async function handleProjectExport(req, res) {
  const user = sessionUser(req)
  if (!user) return fail(res, 401, 'unauthorized')
  if (user.role !== 'admin') return fail(res, 403, 'forbidden')

  const files = [
    {
      path: 'manifest.json',
      data: Buffer.from(
        JSON.stringify({
          format: PACKAGE_FORMAT,
          version: PACKAGE_VERSION,
          exportedAt: new Date().toISOString(),
        }),
      ),
    },
  ]
  for (const { path, data } of await readDirFiles(STORE_DIR)) {
    files.push({ path: `store/${path}`, data })
  }
  for (const { path, data } of await readDirFiles(MEDIA_DIR)) {
    files.push({ path: `media/${path}`, data })
  }
  return send(res, 200, createZip(files), 'application/zip', {
    'content-disposition': 'attachment; filename="guano-project.zip"',
  })
}

const IMPORT_STORE_RE = /^store\/[A-Za-z0-9_-]{1,100}\.json$/
const IMPORT_MEDIA_FILE_RE = /^media\/files\/[a-f0-9]{16}$/
const IMPORT_MEDIA_THUMB_RE = /^media\/thumbs\/[a-f0-9]{16}\.webp$/

/** POST /api/project-import — admin-only full replace from a package. Strict
 * allowlist: any unrecognized entry rejects the whole import. */
async function handleProjectImport(req, res) {
  const user = sessionUser(req)
  if (!user) return fail(res, 401, 'unauthorized')
  if (user.role !== 'admin') return fail(res, 403, 'forbidden')

  const raw = await readBodyRaw(req, IMPORT_CAP)
  if (raw === null) return fail(res, 413, 'package too large')
  let entries
  try {
    entries = readZip(raw)
  } catch {
    return fail(res, 400, 'invalid package (not a readable zip)')
  }

  let manifestOk = false
  let hasProject = false
  for (const { path, data } of entries) {
    if (path === 'manifest.json') {
      try {
        const m = JSON.parse(data.toString('utf8'))
        if (
          (m.format !== PACKAGE_FORMAT && m.format !== LEGACY_PACKAGE_FORMAT) ||
          m.version !== PACKAGE_VERSION
        ) {
          return fail(res, 400, 'unrecognized package format')
        }
        if (m.format === LEGACY_PACKAGE_FORMAT) {
          console.log('importing a legacy superbird-package backup (deprecated format)')
        }
        manifestOk = true
      } catch {
        return fail(res, 400, 'invalid manifest')
      }
    } else if (IMPORT_STORE_RE.test(path)) {
      let parsed
      try {
        parsed = JSON.parse(data.toString('utf8'))
      } catch {
        return fail(res, 400, `unreadable store entry: ${path}`)
      }
      if (path.startsWith('store/guano-project__') || path.startsWith('store/superbird-project__')) {
        if (Array.isArray(parsed.pages) && parsed.pages.length) hasProject = true
      }
    } else if (path === 'media/index.json') {
      try {
        JSON.parse(data.toString('utf8'))
      } catch {
        return fail(res, 400, 'invalid media index')
      }
    } else if (IMPORT_MEDIA_FILE_RE.test(path) || IMPORT_MEDIA_THUMB_RE.test(path)) {
      // opaque bytes — id shape already validated by the regex
    } else {
      return fail(res, 400, `unexpected entry: ${path}`)
    }
  }
  if (!manifestOk) return fail(res, 400, 'package is missing its manifest')
  if (!hasProject) return fail(res, 400, 'package has no project with pages')

  // stage into a tmp dir, then swap live dirs into place
  const tmp = join(DATA_DIR, `import.tmp-${Date.now()}`)
  const tmpStore = join(tmp, 'store')
  const tmpMedia = join(tmp, 'media')
  await mkdir(tmpStore, { recursive: true })
  await mkdir(tmpMedia, { recursive: true })
  for (const { path, data } of entries) {
    if (path === 'manifest.json') continue
    const dest = join(tmp, path) // path already allowlisted, safe to join
    await mkdir(join(dest, '..'), { recursive: true })
    await writeFile(dest, data)
  }

  await swapDir(STORE_DIR, tmpStore)
  await swapDir(MEDIA_DIR, tmpMedia)
  await rm(tmp, { recursive: true, force: true })
  await migrateStoreDir() // a legacy backup arrives with old key filenames
  resetMediaIndexCache() // make imported media visible without a restart
  return send(res, 200, JSON.stringify({ ok: true }))
}

/** one-time rename of pre-rename store keys (superbird-* → guano-*) on the
 * live store dir. Idempotent: an existing new-name file is never clobbered.
 * Runs at boot and after a project-package import (legacy backups). */
async function migrateStoreDir() {
  let files = []
  try {
    files = await readdir(STORE_DIR)
  } catch {
    return // no store yet
  }
  for (const f of files) {
    if (!f.startsWith('superbird-') || !f.endsWith('.json')) continue
    const to = 'guano-' + f.slice('superbird-'.length)
    if (existsSync(join(STORE_DIR, to))) continue
    await rename(join(STORE_DIR, f), join(STORE_DIR, to))
    console.log(`store migration: ${f} -> ${to}`)
  }
}

/** replace `live` with `staged`: move live aside, staged in, drop the old */
async function swapDir(live, staged) {
  const old = `${live}.old-${Date.now()}`
  if (existsSync(live)) await rename(live, old)
  await rename(staged, live)
  await rm(old, { recursive: true, force: true })
}

async function handleStatic(req, res) {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname))
  // content-type is authoritative (extension-mapped) — never sniffed
  const NOSNIFF = { 'x-content-type-options': 'nosniff' }
  // SVG is a document format: even a sanitized file must not be able to run
  // script on this origin when navigated to directly (mirrors /media/:id)
  const headersFor = (target) =>
    extname(target) === '.svg'
      ? { ...NOSNIFF, 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" }
      : NOSNIFF

  // the editor SPA lives under /admin/ — strip the prefix and serve dist
  // (Vite builds with base '/admin/', so bundle URLs arrive as /admin/assets/*
  // while the files sit at dist/assets/*)
  if (path === '/admin' || path.startsWith('/admin/')) {
    const sub = normalize(path.slice('/admin'.length) || '/')
    const distFile = join(DIST, sub)
    const isDistFile =
      distFile.startsWith(DIST) && extname(distFile) !== '' && existsSync(distFile)
    const target = isDistFile ? distFile : join(DIST, 'index.html')
    try {
      const data = await readFile(target)
      return send(res, 200, data, MIME[extname(target)] ?? 'application/octet-stream', headersFor(target))
    } catch {
      return send(res, 404, 'Not found — run `npm run build` first.', 'text/plain')
    }
  }

  // the published static site — owns everything outside /admin and /api,
  // including /assets/* (style.css, script.js, media)
  const exact = join(SITE, path)
  const target =
    exact.startsWith(SITE) && extname(exact) !== '' && existsSync(exact)
      ? exact
      : join(SITE, path, 'index.html')
  try {
    const data = await readFile(target)
    send(res, 200, data, MIME[extname(target)] ?? 'application/octet-stream', headersFor(target))
  } catch {
    try {
      send(res, 404, await readFile(join(SITE, '404.html')), MIME['.html'], NOSNIFF)
    } catch {
      send(res, 404, 'Nothing published yet.', 'text/plain')
    }
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x')
    const path = url.pathname
    // CSRF defense-in-depth (on top of the SameSite=Lax cookie): every
    // mutating API request must be same-origin. Non-browser clients send no
    // Origin header and pass — the CI bearer publish keeps working.
    if (path.startsWith('/api/') && req.method !== 'GET' && !originAllowed(req)) {
      return fail(res, 403, 'cross-origin request rejected')
    }
    if (path === '/api/published' && req.method === 'POST') {
      return await handlePost(req, res, url.searchParams)
    }
    if (path === '/api/publish-config') return await handlePublishConfig(req, res)
    if (path === '/api/project-export' && req.method === 'GET') {
      return await handleProjectExport(req, res)
    }
    if (path === '/api/project-import' && req.method === 'POST') {
      return await handleProjectImport(req, res)
    }
    if (path.startsWith('/api/auth/')) return await handleAuth(req, res, path)
    if (path.startsWith('/api/invite/')) return await handleInvite(req, res, path)
    if (path === '/api/users' || path.startsWith('/api/users/')) {
      return await handleUsers(req, res, path)
    }
    if (path === '/api/tokens' || path.startsWith('/api/tokens/')) {
      return await handleTokens(req, res, path)
    }
    if (path === '/api/events' && req.method === 'GET') {
      return handleEvents(req, res)
    }
    if (path === '/api/store' || path.startsWith('/api/store/')) {
      return await handleStore(req, res, path, url.searchParams)
    }
    if (path === '/api/media' || path.startsWith('/api/media/')) {
      // requestUser (not sessionUser): bearer API tokens reach the library too
      return await handleMedia(req, res, path, url.searchParams, requestUser(req))
    }
    if (path.startsWith('/api/')) return fail(res, 404, 'not found')
    // library assets first; unknown /media/ paths fall through to the
    // static handler (exported media now lives under /assets/media/ —
    // the fall-through only still serves pre-move exports)
    if (path.startsWith('/media/')) {
      if (await handleMediaFile(req, res, path, url.searchParams)) return
    }
    return await handleStatic(req, res)
  } catch (err) {
    console.error(err)
    fail(res, 500, 'internal error')
  }
})

// When PORT wasn't explicitly chosen, a busy default port walks to the next
// free one (another guano/dev instance is usually what's squatting on it).
// An explicit PORT is a contract: fail with one clear line, no stack trace.
const PORT_EXPLICIT = Boolean(process.env.PORT)
const PORT_TRIES = PORT_EXPLICIT ? 1 : 10
let port = PORT

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    if (port - PORT + 1 < PORT_TRIES) {
      port++
      server.listen(port)
      return
    }
    console.error(
      PORT_EXPLICIT
        ? `port ${PORT} is already in use — stop the other process or pick another PORT`
        : `ports ${PORT}–${port} are all in use — set PORT to a free one`,
    )
  } else {
    console.error(`could not start the server: ${err.message}`)
  }
  process.exit(1)
})

server.listen(port, async () => {
  // owner-only data dir: one chmod at the root protects every secret beneath
  // (users/sessions/invites/publish.json) even for files written pre-upgrade
  try {
    await mkdir(DATA_DIR, { recursive: true, mode: 0o700 })
    await chmod(DATA_DIR, 0o700)
  } catch (err) {
    console.warn('could not restrict data dir permissions:', err.message)
  }
  await migrateStoreDir()
  if (port !== PORT) console.log(`port ${PORT} was busy — using ${port}`)
  const base = `http://localhost:${port}`
  console.log(`
  guano is running${TOKEN ? ' (publish token required)' : ''}

  ➜ editor:  ${base}/admin
  ➜ site:    ${base}/
  ➜ data:    ${DATA_DIR}
${needsSetup() ? `\n  first run — open ${base}/admin to create your admin account\n` : ''}`)
})
