// Single-user auth: scrypt-hashed account + file-backed sessions.
// Everything is node core — no dependencies.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DATA_DIR = join(fileURLToPath(new URL('..', import.meta.url)), 'server', 'data')
const AUTH_FILE = join(DATA_DIR, 'auth.json')
const SESSIONS_FILE = join(DATA_DIR, 'sessions.json')

const SESSION_TTL = 30 * 24 * 60 * 60 * 1000 // 30 days
const COOKIE = 'sb_session'

async function writeAtomic(file, data) {
  await mkdir(DATA_DIR, { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, file)
}

// ---------- account ----------

let account // { name, email, salt, hash } | null | undefined (unloaded)

export function getAccount() {
  if (account === undefined) {
    try {
      account = JSON.parse(readFileSync(AUTH_FILE, 'utf8'))
    } catch {
      account = null
    }
  }
  return account
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex')
}

export async function createAccount(email, password, name = '') {
  const salt = randomBytes(16).toString('hex')
  account = { name, email: email.toLowerCase(), salt, hash: hashPassword(password, salt) }
  await writeAtomic(AUTH_FILE, JSON.stringify(account))
}

/** updates the mutable profile fields; password change re-salts */
export async function updateAccount({ name, email, password }) {
  const acct = getAccount()
  if (!acct) return
  if (typeof name === 'string') acct.name = name
  if (typeof email === 'string') acct.email = email.toLowerCase()
  if (typeof password === 'string' && password) {
    acct.salt = randomBytes(16).toString('hex')
    acct.hash = hashPassword(password, acct.salt)
  }
  await writeAtomic(AUTH_FILE, JSON.stringify(acct))
}

export function verifyPassword(password) {
  const acct = getAccount()
  if (!acct) return false
  const computed = scryptSync(password, acct.salt, 64)
  return timingSafeEqual(Buffer.from(acct.hash, 'hex'), computed)
}

// ---------- sessions ----------

const sessions = new Map() // token → { createdAt, expiresAt }
try {
  const stored = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'))
  const now = Date.now()
  for (const [token, s] of Object.entries(stored)) {
    if (s.expiresAt > now) sessions.set(token, s)
  }
} catch {
  // no sessions yet
}

function persistSessions() {
  writeAtomic(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions))).catch(() => {})
}

export function createSession() {
  const token = randomBytes(32).toString('hex')
  sessions.set(token, { createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL })
  persistSessions()
  return token
}

export function destroySession(token) {
  if (sessions.delete(token)) persistSessions()
}

function getSession(token) {
  const session = token && sessions.get(token)
  if (!session) return null
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token)
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

// Secure by default in production (NODE_ENV=production) or when
// COOKIE_SECURE=1; COOKIE_SECURE=0 forces it off for local http dev.
const cookieSecure =
  process.env.COOKIE_SECURE === '0'
    ? false
    : process.env.COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production'
const secure = cookieSecure ? '; Secure' : ''

export function sessionCookieHeader(token) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}${secure}`
}

export function clearCookieHeader() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}

export function sessionTokenOf(req) {
  return parseCookies(req)[COOKIE] ?? null
}

export function requireSession(req) {
  return !!getSession(sessionTokenOf(req))
}

// ---------- login rate limit (per IP, in-memory) ----------

const WINDOW = 15 * 60 * 1000
const MAX_FAILURES = 10
const failures = new Map() // ip → { count, windowStart }

export function loginAllowed(ip) {
  const entry = failures.get(ip)
  if (!entry || Date.now() - entry.windowStart > WINDOW) return true
  return entry.count < MAX_FAILURES
}

export function recordFailure(ip) {
  const entry = failures.get(ip)
  if (!entry || Date.now() - entry.windowStart > WINDOW) {
    failures.set(ip, { count: 1, windowStart: Date.now() })
  } else {
    entry.count++
  }
}
