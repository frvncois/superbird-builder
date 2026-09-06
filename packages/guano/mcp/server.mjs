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
const {
  validateDocument,
  parseSetup,
  replaceSetup,
  reconcile,
  walkNodes,
  findNode,
  applyClass,
  isValidClass,
  isComponentType,
  styleMarkerOf,
  withStyleMarker,
  interactionMarkerOf,
  withInteractionMarker,
  hasOpenArgBracket,
} = runtime

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

/**
 * Resolve a 0-based source line to its node, tracking whether the node is inside
 * a component instance (its styles/interactions live on the master, not here).
 * Returns { node, inComponent } or throws when no node owns the line.
 */
function nodeAtLine(page, line) {
  let found = null
  let foundInComponent = false
  const visit = (nodes, inComponent) => {
    for (const n of nodes) {
      if (n.line === line) {
        found = n
        foundInComponent = inComponent
        return true
      }
      // a component instance's subtree is master-backed; the instance node's own
      // type is the component name
      const childInComponent = inComponent || isComponentType(n.type)
      if (visit(n.children ?? [], childInComponent)) return true
    }
    return false
  }
  visit(page.elements ?? [], false)
  if (!found) throw new Error(`no element at line ${line} (use get_page to see line → element)`)
  return { node: found, inComponent: foundInComponent }
}

/**
 * Keep a node's display-only code markers ((+) styled, {+} interactions) in step
 * with its state — mirrors syncNodeMarkers for one node. The editor's truth-sync
 * does NOT run on load, so an MCP write must maintain them or the code editor
 * shows a stale affordance. Returns true when page.code changed.
 */
function syncMarkersForNode(page, node) {
  if (node.line === undefined) return false
  const lines = page.code.split('\n')
  let line = lines[node.line]
  if (line === undefined || hasOpenArgBracket(line)) return false
  const style = styleMarkerOf(line)
  if (style === undefined || style === '(+)') {
    const want = !!node.classes?.trim()
    if (want !== (style === '(+)')) line = withStyleMarker(line, want)
  }
  const inter = interactionMarkerOf(line)
  if (inter === undefined || inter === '{+}') {
    const want = !!node.interactions?.length
    if (want !== (inter === '{+}')) line = withInteractionMarker(line, want)
  }
  if (line === lines[node.line]) return false
  lines[node.line] = line
  page.code = lines.join('\n')
  return true
}

