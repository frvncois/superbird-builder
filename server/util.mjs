// Shared server helpers — single home for the response + atomic-write
// primitives that index.mjs, auth.mjs and media.mjs previously each
// hand-rolled.
import { timingSafeEqual } from 'node:crypto'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Runtime data location, single source for index/auth/media/export-media.
// GUANO_DATA_DIR wins (SB_DATA_DIR is the deprecated pre-rename name —
// index.mjs warns). An npm-installed package must never write user data
// inside node_modules (wiped on reinstall), so when this file lives under
// one the default is <cwd>/data; a repo clone keeps server/data. Absolute
// either way — the exporter's write-path backstop rejects relative dirs.
const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url))
export const DATA_DIR =
  process.env.GUANO_DATA_DIR ||
  process.env.SB_DATA_DIR ||
  (PKG_ROOT.split(sep).includes('node_modules')
    ? join(process.cwd(), 'data')
    : join(PKG_ROOT, 'server', 'data'))

export function send(res, status, body, type = 'application/json', headers = {}) {
  res.writeHead(status, { 'content-type': type, ...headers })
  res.end(body)
}

/** constant-time string equality (length-safe — differing lengths return false
 * without leaking via an early exit) */
export function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export const fail = (res, status, error) => send(res, status, JSON.stringify({ error }))

/** write via tmp file + rename so readers never see a partial write.
 * Data files carry secrets (sessions, invite tokens, smtp creds, the GitHub
 * token), so the tmp file is created 0600 and rename carries the mode over —
 * owner-only on shared hosts. Data dirs likewise 0700. */
export async function writeAtomic(file, data) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp`
  await writeFile(tmp, data, { mode: 0o600 })
  await rename(tmp, file)
}

/** recursively read every file under `dir` → [{ path, data }] with
 * forward-slash relative paths. Returns [] when the dir is missing. Shared by
 * the zip publish method and the GitHub push. */
export async function readDirFiles(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true })
  } catch {
    return []
  }
  const out = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const full = join(entry.parentPath ?? entry.path, entry.name)
    out.push({ path: relative(dir, full).split('\\').join('/'), data: await readFile(full) })
  }
  return out
}

/** depth-first visit of every node in an element tree (mirrors src/lib/tree.ts) */
export function walkNodes(nodes, visit) {
  for (const node of nodes) {
    visit(node)
    walkNodes(node.children ?? [], visit)
  }
}
