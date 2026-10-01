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
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportSite } from './export.mjs'
import {
  handleMedia,
  handleMediaFile,
  originAllowed,
  resetMediaIndexCache,
} from './media.mjs'
import { pushSiteToGitHub } from './github.mjs'
import { createZip, readZip } from './zip.mjs'
import { mergeContributorProject, redactSecretsForContributor } from './contributor-merge.mjs'
import { protectedFieldDelta, readAgentPolicy, writeAgentPolicy } from './agent-policy.mjs'
import {
  resolve4 as dnsResolve4,
  resolve6 as dnsResolve6,
  resolveCname as dnsResolveCname,
} from 'node:dns/promises'
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
  destroyUserSessions,
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
// The PREVIEW export: the same exporter, a different directory, served on its
// own port. An agent (and a human) can look at what they built WITHOUT putting
// it on the live origin — which was the only way to see anything, so a review
// session published six times just to look, each one replacing the live site
// with a half-built draft.
const PREVIEW = join(DATA_DIR, 'preview')
const MEDIA_DIR = join(DATA_DIR, 'media')
// server-managed publish config — the GitHub token lives here, NEVER in the
// /api/store project blob (which any authed user can read)
const PUBLISH_CONFIG = join(DATA_DIR, 'publish.json')
const DIST = join(ROOT, 'dist')
// The version of the `guano` package this server belongs to, surfaced on
// /api/auth/me. The MCP process is spawned by the agent's client and does NOT
// restart when this server does, so comparing the two is the only way an agent
// can tell its tool surface is stale. Read the package the MCP ships in (in an
// installed copy this IS the same package.json).
const APP_VERSION = (() => {
  for (const p of [
    join(ROOT, 'packages', 'guano', 'package.json'),
    join(ROOT, 'package.json'),
  ]) {
    try {
      const v = JSON.parse(readFileSync(p, 'utf8')).version
      if (v) return v
    } catch {
      /* try the next candidate */
    }
  }
  return 'unknown'
})()

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

/** every server-side secret, by namespace. These never reach /api/store (the
 * project blob any authed user can read) nor an export.
 * The reader normalizes to the FULL shape on purpose: both handlers below
 * read-modify-write the same file, so a namespace missing here would be
 * silently dropped by the next write from the other handler. */
async function readPublishConfig() {
  let parsed = null
  try {
    parsed = JSON.parse(await readFile(PUBLISH_CONFIG, 'utf8'))
  } catch {
    /* no file yet — fall through to the empty shape */
  }
  return {
    github: { token: parsed?.github?.token ?? '' },
    stripe: { secretKey: parsed?.stripe?.secretKey ?? '' },
    mailing: { apiKey: parsed?.mailing?.apiKey ?? '' },
    smtp: { password: parsed?.smtp?.password ?? '' },
  }
}

/** booleans only — the shape every secret endpoint answers with */
const secretsSetShape = (cfg) => ({
  stripe: { secretKeySet: !!cfg.stripe.secretKey },
  mailing: { apiKeySet: !!cfg.mailing.apiKey },
  smtp: { passwordSet: !!cfg.smtp.password },
})

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

/**
 * True when this request authenticated as an MCP agent (a `guano_` bearer)
 * rather than a human at a browser. Mirrors requestUser's precedence — a
 * session cookie wins when both are present — so the two can never disagree
 * about who is calling. This is the signal the agent policy gates on.
 */
const isAgentRequest = (req) =>
  !sessionUser(req) && (req.headers.authorization ?? '').startsWith('Bearer guano_')

/**
 * Sliding-window rate limiter, one counter per id. Like the media uploader's
 * (media.mjs), it exists to stop a runaway agent loop rather than to size
 * legitimate work, and every refusal says when to retry — the MCP client reads
 * `retryAfterSeconds` off the 429 body and waits exactly that long.
 */
function slidingLimiter(limit, windowMs) {
  const hits = new Map()
  return (id) => {
    const now = Date.now()
    const times = (hits.get(id) ?? []).filter((t) => now - t < windowMs)
    if (times.length >= limit) {
      hits.set(id, times)
      const freesAt = times[0] + windowMs
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((freesAt - now) / 1000)) }
    }
    times.push(now)
    hits.set(id, times)
    return { ok: true }
  }
}

