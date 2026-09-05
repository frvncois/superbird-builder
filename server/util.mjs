// Shared server helpers — single home for the response + atomic-write
// primitives that index.mjs, auth.mjs and media.mjs previously each
// hand-rolled.
import { timingSafeEqual } from 'node:crypto'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

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
