// Guano MCP server (stdio). Exposes a running Guano instance to AI agents over
// the Model Context Protocol. It talks to the instance through the authed HTTP
// API (mcp/api.mjs) and reuses the editor's own DSL logic — parseSyntax,
// reconcile, validateDocument, enforceDocument — bundled at build time into
// runtime/mcp-runtime.mjs, so structure edits carry node identity and state
// exactly like the browser editor. It never touches the data dir directly.
//
// TARGET MODEL: the agent works on Main or in a draft. Write tools fail until
// the human picks a target via set_target — the store is latest-wins, so a
// write to Main while a human edits can clobber; drafts are the safe mode.
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import { whoami, storeGetRaw, storeGetJson, storePutRaw, BASE } from './api.mjs'

// the bundled editor runtime (built by `npm run build:mcp-runtime`)
const RUNTIME_URL = new URL('../runtime/mcp-runtime.mjs', import.meta.url)
let runtime
try {
  runtime = await import(RUNTIME_URL.href)
} catch {
  console.error(
    `guano mcp: runtime bundle missing at ${fileURLToPath(RUNTIME_URL)}\n` +
      `Build it with \`npm run build:mcp-runtime\` (it ships prebuilt in the npm package).`,
  )
  process.exit(1)
}
const { validateDocument, parseSetup, replaceSetup, reconcile, walkNodes } = runtime

// ---------- keys ----------

const MAIN_ID = 'main'
const projectKey = (id) => `guano-project:${id}`
const baseKey = (id) => `guano-base:${id}`
const BRANCHES_KEY = 'guano-branches'
const DEFAULT_META = { activeId: MAIN_ID, branches: [{ id: MAIN_ID, name: 'Main', createdAt: 0 }] }

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

// ---------- session state (this MCP process only) ----------

// null until the human picks; then 'main' or a draft (branch) id
let target = null

async function readBranchesMeta() {
  const meta = await storeGetJson(BRANCHES_KEY)
  if (!meta || !Array.isArray(meta.branches) || !meta.branches.some((b) => b.id === MAIN_ID)) {
    return { ...DEFAULT_META, branches: [...DEFAULT_META.branches] }
  }
  return meta
}

/** the target project blob (parsed), or throws with a clear message */
async function loadTargetProject() {
  if (!target) throw new Error('no target set — call set_target first (ask the user: Main or a draft?)')
  const raw = await storeGetRaw(projectKey(target))
  if (raw === null) throw new Error(`target "${target}" has no stored project`)
  return { project: JSON.parse(raw), raw }
}

async function saveTargetProject(project) {
  await storePutRaw(projectKey(target), JSON.stringify(project))
}

function findPage(project, pageId) {
  const page = (project.pages ?? []).find((p) => p.id === pageId)
  if (!page) throw new Error(`no page with id "${pageId}" in the target (use list_pages)`)
  return page
}

// known names for validateDocument (unknown component/collection detection)
function knownNames(project) {
  const componentNames = (project.components ?? []).map((c) => c.name)
  const collectionNames = (project.collections ?? []).map((c) => c.name)
  const listFieldNames = (project.collections ?? []).flatMap((c) =>
    (c.fields ?? []).filter((f) => f.type === 'multi-reference').map((f) => f.name),
  )
  return { componentNames, collectionNames, listFieldNames }
}

/** per-element summary keyed by 0-based source line */
function elementSummary(page) {
  const out = []
  walkNodes(page.elements ?? [], (n) => {
    if (n.line === undefined) return
    out.push({
      line: n.line,
      type: n.type,
      classes: n.classes ?? '',
      interactionCount: n.interactions?.length ?? 0,
      hasOwnContent: !!(n.content || n.src || n.background),
    })
  })
  return out.sort((a, b) => a.line - b.line)
}

const numbered = (code) =>
  code
    .split('\n')
    .map((l, i) => `${i + 1}\t${l}`)
    .join('\n')

// ---------- tools ----------