// Autosave is debounced to 500ms, so a busy human tab tops out near 120/min —
// 600 leaves every real workflow untouched while still capping a hot loop.
const storeWriteAllowed = slidingLimiter(600, 60_000)
// A publish is a full Tailwind compile + static export; a dozen a minute is
// already far past what a human does deliberately.
const publishAllowed = slidingLimiter(12, 60_000)
// previews are cheap and nothing ships, so they get their own, looser budget —
// spending the publish budget on looking is what this exists to avoid
const previewAllowed = slidingLimiter(30, 60_000)

const tooManyRequests = (res, retryAfterSeconds, what) =>
  send(
    res,
    429,
    JSON.stringify({ error: `too many ${what} — retry in ${retryAfterSeconds}s`, retryAfterSeconds }),
    'application/json',
    { 'retry-after': String(retryAfterSeconds) },
  )

async function handleAuth(req, res, path) {
  if (path === '/api/auth/me' && req.method === 'GET') {
    if (needsSetup()) return send(res, 401, JSON.stringify({ needsSetup: true }))
    // session cookie or a `guano_` API-token bearer — the MCP server calls this
    // on boot to fail fast on a bad URL/token and to learn who it is
    const user = requestUser(req)
    if (!user) return send(res, 401, JSON.stringify({ needsSetup: false }))
    return send(res, 200, JSON.stringify({ ...userProfile(user), serverVersion: APP_VERSION }))
  }
  if (path === '/api/auth/setup' && req.method === 'POST') {
    // bootstrap the first admin — only when no users exist yet
    if (!needsSetup()) return fail(res, 403, 'account already exists')
    const body = await readBody(req)
    let email, password, name, projectName
    try {
      ;({ email, password, name, projectName } = JSON.parse(body ?? ''))
    } catch {
      return fail(res, 400, 'invalid request')
    }
    if (!isEmail(email)) return fail(res, 400, 'invalid email')
    if (typeof password !== 'string' || password.length < 8) {
      return fail(res, 400, 'password must be at least 8 characters')
    }
    const user = await createFirstAdmin(email, password, typeof name === 'string' ? name : '')
    if (!user) return fail(res, 403, 'account already exists')
    // seed the project the moment the instance has an owner, so the install is
    // usable headlessly — the browser no longer has to be the thing that
    // creates it. `projectName` is the SITE's name (`name` above is the
    // admin's own). Best-effort: a seed failure must not fail setup.
    await ensureProjectSeeded(typeof projectName === 'string' ? projectName : '')
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
    const changingPassword = password !== undefined && password !== ''
    const updated = await updateUser(user.id, { name, email, password })
    if (changingPassword) {
      // a password change revokes every existing session (a stolen 30-day
      // cookie must not outlive the credential it was minted from), then
      // re-issues one for THIS request so the caller stays signed in here (S8)
      destroyUserSessions(user.id)
      return send(res, 200, JSON.stringify(userProfile(updated)), 'application/json', {
        'set-cookie': sessionCookieHeader(createSession(user.id)),
      })
    }
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

  // team visibility for EDITOR+: a redacted, read-only membership view (no
  // tokens/ids). Sits before the admin gate so editors can see the team, but
  // contributors are refused: the payload carries every member's and pending
  // invite's email, and a content-only user has no need for the team's
  // addresses (S14 — harvesting/phishing surface).
  if (path === '/api/users/members' && req.method === 'GET') {
    if (admin.role === 'contributor') return fail(res, 403, 'forbidden')
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
    // Minting is session-only: a token that can mint tokens makes revocation
    // meaningless, because a leaked one quietly spawns replacements that
    // survive revoking the credential anyone knows about. Listing and revoking
    // stay open to tokens — those only ever reduce access.
    if (!sessionUser(req)) {
      return fail(res, 403, 'API tokens can only be created from a signed-in browser session')
    }
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
// `_` is deliberately NOT allowed. Keys map to filenames by `:` → `__`, so an
// underscore makes that mapping non-injective — `guano-project__main` would
// land on Main's file while sliding past every `startsWith('guano-project:')`
// guard below (the contributor merge and the secret redaction), and even
// `a_:b` / `a:_b` would collide. Barring `_` keeps key and file in lockstep, so
// a guard can never disagree with the blob it protects. No real key uses one.
const STORE_KEY_RE = /^[A-Za-z0-9:-]{1,100}$/

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

/**
 * Seed `guano-project:main` when a fresh instance has none.
 *
 * Until now the project blob was written only by the browser
 * (usePersistence.load()), so a brand-new install had NOTHING on Main until an
 * admin opened /admin — and every out-of-band reader (the MCP agent surface)
 * died on the missing blob. Seeding server-side makes a headless first run work:
 * setup → mint a token → set_target {createDraft} → edit, no browser needed.
 *
 * Writes ONLY the project key. No branches meta, no merge-base snapshot — MCP
 * tolerates a missing branches blob (DEFAULT_META) and the editor creates the
 * rest lazily, so inventing them here would just be another shape to keep in
 * sync. Returns true if it actually seeded.
 */
let seeding = null
async function ensureProjectSeeded(name) {
  // one at a time: two agent requests arriving together must not both seed
  if (seeding) return seeding
  seeding = (async () => {
    const file = storeFile(MAIN_PROJECT_KEY)
    if ((await readFileOrNull(file)) !== null) return false
    let createProject
    try {
      // the DOM-free editor-logic bundle, in either layout: the repo
      // (packages/guano/runtime/) or the npm package, where prepack copies
      // server/ in next to runtime/. Imported lazily so startup doesn't pay
      // for it, and never fatal — a missing bundle means no seed, not a dead
      // server (the browser still writes the blob as it always did).
      const mod = await import(new URL('../packages/guano/runtime/mcp-runtime.mjs', import.meta.url)).catch(
        () => import(new URL('../runtime/mcp-runtime.mjs', import.meta.url)),
      )
      ;({ createProject } = mod)
    } catch (err) {
      // in the npm package the bundle always ships; in the repo it is
      // gitignored and built on demand, so a fresh clone lands here
      console.error(
        'could not seed the project: the editor-logic bundle is missing — run ' +
          '`npm run build:mcp-runtime`. The editor still creates the project on first open, ' +
          'but a headless (MCP-only) first run will fail until it exists. ' +
          err.message,
      )
      return false
    }
    const project = createProject(typeof name === 'string' && name.trim() ? name.trim() : 'Untitled project')
    const body = JSON.stringify(project)
    await writeAtomic(file, body)
    storeSize.at = 0 // force a recount rather than guessing at the delta
    // same broadcast the store PUT sends, so an editor that happens to be open
    // hydrates the new project instead of sitting on an empty one
    broadcastStoreEvent(MAIN_PROJECT_KEY, 'human')
    return true
  })()
  try {
    return await seeding
  } finally {
    seeding = null
  }
}

/** a store blob as a string, or null when the key has nothing stored */
async function readFileOrNull(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

const isProjectKey = (key) => key.startsWith('guano-project:')
const MAIN_PROJECT_KEY = 'guano-project:main'
// A `guano-base:<id>` merge-base snapshot is a FULL project copy — same
// settings, same secrets, and the structural truth the 3-way merge diffs
// against. So it needs the same two guards as a project key: redact secrets on
// a contributor read, and run a contributor write through the authoritative
// merge (otherwise a poisoned base makes the editor's merge propose structural
// changes nobody authored).
const isProjectBlobKey = (key) => isProjectKey(key) || key.startsWith('guano-base:')

/** parsed JSON or null — for blobs we only want to peek inside */
function parseJsonOrNull(str) {
  if (typeof str !== 'string') return null
  try {
    return JSON.parse(str)
  } catch {
    return null
  }
}

// Disk ceiling for the store. Media has had a quota all along; the store had
// none, so a token writing fresh keys in a loop could fill the disk. The total
// is cached (recomputing it on every autosave would be absurd) and nudged up by
// each write, so a hot loop still trips the cap well inside the refresh window.
const STORE_QUOTA = Number(process.env.STORE_QUOTA) || 512 * 1024 * 1024
let storeSize = { bytes: 0, at: 0 }

async function storeBytes() {
  if (storeSize.at && Date.now() - storeSize.at < 30_000) return storeSize.bytes
  let total = 0
  try {
    for (const name of await readdir(STORE_DIR)) {
      try {
        total += (await stat(join(STORE_DIR, name))).size
      } catch {
        /* vanished mid-scan — it contributes nothing */
      }
    }
  } catch {
    /* no store dir yet */
  }
  storeSize = { bytes: total, at: Date.now() }
  return total
}

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

  // Lazy seed for AGENTS ONLY. Setup covers every install created from here on;
  // this branch is for one that already had users before the seed existed and
  // is now reached head-first by a token. It must not fire for a browser: the
  // editor's boot hydration GET would then see a blob and skip the one-time
  // rename that applies the name captured at setup.
  if (isAgentRequest(req)) await ensureProjectSeeded('')

  if (path === '/api/store' && req.method === 'GET') {
    const keys = (query.get('keys') ?? '').split(',').filter(Boolean)
    if (!keys.length || keys.some((k) => !STORE_KEY_RE.test(k))) {
      return fail(res, 400, 'invalid keys')
    }
    const out = {}
    for (const key of keys) {
      let val = await readFileOrNull(storeFile(key))
      // S4: never hand a contributor the server-side secrets (smtp/integration
      // keys) carried in the project blob. Safe because contributor writes
      // ignore incoming `settings`, so a redacted round-trip can't blank them.
      // `guano-base:` snapshots are full project copies, so they carry the same
      // secrets and get the same treatment.
      if (val && user.role === 'contributor' && isProjectBlobKey(key)) {
        val = redactSecretsForContributor(val)
      }
      out[key] = val
    }
    return send(res, 200, JSON.stringify(out))
  }

  const key = decodeURIComponent(path.slice('/api/store/'.length))
  if (!STORE_KEY_RE.test(key)) return fail(res, 400, 'invalid key')

  if (req.method === 'PUT') {
    const limit = storeWriteAllowed(user.id)
    if (!limit.ok) return tooManyRequests(res, limit.retryAfterSeconds, 'store writes')

    const body = await readBody(req)
    if (body === null) return fail(res, 400, 'too large')

    const existing = await readFileOrNull(storeFile(key))
    const existingBytes = existing === null ? 0 : Buffer.byteLength(existing)
    if ((await storeBytes()) - existingBytes + Buffer.byteLength(body) > STORE_QUOTA) {
      return fail(res, 507, 'project storage is full')
    }

    if (isProjectBlobKey(key)) {
      const denied = await protectedWriteDenial(req, user, key, existing, body)
      if (denied) return fail(res, 403, denied)
    }

    let toWrite = body
    if (user.role === 'contributor' && isProjectBlobKey(key)) {
      // server-authoritative merge: structure/settings come from the stored
      // copy (or Main for a new draft), only the content allowlist from the
      // contributor's blob — a hand-crafted structural edit is silently dropped
      const main = await readFileOrNull(storeFile(MAIN_PROJECT_KEY))
      const r = mergeContributorProject(existing, main, body)
      if (r.error) return fail(res, 403, r.error)
      toWrite = r.merged
    }
    await writeAtomic(storeFile(key), toWrite)
    storeSize.bytes += Math.max(0, Buffer.byteLength(toWrite) - existingBytes)
    broadcastStoreEvent(key, isAgentRequest(req) ? 'agent' : 'human')
    return send(res, 200, JSON.stringify({ ok: true }))
  }
  if (req.method === 'DELETE') {
    // contributors may discard their own drafts — the branch project copy and
    // its merge-base snapshot — but never the live project (Main) or any other
    // stored blob (that would be destruction, not editing).
    if (user.role === 'contributor') {
      const isDraftKey =
        (isProjectKey(key) && key !== MAIN_PROJECT_KEY) ||
        (key.startsWith('guano-base:') && key !== 'guano-base:main')
      if (!isDraftKey) return fail(res, 403, 'contributors cannot delete stored data')
      if (!(await ownsDraft(user, key))) {
        return fail(res, 403, 'contributors can only discard their own drafts')
      }
    }
    // Main is the live project and its history is in-memory client-side only,
    // so an agent deleting it is unrecoverable — hold it to the same switch
    // that gates agent writes to Main.
    if (isAgentRequest(req) && (key === MAIN_PROJECT_KEY || key === 'guano-base:main')) {
      const policy = await readAgentPolicy()
      if (!policy.allowMainWrites) return fail(res, 403, AGENT_MAIN_DENIED)
    }
    await rm(storeFile(key), { force: true })
    storeSize.at = 0 // force a recount rather than tracking the freed bytes
    return send(res, 200, JSON.stringify({ ok: true }))
  }
  return fail(res, 404, 'not found')
}

/**
 * Does `user` own the draft a `guano-project:<id>` / `guano-base:<id>` key
 * belongs to? Ownership is the `createdBy` stamp the editor and the MCP server
 * write into the branches meta at creation.
 *
 * Drafts created before ownership was tracked carry no stamp; those stay shared
 * rather than becoming undeletable, so an upgrade doesn't strand anyone's work.
 */
async function ownsDraft(user, key) {
  const id = key.slice(key.indexOf(':') + 1)
  const meta = parseJsonOrNull(await readFileOrNull(storeFile('guano-branches')))
  const draft = Array.isArray(meta?.branches) ? meta.branches.find((b) => b?.id === id) : null
  if (!draft?.createdBy) return true // unknown or legacy — shared
  return draft.createdBy === user.id
}

const AGENT_MAIN_DENIED =
  'agent writes to Main are disabled — work in a draft and let a human apply it, ' +
  'or enable agent Main writes in Settings'

/**
 * Guard one project-blob write: the reason to refuse, or null to allow.
 *
 * Two callers, one rule. An MCP **agent** is checked against the agent policy —
 * may this token touch Main at all, and may it write a field that ships raw
 * script to the live site? That is what breaks the injection chain the audit
 * found: a comment telling an agent to write `customCode.head` and publish now
 * fails here, at the server, whatever the agent believes it was authorized to
 * do. A **contributor** is never allowed either field, by role.
 *
 * Contributors previously had these fields silently dropped by the content
 * merge. Refusing out loud is better: a silent drop looks like success, so a
 * contributor (or the agent acting for one) keeps retrying a write that will
 * never take effect, and nobody learns that something tried.
 */
async function protectedWriteDenial(req, user, key, existingStr, bodyStr) {
  const agent = isAgentRequest(req)
  const contributor = user.role === 'contributor'
  if (!agent && !contributor) return null // admin/editor at a browser: their call

  if (agent && (key === MAIN_PROJECT_KEY || key === 'guano-base:main')) {
    if (!(await readAgentPolicy()).allowMainWrites) return AGENT_MAIN_DENIED
  }
  // For a brand-new draft there is nothing stored yet, so Main is the baseline
  // the copy must match — otherwise custom code could ride in at creation.
  const baseline =
    parseJsonOrNull(existingStr) ??
    parseJsonOrNull(await readFileOrNull(storeFile(MAIN_PROJECT_KEY)))
  const delta = protectedFieldDelta(baseline, parseJsonOrNull(bodyStr))
  if (!delta) return null

  const who = contributor ? 'contributors' : 'agents'
  if (delta.kind === 'publishing') {
    return `${who} cannot change ${delta.field} — the publish target is set by an admin in Settings`
  }
  if (contributor || !(await readAgentPolicy()).allowCustomCode) {
    return (
      `${who} cannot change ${delta.field} — custom code runs as raw script on every ` +
      'published page. Ask an admin to make this edit' +
      (contributor ? '.' : ', or enable agent custom code in Settings.')
    )
  }
  return null
}


/**
 * POST /api/preview — export the posted snapshot to the PREVIEW directory and
 * return where to look at it. Nothing reaches the live origin.
 *
 * Deliberately NOT gated on the agent publish policy: the whole point is that an
 * agent can see its own work without shipping it. A contributor's snapshot goes
 * through the same content merge publishing uses, so a preview can never be a
 * way to render structure a contributor is not allowed to write.
 */
async function handlePreview(req, res) {
  const user = requestUser(req)
  if (!user) return fail(res, 401, 'unauthorized')
  const limit = previewAllowed(user.id)
  if (!limit.ok) return tooManyRequests(res, limit.retryAfterSeconds, 'previews')

  let raw = await readBody(req)
  if (raw === null) return fail(res, 400, 'snapshot too large')
  let parsed
  try {
    parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.pages) || !parsed.pages.length) throw new Error('no pages')
  } catch {
    return fail(res, 400, 'invalid project snapshot')
  }
  if (user.role === 'contributor') {
    const stored = await readFileOrNull(storeFile(MAIN_PROJECT_KEY))
    const r = mergeContributorProject(stored, stored, raw)
    if (r.error) return fail(res, 403, r.error)
    parsed = JSON.parse(r.merged)
  }
  try {
    // A preview exports EVERY page, published or not: it is the surface for
    // looking at work in progress, and a draft page you cannot see is the thing
    // you most need to. The live export still drops unpublished pages.
    const stats = await exportSite({ ...parsed, pages: parsed.pages.map(previewPublished) }, PREVIEW)
    return send(
      res,
      200,
      JSON.stringify({ ok: true, ...stats, url: previewOrigin(req) }),
    )
  } catch (err) {
    console.error(err)
    return fail(res, 500, `preview export failed: ${err.message}`)
  }
}

/** a page as the preview renders it — drafts included, so work in progress is
 * visible. `status` is restored nowhere else: this is a copy. */
const previewPublished = (page) => (page.status === 'published' ? page : { ...page, status: 'published' })

/** where the preview server answers: same host, PREVIEW_PORT */
function previewOrigin(req) {
  const host = String(req.headers.host ?? `localhost:${port}`).split(':')[0]
  return `http://${host}:${previewPort}/`
}

async function handlePost(req, res, params) {
  // the session is the credential; PUBLISH_TOKEN stays as a CI escape hatch.
  const bearerOk = !!TOKEN && timingSafeEqualStr(req.headers.authorization ?? '', `Bearer ${TOKEN}`)
  let user = null
  if (!bearerOk) {
    // session cookie or a `guano_` API-token bearer; the PUBLISH_TOKEN CI escape
    // hatch above bypasses this entirely. Contributors may publish, but the
    // content merge below (mergeContributorProject) rebuilds their snapshot from
    // Main's structure/settings, so they can only ever ship content changes.
    user = requestUser(req)
    if (!user) return fail(res, 401, 'unauthorized')
  }
  const method = ['server', 'zip', 'github'].includes(params.get('method'))
    ? params.get('method')
    : 'server'

  if (user) {
    // zip and github ship the site OUT of this instance (a download, a push to
    // a remote repo), so they are build-capable roles only — the doc has always
    // said so, but the check was missing and contributors fell straight through.
    if (method !== 'server' && user.role === 'contributor') {
      return fail(res, 403, 'forbidden')
    }
    // Publishing is the one action an agent cannot walk back: it puts bytes on
    // the live origin. Off unless a human turned it on (see agent-policy.mjs).
    if (isAgentRequest(req) && !(await readAgentPolicy()).allowPublish) {
      return fail(
        res,
        403,
        'agent publishing is disabled — ask a human to publish, or enable agent publishing in Settings',
      )
    }
    const limit = publishAllowed(user.id)
    if (!limit.ok) return tooManyRequests(res, limit.retryAfterSeconds, 'publishes')
  }

  let raw = await readBody(req)
  if (raw === null) return fail(res, 400, 'snapshot too large')
  let parsed
  try {
    parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.pages) || !parsed.pages.length) throw new Error('no pages')
  } catch {
    return fail(res, 400, 'invalid project snapshot')
  }

  // a contributor may only publish CONTENT changes: merge their snapshot onto
  // Main's stored structure/settings and export THAT, never their raw blob —
  // otherwise a hand-crafted publish would push structure straight to the live
  // site, bypassing the store write guard
  if (user?.role === 'contributor') {
    const stored = await readFileOrNull(storeFile('guano-project:main'))
    const r = mergeContributorProject(stored, stored, raw)
    if (r.error) return fail(res, 403, r.error)
    raw = r.merged
    parsed = JSON.parse(raw)
  }

  // github: fail fast on missing config BEFORE the (expensive) export.
  // repo/branch come from the STORED Main settings, never from the request
  // body — the server signs this push with its own PAT, so letting the caller
  // name the destination would hand that PAT's write access to anyone who can
  // publish, pointed at any repo it can reach.
  let github
  if (method === 'github') {
    const storedMain = parseJsonOrNull(await readFileOrNull(storeFile(MAIN_PROJECT_KEY)))
    github = {
      ...(storedMain?.settings?.publishing?.github ?? {}),
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

// ---------- 🔒 GET/PUT /api/agent-policy (what MCP agents may do) ----------

/**
 * Session-only and admin-only, deliberately: these switches are exactly what an
 * agent would want flipped, so a `guano_` bearer must never be able to flip
 * them — otherwise the policy would guard nothing. Same rule as /api/users and
 * /api/publish-config.
 */
async function handleAgentPolicy(req, res) {
  const user = sessionUser(req)
  if (!user) return fail(res, 401, 'unauthorized')
  if (user.role !== 'admin') return fail(res, 403, 'forbidden')

  if (req.method === 'GET') {
    return send(res, 200, JSON.stringify(await readAgentPolicy()))
  }
  if (req.method === 'PUT') {
    const body = await readBody(req)
    const patch = parseJsonOrNull(body)
    if (!patch || typeof patch !== 'object') return fail(res, 400, 'invalid request')
    return send(res, 200, JSON.stringify(await writeAgentPolicy(patch)))
  }
  return fail(res, 404, 'not found')
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

// ---------- 🔒 GET/PUT /api/integrations-config (Stripe / mailing / SMTP secrets) ----------

async function handleIntegrationsConfig(req, res) {
  const user = sessionUser(req)
  if (!user) return fail(res, 401, 'unauthorized')
  if (user.role === 'contributor') return fail(res, 403, 'forbidden')

  if (req.method === 'GET') {
    // NEVER return a key in any shape — only whether one is set
    return send(res, 200, JSON.stringify(secretsSetShape(await readPublishConfig())))
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
    // field-wise so a patch for one namespace can't clear another; '' clears
    const set = (ns, field) => {
      if (patch?.[ns] && field in patch[ns]) cfg[ns][field] = String(patch[ns][field] ?? '').trim()
    }
    set('stripe', 'secretKey')
    set('mailing', 'apiKey')
    set('smtp', 'password')
    await writeAtomic(PUBLISH_CONFIG, JSON.stringify(cfg))
    return send(res, 200, JSON.stringify({ ok: true, ...secretsSetShape(cfg) }))
  }
  return fail(res, 404, 'not found')
}

// ---------- 🔒 GET /api/domain-check (what a domain resolves to) ----------

// Bare hostname only: labels of letters/digits/hyphens, at least one dot, no
// scheme, port, path or userinfo. This is the guard — the value goes straight
// into a resolver, and GET requests skip the same-origin check.
const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

async function handleDomainCheck(req, res, params) {
  const user = sessionUser(req)
  if (!user) return fail(res, 401, 'unauthorized')
  if (user.role === 'contributor') return fail(res, 403, 'forbidden')
  if (req.method !== 'GET') return fail(res, 404, 'not found')

  const domain = (params.get('domain') ?? '').trim().toLowerCase()
  if (!HOSTNAME_RE.test(domain)) return fail(res, 400, 'enter a bare domain, e.g. example.com')

  // purely informational: this server does no per-domain routing, so a lookup
  // failure is an answer ("not resolving yet"), never an error
  const lookup = async (fn) => {
    try {
      return await fn(domain)
    } catch {
      return []
    }
  }
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 4000))
  const records = await Promise.race([
    Promise.all([lookup(dnsResolve4), lookup(dnsResolve6), lookup(dnsResolveCname)]),
    timeout,
  ])
  if (!records) return send(res, 200, JSON.stringify({ domain, timedOut: true, a: [], aaaa: [], cname: [] }))
  const [a, aaaa, cname] = records
  return send(res, 200, JSON.stringify({ domain, a, aaaa, cname }))
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
      // The EDITOR must never be framable: an invisible iframe over a decoy
      // page turns a logged-in admin's clicks into publish/delete actions.
      // frame-ancestors only — deliberately NOT a full CSP, because the editor
      // compiles Tailwind in the browser at runtime and a script-src would
      // white-screen it (that half stays open; see BACKLOG S10).
      const base = headersFor(target)
      const adminHeaders = {
        ...base,
        'x-frame-options': 'DENY',
        // APPEND, never replace: a .svg under /admin/ already carries the
        // no-script CSP from headersFor, and dropping it would let a served
        // SVG run script on this origin when navigated to directly
        'content-security-policy': [base['content-security-policy'], "frame-ancestors 'none'"]
          .filter(Boolean)
          .join('; '),
      }
      return send(res, 200, data, MIME[extname(target)] ?? 'application/octet-stream', adminHeaders)
    } catch {
      return send(res, 404, 'Not found — run `npm run build` first.', 'text/plain')
    }
  }

  // the published static site — owns everything outside /admin and /api,
  // including /assets/* (style.css, script.js, media)
  return await serveSiteDir(req, res, SITE)
}

