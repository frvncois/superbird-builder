import { test } from '@playwright/test'
// @ts-expect-error untyped package module
import { createToolSet } from '../../packages/guano/mcp/tools.mjs'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error untyped server module
import { exportSite } from '../../server/export.mjs'

// The in-process MCP harness shared by the mcp-* specs: the toolset and its
// bundled runtime are plain ESM driven against an in-memory store. No server,
// no browser, no login — so these specs cannot disturb smoke.spec's first-run
// flow, and they sort anywhere.

const runtimePromise = import(
  /* @vite-ignore */ '../../packages/guano/runtime/mcp-runtime.mjs' as string
).catch(() => null)

/** a page document with `body` as its body lines */
export const pageCode = (body: string) =>
  `@setup\n\tname: Home\n\tslug: /\n\tstatus: published\n\tlocale: en\n:body\n${body}\nbody:`

export interface McpSession {
  call: (name: string, args?: Record<string, unknown>) => Promise<any>
  tool: (name: string) => { description: string; inputSchema: Record<string, unknown> }
  stored: () => any
  /** the exported <body>… of the first route */
  html: () => Promise<string>
  home: () => Promise<{ id: string; version: string }>
  /** the `kind` of every publish warning, which is what these specs assert on */
  kinds: () => Promise<string[]>
  runtime: any
}

export async function mcpSession(
  projectName = 'T',
  /** what the server would report back from the export — `route-size` reads it */
  publishStats: { routes: number; bytes: number } = { routes: 1, bytes: 1 },
): Promise<McpSession> {
  const runtime = await runtimePromise
  test.skip(!runtime, 'runtime/mcp-runtime.mjs missing — run `npm run build:mcp-runtime`')
  const store = new Map([['guano-project:main', JSON.stringify(runtime.createProject(projectName))]])
  const api = {
    base: 'http://localhost:4174',
    whoami: async () => ({ id: 'u1', email: 'a@b.c', role: 'admin', name: 'A' }),
    storeGetRaw: async (k: string) => store.get(k) ?? null,
    storeGetJson: async (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null),
    storePutRaw: async (k: string, v: string) => void store.set(k, v),
    publish: async () => publishStats,
    mediaIndex: async () => ({ assets: [], folders: [] }),
    mediaUpload: async () => ({ id: 'm1' }),
  }
  const set = createToolSet({ api, runtime })
  set.setTarget('main')
  const stored = () => JSON.parse(store.get('guano-project:main')!)
  return {
    runtime,
    call: (name: string, args: Record<string, unknown> = {}) => set.toolMap.get(name)!.handler(args),
    tool: (name: string) => set.toolMap.get(name)!,
    stored,
    html: async () => {
      const dir = mkdtempSync(join(tmpdir(), 'guano-mcp-'))
      try {
        await exportSite(stored(), dir)
        const out = readFileSync(join(dir, 'index.html'), 'utf8')
        return out.slice(out.indexOf('<body'))
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    home: async () => (await set.toolMap.get('list_pages')!.handler({})).pages[0],
    kinds: async () =>
      ((await set.toolMap.get('publish')!.handler({})).warnings ?? []).map(
        (w: { kind: string }) => w.kind,
      ),
  }
}