const tools = [
  {
    name: 'get_status',
    description:
      'Project name, the authenticated user, the current target (Main / a draft / none), ' +
      'and the list of drafts. Call this first to see whether a target is set.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const [user, meta, mainProject] = await Promise.all([
        whoami(),
        readBranchesMeta(),
        storeGetJson(projectKey(MAIN_ID)),
      ])
      const drafts = meta.branches
        .filter((b) => b.id !== MAIN_ID)
        .map((b) => ({ id: b.id, name: b.name, description: b.description, createdAt: b.createdAt }))
      return {
        server: BASE,
        project: mainProject?.name ?? '(none)',
        user: { name: user.name, email: user.email, role: user.role },
        target: target ?? null,
        targetSet: !!target,
        drafts,
      }
    },
  },
  {
    name: 'set_target',
    description:
      'Choose where writes go: Main or a draft. ASK THE USER whether to work on Main or in a ' +
      'draft before selecting — writing to Main while a human edits can clobber their work; ' +
      'drafts are the safe mode. Pass { target: "main" } or { target: "<draftId>" } to select an ' +
      'existing one, or { createDraft: "<name>" } to snapshot Main into a new draft and select it.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '"main" or an existing draft id' },
        createDraft: { type: 'string', description: 'name for a new draft branched from Main' },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      if (args.createDraft) {
        const name = String(args.createDraft).trim() || 'Draft'
        const mainRaw = await storeGetRaw(projectKey(MAIN_ID))
        if (mainRaw === null) throw new Error('no Main project to branch from')
        const id = randomUUID()
        // mirror useBranches.createBranch: project + 3-way-merge base both start
        // as a byte-identical copy of Main
        await storePutRaw(projectKey(id), mainRaw)
        await storePutRaw(baseKey(id), mainRaw)
        const meta = await readBranchesMeta()
        meta.branches.push({ id, name, createdAt: Date.now() })
        // preserve the human editor's activeId — do NOT switch their view
        await storePutRaw(BRANCHES_KEY, JSON.stringify(meta))
        target = id
        return { ok: true, target, name, created: true }
      }
      const t = String(args.target ?? '')
      if (t === MAIN_ID) {
        target = MAIN_ID
        return { ok: true, target }
      }
      const meta = await readBranchesMeta()
      if (!meta.branches.some((b) => b.id === t)) {
        throw new Error(`no draft with id "${t}" (call get_status to list drafts)`)
      }
      target = t
      return { ok: true, target }
    },
  },
  {
    name: 'list_pages',
    description: 'The target project\'s pages: id, name, slug, status. Requires a target.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const { project } = await loadTargetProject()
      return {
        target,
        pages: (project.pages ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.path,
          status: p.status,
          isCollectionTemplate: !!p.collectionId,
        })),
      }
    },
  },
  {
    name: 'get_page',
    description:
      'A page\'s DSL code (with line numbers), a version hash, and a per-element summary ' +
      '(line → type, classes, interactionCount, hasOwnContent). Pass the version back to ' +
      'set_page_code so a stale write is rejected. Requires a target.',
    inputSchema: {
      type: 'object',
      properties: { pageId: { type: 'string' } },
      required: ['pageId'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      const page = findPage(project, args.pageId)
      return {
        target,
        pageId: page.id,
        name: page.name,
        slug: page.path,
        status: page.status,
        version: sha256(page.code),
        code: page.code,
        numberedCode: numbered(page.code),
        elements: elementSummary(page),
      }
    },
  },
  {
    name: 'set_page_code',
    description:
      "Replace a page's DSL code. Pass the `version` from get_page — a mismatch means a human " +
      'edited the page since you read it, so the write is rejected (re-read and retry). Invalid ' +
      'code is returned as diagnostics WITHOUT saving. On success the element tree is re-derived ' +
      'while carrying node identity + styling/interactions/content (exactly like the editor). ' +
      'Requires a target; concurrency is latest-wins, so prefer a draft over Main.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        code: { type: 'string', description: 'full page DSL (the @setup block + :body … body:)' },
        version: { type: 'string', description: 'the version hash from get_page' },
      },
      required: ['pageId', 'code', 'version'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      const page = findPage(project, args.pageId)

      const current = sha256(page.code)
      if (args.version !== current) {
        return {
          saved: false,
          reason: 'stale-version',
          message: 'the page changed since get_page — re-read it and retry',
          currentVersion: current,
        }
      }

      // 1. validate what the agent typed — the agent gets a compiler
      const { componentNames, collectionNames, listFieldNames } = knownNames(project)
      const diagnostics = validateDocument(args.code, componentNames, collectionNames, listFieldNames)
      if (diagnostics.length) {
        return { saved: false, reason: 'invalid-code', diagnostics }
      }

      // 2. protect the @setup + :body scaffold and pin the stored locale line to
      //    the default (like the editor), but keep the body lines VERBATIM —
      //    re-normalizing indentation would diverge from the stored code and
      //    defeat reconcile's line diff. Then re-derive the element tree from the
      //    OLD code → new code so node identity + node-only state survive.
      const meta = parseSetup(args.code)
      const rebuilt = replaceSetup(args.code, {
        name: meta.name,
        slug: meta.slug,
        status: meta.status,
        locale: project.defaultLocale || 'en',
      })
      page.elements = reconcile(page.code, rebuilt, page.elements)
      page.code = rebuilt
      page.name = meta.name
      page.path = meta.slug
      page.status = meta.status

      await saveTargetProject(project)
      return { saved: true, pageId: page.id, version: sha256(page.code) }
    },
  },
]

const toolMap = new Map(tools.map((t) => [t.name, t]))

// ---------- wire up the MCP server ----------

const server = new Server(
  { name: 'guano', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = toolMap.get(request.params.name)
  if (!tool) {
    return { isError: true, content: [{ type: 'text', text: `unknown tool: ${request.params.name}` }] }
  }
  try {
    const result = await tool.handler(request.params.arguments ?? {})
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: e?.message ?? String(e) }] }
  }
})

// fail fast on a bad URL/token before speaking MCP
export async function main() {
  try {
    const user = await whoami()
    console.error(`guano mcp: connected to ${BASE} as ${user.email} (${user.role})`)
  } catch (e) {
    console.error(`guano mcp: ${e.message}`)
    process.exit(1)
  }
  await server.connect(new StdioServerTransport())
  console.error('guano mcp: ready (stdio)')
}