/**
 * Serve one exported site directory: an exact file, else the path's
 * index.html, else the export's 404 page. Shared by the live site and the
 * preview server, which differ only in which directory they point at (and the
 * preview's noindex header).
 */
async function serveSiteDir(req, res, root) {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname))
  const NOSNIFF = { 'x-content-type-options': 'nosniff' }
  const preview = root === PREVIEW
  const headersFor = (target) => ({
    ...NOSNIFF,
    // unfinished work must never be indexed
    ...(preview ? { 'x-robots-tag': 'noindex, nofollow' } : {}),
    // SVG is a document format: even a sanitized file must not run script on
    // this origin when navigated to directly (mirrors /media/:id)
    ...(extname(target) === '.svg'
      ? { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" }
      : {}),
  })
  const exact = join(root, path)
  const target =
    exact.startsWith(root) && extname(exact) !== '' && existsSync(exact)
      ? exact
      : join(root, path, 'index.html')
  try {
    const data = await readFile(target)
    send(res, 200, data, MIME[extname(target)] ?? 'application/octet-stream', headersFor(target))
  } catch {
    try {
      send(res, 404, await readFile(join(root, '404.html')), MIME['.html'], headersFor('x.html'))
    } catch {
      send(
        res,
        404,
        preview ? 'Nothing previewed yet — POST /api/preview first.' : 'Nothing published yet.',
        'text/plain',
      )
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
    if (path === '/api/preview' && req.method === 'POST') {
      return await handlePreview(req, res)
    }
    if (path === '/api/published' && req.method === 'POST') {
      return await handlePost(req, res, url.searchParams)
    }
    if (path === '/api/publish-config') return await handlePublishConfig(req, res)
    if (path === '/api/agent-policy') return await handleAgentPolicy(req, res)
    if (path === '/api/integrations-config') return await handleIntegrationsConfig(req, res)
    if (path === '/api/domain-check') return await handleDomainCheck(req, res, url.searchParams)
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
// The preview site answers on its own port, not a sub-path: the export uses
// root-absolute URLs (/assets/…), so serving it under /preview/ would mean
// threading a base path through every emitted URL.
const PREVIEW_PORT = Number(process.env.GUANO_PREVIEW_PORT) || 0
let previewPort = 0

const previewServer = createServer(async (req, res) => {
  try {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname))
    // never the editor, and never indexed — this is unfinished work
    if (path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/')) {
      return fail(res, 404, 'the preview server serves the exported site only')
    }
    await serveSiteDir(req, res, PREVIEW)
  } catch (err) {
    console.error(err)
    fail(res, 500, 'internal error')
  }
})

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
  // the preview site, on its own port. A failure here is never fatal: it is a
  // convenience, and the editor and the live site must come up regardless.
  previewServer.once('error', (err) => {
    console.warn(`preview server unavailable (${err.message}) — /api/preview will still export`)
    previewPort = 0
  })
  previewServer.listen(PREVIEW_PORT || port + 1, () => {
    previewPort = previewServer.address().port
  })
  const base = `http://localhost:${port}`
  console.log(`
  guano is running${TOKEN ? ' (publish token required)' : ''}

  ➜ editor:  ${base}/admin
  ➜ site:    ${base}/
  ➜ preview: http://localhost:${PREVIEW_PORT || port + 1}/
  ➜ data:    ${DATA_DIR}
${needsSetup() ? `\n  first run — open ${base}/admin to create your admin account\n` : ''}`)
})
