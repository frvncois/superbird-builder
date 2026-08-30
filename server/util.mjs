// Shared server helpers — single home for the response + atomic-write
// primitives that index.mjs, auth.mjs and media.mjs previously each
// hand-rolled (AUDIT.md F20/F21).
import { timingSafeEqual } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

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

/** write via tmp file + rename so readers never see a partial write */
export async function writeAtomic(file, data) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, file)
}

/** depth-first visit of every node in an element tree (mirrors src/lib/tree.ts) */
export function walkNodes(nodes, visit) {
  for (const node of nodes) {
    visit(node)
    walkNodes(node.children ?? [], visit)
  }
}
