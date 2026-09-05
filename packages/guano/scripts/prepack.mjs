// prepack: build the admin SPA at the repo root, then copy the runtime
// pieces into this package so the tarball is self-contained:
//   dist/            the built admin SPA (served at /admin)
//   server/          the node server (code files only — NEVER server/data)
//   src/lib/shared/  plain-JS modules the server imports as ../src/lib/shared
// The copied layout mirrors the repo exactly, so no import rewriting is
// needed and the packed server runs identically to the repo one.
import { execSync } from 'node:child_process'
import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = fileURLToPath(new URL('..', import.meta.url))
const REPO = join(PKG, '..', '..')

console.log('prepack: building the admin SPA…')
execSync('npm run build', { cwd: REPO, stdio: 'inherit' })

for (const dir of ['dist', 'server', 'src']) {
  await rm(join(PKG, dir), { recursive: true, force: true })
}

await cp(join(REPO, 'dist'), join(PKG, 'dist'), { recursive: true })

await mkdir(join(PKG, 'server'), { recursive: true })
for (const f of await readdir(join(REPO, 'server'))) {
  // code files only — server/data holds live user data and must never ship
  if (!f.endsWith('.mjs') && !f.endsWith('.js')) continue
  await cp(join(REPO, 'server', f), join(PKG, 'server', f))
}

await cp(join(REPO, 'src', 'lib', 'shared'), join(PKG, 'src', 'lib', 'shared'), {
  recursive: true,
})

console.log('prepack: dist/, server/, src/lib/shared/ staged')