/** a short human summary of an interaction library entry */
const interactionView = (it) => ({
  id: it.id,
  name: it.name,
  toClasses: it.toClasses,
  duration: it.duration,
  easing: it.easing,
})

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
  {
    name: 'get_styles',
    description:
      "An element's current Tailwind class tokens. Address the element by its source " +
      '`line` (from get_page). Requires a target.',
    inputSchema: {
      type: 'object',
      properties: { pageId: { type: 'string' }, line: { type: 'integer' } },
      required: ['pageId', 'line'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      const page = findPage(project, args.pageId)
      const { node, inComponent } = nodeAtLine(page, args.line)
      return {
        line: args.line,
        type: node.type,
        classes: (node.classes ?? '').split(/\s+/).filter(Boolean),
        inComponentInstance: inComponent,
      }
    },
  },
  {
    name: 'set_element_classes',
    description:
      "Add and/or remove Tailwind classes on an element (addressed by `line`). Each added " +
      'class is validated and applied like the Style panel: an invalid class is reported and ' +
      'skipped, a conflicting token on the same property is replaced, and flex/grid ' +
      'prerequisites are auto-added. Pass the `version` from get_page (stale structure → ' +
      "rejected). Elements inside a component instance are refused — their styles live on the " +
      'component master. Requires a target.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        line: { type: 'integer' },
        add: { type: 'array', items: { type: 'string' } },
        remove: { type: 'array', items: { type: 'string' } },
        version: { type: 'string' },
      },
      required: ['pageId', 'line', 'version'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      const page = findPage(project, args.pageId)
      const current = sha256(page.code)
      if (args.version !== current) {
        return { saved: false, reason: 'stale-version', currentVersion: current }
      }
      const { node, inComponent } = nodeAtLine(page, args.line)
      if (inComponent) {
        return {
          saved: false,
          reason: 'component-instance',
          message:
            'this element is inside a component instance — its styles live on the component ' +
            'master; edit the master block instead',
        }
      }

      let tokens = (node.classes ?? '').split(/\s+/).filter(Boolean)
      const errors = []
      for (const cls of args.add ?? []) {
        const result = applyClass(cls, tokens)
        if (result.error !== undefined) errors.push({ class: cls, error: result.error })
        else tokens = result.tokens
      }
      const removeSet = new Set(args.remove ?? [])
      tokens = tokens.filter((t) => !removeSet.has(t))

      node.classes = tokens.join(' ')
      if (!node.classes) delete node.classes // keep untouched nodes byte-identical
      syncMarkersForNode(page, node)

      await saveTargetProject(project)
      return {
        saved: true,
        line: args.line,
        classes: tokens,
        errors,
        version: sha256(page.code),
      }
    },
  },
  {
    name: 'list_interactions',
    description:
      'The project interaction library (shared, reusable animations): id, name, toClasses, ' +
      'duration, easing. Bind one to an element with bind_interaction. Requires a target.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const { project } = await loadTargetProject()
      return { interactions: (project.interactions ?? []).map(interactionView) }
    },
  },
  {
    name: 'create_interaction',
    description:
      'Add a reusable interaction to the project library. `toClasses` are the Tailwind classes ' +
      'applied to the target while active (validated; invalid ones are rejected without saving). ' +
      'Returns the new interaction id to pass to bind_interaction. Requires a target.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        toClasses: { type: 'string', description: 'space-separated Tailwind classes' },
        duration: { type: 'string', description: "e.g. 'duration-300' (default)" },
        easing: { type: 'string', description: "e.g. 'ease-out' (default)" },
      },
      required: ['name', 'toClasses'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      const name = String(args.name ?? '').trim()
      if (!name) throw new Error('a name is required')
      const badClasses = String(args.toClasses ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .filter((c) => !isValidClass(c))
      if (badClasses.length) {
        return { saved: false, reason: 'invalid-code', invalidClasses: badClasses }
      }
      const interaction = {
        id: randomUUID(),
        name,
        toClasses: String(args.toClasses ?? '').trim(),
        duration: String(args.duration ?? '').trim() || 'duration-300',
        easing: String(args.easing ?? '').trim() || 'ease-out',
      }
      project.interactions = project.interactions ?? []
      project.interactions.push(interaction)
      await saveTargetProject(project)
      return { saved: true, interaction: interactionView(interaction) }
    },
  },
  {
    name: 'bind_interaction',
    description:
      'Apply a library interaction to an element (addressed by `line`). trigger is ' +
      'hover | click | appear; targetId is the node the effect animates (a real element id in ' +
      'this page, or null = the element itself). Pass the `version` from get_page. Elements ' +
      'inside a component instance are refused (interactions live on the master). Requires a target.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        line: { type: 'integer' },
        interactionId: { type: 'string' },
        trigger: { type: 'string', enum: ['hover', 'click', 'appear'] },
        targetId: { type: ['string', 'null'] },
        version: { type: 'string' },
      },
      required: ['pageId', 'line', 'interactionId', 'trigger', 'version'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      const page = findPage(project, args.pageId)
      const current = sha256(page.code)
      if (args.version !== current) {
        return { saved: false, reason: 'stale-version', currentVersion: current }
      }
      if (!(project.interactions ?? []).some((it) => it.id === args.interactionId)) {
        throw new Error(`no interaction with id "${args.interactionId}" (use list_interactions)`)
      }
      const targetId = args.targetId ?? null
      if (targetId !== null && !findNode(page.elements ?? [], targetId)) {
        throw new Error(`targetId "${targetId}" is not an element in this page`)
      }
      const { node, inComponent } = nodeAtLine(page, args.line)
      if (inComponent) {
        return {
          saved: false,
          reason: 'component-instance',
          message: 'interactions on a component instance live on the master — edit the master block',
        }
      }
      const binding = { id: randomUUID(), interactionId: args.interactionId, trigger: args.trigger, targetId }
      node.interactions = node.interactions ?? []
      node.interactions.push(binding)
      syncMarkersForNode(page, node)
      await saveTargetProject(project)
      return { saved: true, line: args.line, binding, version: sha256(page.code) }
    },
  },
  {
    name: 'unbind_interaction',
    description:
      'Remove an interaction binding from an element (by `line` + `bindingId`). Pass the ' +
      '`version` from get_page. Requires a target.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        line: { type: 'integer' },
        bindingId: { type: 'string' },
        version: { type: 'string' },
      },
      required: ['pageId', 'line', 'bindingId', 'version'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      const page = findPage(project, args.pageId)
      const current = sha256(page.code)
      if (args.version !== current) {
        return { saved: false, reason: 'stale-version', currentVersion: current }
      }
      const { node } = nodeAtLine(page, args.line)
      const before = node.interactions?.length ?? 0
      node.interactions = (node.interactions ?? []).filter((b) => b.id !== args.bindingId)
      if (node.interactions.length === before) {
        return { saved: false, reason: 'not-found', message: `no binding "${args.bindingId}" on this element` }
      }
      if (!node.interactions.length) delete node.interactions
      syncMarkersForNode(page, node)
      await saveTargetProject(project)
      return { saved: true, line: args.line, version: sha256(page.code) }
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
