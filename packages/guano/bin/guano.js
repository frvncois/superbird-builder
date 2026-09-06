#!/usr/bin/env node
// Guano CLI.
//   guano dev     start the server for local editing (http, relaxed cookie)
//   guano start   start the server for production (NODE_ENV=production)
//   guano build   export the current project as a static site (./dist-site)
// Env: PORT, GUANO_DATA_DIR (default ./data when installed), COOKIE_SECURE,
// PUBLISH_TOKEN, MEDIA_QUOTA — see the README.
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const [cmd, ...rest] = process.argv.slice(2)

const HELP = `guano — self-hosted visual website builder

Usage:
  guano dev              start the server for local editing
  guano start            start the server for production
  guano build [--out d]  export the published project as a static site
                         (default ./dist-site)
  guano mcp              run the MCP server (stdio) for AI agents
  guano --version

The admin editor is served at /admin, your published site at /.
Data lives in $GUANO_DATA_DIR (default ./data). Docs: see the README.

guano mcp connects to a RUNNING instance over HTTP — set GUANO_URL
(default http://localhost:4174) and GUANO_TOKEN (an API token from
the editor: My account → API tokens).
`

async function version() {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  console.log(pkg.version)
}

const startServer = () => import(pathToFileURL(join(ROOT, 'server', 'index.mjs')).href)

async function buildSite() {
  const outFlag = rest.indexOf('--out')
  const outDir = resolve(outFlag !== -1 && rest[outFlag + 1] ? rest[outFlag + 1] : 'dist-site')
  const { DATA_DIR } = await import(pathToFileURL(join(ROOT, 'server', 'util.mjs')).href)
  const { exportSite } = await import(pathToFileURL(join(ROOT, 'server', 'export.mjs')).href)
  let project
  try {
    // the current project, Main branch (what "apply to site" publishes)
    project = JSON.parse(
      await readFile(join(DATA_DIR, 'store', 'guano-project__main.json'), 'utf8'),
    )
  } catch {
    console.error(`no project found in ${join(DATA_DIR, 'store')} — run \`guano dev\`, create your site, then build.`)
    process.exit(1)
  }
  const stats = await exportSite(project, outDir)
  console.log(`exported ${stats.routes} routes (${(stats.bytes / 1024).toFixed(1)} kB) to ${outDir}`)
}

switch (cmd) {
  case 'dev':
    await startServer()
    break
  case 'start':
    process.env.NODE_ENV ??= 'production'
    await startServer()
    break
  case 'build':
    await buildSite()
    break
  case 'mcp': {
    const { main } = await import(pathToFileURL(join(ROOT, 'mcp', 'server.mjs')).href)
    await main()
    break
  }
  case '--version':
  case '-v':
    await version()
    break
  case '--help':
  case '-h':
  case undefined:
    console.log(HELP)
    break
  default:
    console.error(`unknown command: ${cmd}\n`)
    console.log(HELP)
    process.exit(1)
}
