// Shared server helpers — single home for the response + atomic-write
// primitives that index.mjs, auth.mjs and media.mjs previously each
// hand-rolled (AUDIT.md F20/F21).
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export function send(res, status, body, type = 'application/json', headers = {}) {
  res.writeHead(status, { 'content-type': type, ...headers })
  res.end(body)
}

export const fail = (res, status, error) => send(res, status, JSON.stringify({ error }))

/** write via tmp file + rename so readers never see a partial write */
export async function writeAtomic(file, data) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, file)
}
