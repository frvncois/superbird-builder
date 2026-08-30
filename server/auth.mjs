// Multi-user auth: scrypt-hashed users with roles, admin-issued single-use
// invite links, file-backed sessions. Everything is node core — no deps.
//
// Security notes:
//  - Accounts are only created by (a) first-run setup (bootstrap admin) or
//    (b) accepting an admin-issued invite. The role is taken from the
//    server-stored invite, never from the invitee's request.
//  - Invite tokens are 256-bit random, stored ONLY as a sha256 hash at rest,
//    single-use, 7-day expiry. Session tokens are likewise 256-bit random and
//    stored only as their sha256 hash (the raw token lives only in the cookie).
//  - Password checks are timingSafeEqual; unknown-email logins still run a
//    scrypt (against a dummy salt) so response timing can't enumerate users.
//  - Sessions bind to a userId; a deleted user's sessions are destroyed. Role
//    is read live from the user record, so a role change takes effect at once.

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeAtomic } from './util.mjs'

const DATA_DIR =
  process.env.SB_DATA_DIR || join(fileURLToPath(new URL('..', import.meta.url)), 'server', 'data')
const USERS_FILE = join(DATA_DIR, 'users.json')
const INVITES_FILE = join(DATA_DIR, 'invites.json')
const SESSIONS_FILE = join(DATA_DIR, 'sessions.json')
const LEGACY_AUTH_FILE = join(DATA_DIR, 'auth.json') // pre-multi-user single account

const SESSION_TTL = 30 * 24 * 60 * 60 * 1000 // 30 days
const INVITE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days
const COOKIE = 'sb_session'

export const ROLES = ['admin', 'editor', 'contributor']

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

// ---------- users ----------

// { id, name, email, role, salt, hash, createdAt }
let users
let migratedAdminId = null // for one-time session backfill

function loadUsers() {
  if (users) return users
  const stored = readJson(USERS_FILE)
  if (Array.isArray(stored)) {
    users = stored
    return users
  }
  // migrate a legacy single account into the first admin
  const legacy = readJson(LEGACY_AUTH_FILE)
  if (legacy?.email && legacy.hash && legacy.salt) {
    const admin = {
      id: randomBytes(12).toString('hex'),
      name: legacy.name ?? '',
      email: String(legacy.email).toLowerCase(),
      role: 'admin',
      salt: legacy.salt,
      hash: legacy.hash,
      createdAt: Date.now(),
    }
    users = [admin]
    migratedAdminId = admin.id
    writeAtomic(USERS_FILE, JSON.stringify(users)).catch(() => {})
    return users
  }
  users = []
  return users
}

const persistUsers = () => writeAtomic(USERS_FILE, JSON.stringify(loadUsers())).catch(() => {})

export const needsSetup = () => loadUsers().length === 0
export const findUserById = (id) => loadUsers().find((u) => u.id === id) ?? null
export const findUserByEmail = (email) =>
  loadUsers().find((u) => u.email === String(email ?? '').toLowerCase()) ?? null
export const userProfile = (u) => (u ? { id: u.id, name: u.name, email: u.email, role: u.role } : null)
export const listUsers = () => loadUsers().map(userProfile)
export const adminCount = () => loadUsers().filter((u) => u.role === 'admin').length

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex')
}

// spend comparable CPU on unknown-email logins so timing can't enumerate users
const DUMMY_SALT = randomBytes(16).toString('hex')
const DUMMY_HASH = Buffer.from(hashPassword('x'.repeat(24), DUMMY_SALT), 'hex')

function makeCredentials(password) {
  const salt = randomBytes(16).toString('hex')
  return { salt, hash: hashPassword(password, salt) }
}

/** create a user directly — bootstrap admin (setup) or invite acceptance */
async function createUser({ name, email, password, role }) {
  const user = {
    id: randomBytes(12).toString('hex'),
    name: typeof name === 'string' ? name : '',
    email: String(email).toLowerCase(),
    role: ROLES.includes(role) ? role : 'contributor',
    ...makeCredentials(password),
    createdAt: Date.now(),
  }
  loadUsers().push(user)
  await persistUsers()
  return user
}

/** first-run bootstrap: only succeeds when no users exist yet */
export async function createFirstAdmin(email, password, name = '') {
  if (!needsSetup()) return null
  return createUser({ name, email, password, role: 'admin' })
}

/** constant-time-ish login: returns the user on success, null otherwise */
export function verifyLogin(email, password) {
  const user = findUserByEmail(email)
  if (!user) {
    // run a scrypt anyway so timing doesn't reveal whether the email exists
    timingSafeEqual(scryptSync(String(password ?? ''), DUMMY_SALT, 64), DUMMY_HASH)
    return null
  }
  const computed = scryptSync(String(password ?? ''), user.salt, 64)
  return timingSafeEqual(Buffer.from(user.hash, 'hex'), computed) ? user : null
}

export function verifyUserPassword(user, password) {
  if (!user) return false
  const computed = scryptSync(String(password ?? ''), user.salt, 64)
  return timingSafeEqual(Buffer.from(user.hash, 'hex'), computed)
}

export async function updateUser(id, { name, email, password }) {
  const user = findUserById(id)
  if (!user) return null
  if (typeof name === 'string') user.name = name
  if (typeof email === 'string') user.email = email.toLowerCase()
  if (typeof password === 'string' && password) Object.assign(user, makeCredentials(password))
  await persistUsers()
  return user
}

export async function setUserRole(id, role) {
  const user = findUserById(id)
  if (!user || !ROLES.includes(role)) return null
  // never demote the last admin (lockout guard)
  if (user.role === 'admin' && role !== 'admin' && adminCount() <= 1) return null
  user.role = role
  await persistUsers()
  return user
}

export async function deleteUser(id) {
  const user = findUserById(id)
  if (!user) return false
  if (user.role === 'admin' && adminCount() <= 1) return false // keep one admin
  users = loadUsers().filter((u) => u.id !== id)
  destroyUserSessions(id) // revoke access immediately
  await persistUsers()
  return true
}

// ---------- sessions ----------

// keyed by sha256(token), never the raw token — a leaked sessions.json can't
// be replayed as live cookies. Sessions written before this change were keyed
// by the raw token; they no longer match and are simply re-authenticated.
const sessions = new Map() // sha256(token) → { userId, createdAt, expiresAt }
{
  loadUsers() // ensure migration ran (sets migratedAdminId) before backfill
  const stored = readJson(SESSIONS_FILE)
  const now = Date.now()
  if (stored) {
    for (const [key, s] of Object.entries(stored)) {
      if (s.expiresAt <= now) continue
      const userId = s.userId ?? migratedAdminId // backfill pre-multi-user sessions
      if (userId && findUserById(userId)) sessions.set(key, { ...s, userId })
    }
  }
}

const persistSessions = () =>
  writeAtomic(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions))).catch(() => {})

export function createSession(userId) {
  const token = randomBytes(32).toString('hex')
  sessions.set(sha256(token), { userId, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL })
  persistSessions()
  return token // raw token goes to the cookie; only its hash is stored
}

export function destroySession(token) {
  if (sessions.delete(sha256(token))) persistSessions()
}

function destroyUserSessions(userId) {
  let changed = false
  for (const [key, s] of sessions) {
    if (s.userId === userId) {
      sessions.delete(key)
      changed = true
    }
  }
  if (changed) persistSessions()
}

function getSession(token) {
  if (!token) return null
  const key = sha256(token)
  const session = sessions.get(key)
  if (!session) return null
  if (session.expiresAt <= Date.now()) {
    sessions.delete(key)
    persistSessions()
    return null
  }
  return session
}

// ---------- cookies ----------

export function parseCookies(req) {
  const out = {}
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
  }
  return out
}

const cookieSecure =
  process.env.COOKIE_SECURE === '0'
    ? false
    : process.env.COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production'
const secure = cookieSecure ? '; Secure' : ''

export const sessionCookieHeader = (token) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}${secure}`
export const clearCookieHeader = () =>
  `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
export const sessionTokenOf = (req) => parseCookies(req)[COOKIE] ?? null

/** a user is only usable if it carries a known role — a missing/invalid role
 * is treated as un-provisioned and rejected everywhere (never trusted) */
export const hasValidRole = (user) => !!user && ROLES.includes(user.role)

/** the authenticated user for a request, or null (role is read live).
 * Users without a valid role are rejected — no ambiguous/partial access. */
export function sessionUser(req) {
  const session = getSession(sessionTokenOf(req))
  const user = session ? findUserById(session.userId) : null
  return hasValidRole(user) ? user : null
}

// ---------- invites ----------

// { id, tokenHash, email, name, role, invitedBy, createdAt, expiresAt, usedAt }
// Only the sha256 `tokenHash` is stored — never the raw token. The raw link is
// shown once, in the create/regenerate response; a lost link is re-issued via
// regenerate (which mints a new token). A leaked invites.json can no longer be
// used to accept a pending invite.
let invites = readJson(INVITES_FILE) ?? []
const persistInvites = () => writeAtomic(INVITES_FILE, JSON.stringify(invites)).catch(() => {})

const inviteActive = (i) => !i.usedAt && i.expiresAt > Date.now()

/** base view (no token) — safe for the public accept page */
export const inviteView = (i) => ({
  id: i.id,
  name: i.name,
  email: i.email,
  role: i.role,
  invitedBy: i.invitedBy ?? '',
  expiresAt: i.expiresAt,
})

/** pending (unused, unexpired) invites for the admin list. No raw token — it
 * is not stored; a lost link is re-issued via regenerate. */
export const listInvites = () => invites.filter(inviteActive).map(inviteView)

/** redacted pending invites for the all-roles members view (no token/id/name) */
export const listInvitesPublic = () =>
  invites.filter(inviteActive).map((i) => ({ email: i.email, role: i.role, expiresAt: i.expiresAt }))

/** redacted member list for the all-roles view (no ids — non-admins have no actions) */
export const listMembers = () =>
  loadUsers().map((u) => ({ name: u.name, email: u.email, role: u.role }))

/** create a single-use invite; returns { invite, token } */
export async function createInvite({ name, email, role, invitedBy }) {
  const token = randomBytes(32).toString('hex')
  const invite = {
    id: randomBytes(12).toString('hex'),
    tokenHash: sha256(token), // raw token is returned once, never stored
    email: String(email).toLowerCase(),
    name: typeof name === 'string' ? name : '',
    role: ROLES.includes(role) ? role : 'contributor',
    invitedBy: typeof invitedBy === 'string' ? invitedBy : '',
    createdAt: Date.now(),
    expiresAt: Date.now() + INVITE_TTL,
    usedAt: null,
  }
  invites.push(invite)
  await persistInvites()
  return { invite, token }
}

/** edit a pending invite: change role, extend the window, or regenerate the
 * link (new token, old one dies). Returns the admin view or null. */
export async function updateInvite(id, { role, extend, regenerate } = {}) {
  const invite = invites.find((i) => i.id === id && inviteActive(i))
  if (!invite) return null
  if (role !== undefined) {
    if (!ROLES.includes(role)) return null
    invite.role = role
  }
  if (extend) invite.expiresAt = Date.now() + INVITE_TTL
  let freshToken = null
  if (regenerate) {
    freshToken = randomBytes(32).toString('hex')
    invite.tokenHash = sha256(freshToken) // store only the hash of the new token
    invite.createdAt = Date.now()
    invite.expiresAt = Date.now() + INVITE_TTL
  }
  await persistInvites()
  // the fresh raw link is surfaced once here; null when not regenerated
  return { ...inviteView(invite), token: freshToken }
}

export async function revokeInvite(id) {
  const before = invites.length
  invites = invites.filter((i) => i.id !== id)
  if (invites.length !== before) await persistInvites()
  return invites.length !== before
}

/** the active invite for a raw token, or null */
export function findInviteByToken(token) {
  const hash = sha256(String(token ?? ''))
  return invites.find((i) => i.tokenHash === hash && inviteActive(i)) ?? null
}

/** accept an invite: create the user with the invite's role, mark it used */
export async function acceptInvite(token, password) {
  const invite = findInviteByToken(token)
  if (!invite) return { error: 'invalid or expired invite' }
  if (findUserByEmail(invite.email)) {
    invite.usedAt = Date.now()
    await persistInvites()
    return { error: 'this email already has an account' }
  }
  const user = await createUser({
    name: invite.name,
    email: invite.email,
    password,
    role: invite.role, // role is fixed server-side — never from the client
  })
  invite.usedAt = Date.now()
  await persistInvites()
  return { user }
}

// ---------- rate limiting (per key, in-memory sliding window) ----------

function limiter(windowMs, max) {
  const hits = new Map() // key → { count, windowStart }
  return {
    allowed(key) {
      const e = hits.get(key)
      if (!e || Date.now() - e.windowStart > windowMs) return true
      return e.count < max
    },
    record(key) {
      const e = hits.get(key)
      if (!e || Date.now() - e.windowStart > windowMs) {
        hits.set(key, { count: 1, windowStart: Date.now() })
      } else {
        e.count++
      }
    },
  }
}

const loginByIp = limiter(15 * 60 * 1000, 10)
const loginByEmail = limiter(15 * 60 * 1000, 10)
const inviteByIp = limiter(15 * 60 * 1000, 30)

export const loginAllowed = (ip, email) =>
  loginByIp.allowed(ip) && loginByEmail.allowed(String(email ?? '').toLowerCase())
export function recordLoginFailure(ip, email) {
  loginByIp.record(ip)
  loginByEmail.record(String(email ?? '').toLowerCase())
}
export const inviteAllowed = (ip) => inviteByIp.allowed(ip)
export const recordInviteAttempt = (ip) => inviteByIp.record(ip)
