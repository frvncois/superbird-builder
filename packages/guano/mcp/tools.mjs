// Transport-agnostic tool registry shared by BOTH agent surfaces:
//  - `guano mcp` (packages/guano/mcp/server.mjs) — stdio, external MCP clients
//  - the in-editor assistant (server/agent.mjs) — POST /api/agent agentic loop
// One tool implementation, two surfaces. `api` abstracts how the instance is
// reached (HTTP with a bearer for the MCP process; direct store access
// in-server); `runtime` is the bundled editor logic (runtime/mcp-runtime.mjs).
// `target` (Main or a draft id) is per-toolset closure state — create one
// toolset per session/request context, never share across users.
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

// the AI-first handbook (DSL grammar, element registry, style rules, workflow) —
// served verbatim by get_guide and as the MCP server's initialize instructions.
// Ships next to this file in the npm package (mcp/ is in package.json files).
export const GUIDE = (() => {
  try {
    return readFileSync(new URL('./GUIDE.md', import.meta.url), 'utf8')
  } catch {
    return null
  }
})()

export function createToolSet({ api, runtime }) {
  const { whoami, storeGetRaw, storeGetJson, storePutRaw, publish, mediaIndex, mediaUpload } = api
  const {
    validateDocument,
    parseSyntax,
    parseSetup,
    replaceSetup,
    buildDocument,
    slugify,
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
    dataMarkerOf,
    withDataMarker,
    hasOpenArgBracket,
    isLeafElement,
    isRich,
    sanitizeRich,
    SAFE_SRC,
    setStyleTokens,
    isValidToken,
    RESERVED_TOKEN_NAMES,
    createPage,
    defaultSettings,
    normalizeComponentName,
    serializeNode,
    expandComponentInstances,
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
  if (raw === null) {
    throw new Error(
      `target "${target}" has no stored project — a fresh instance seeds its project only when ` +
      `an admin opens the editor. Ask the user to open /admin in a browser once, then retry.`,
    )
  }
  const project = JSON.parse(raw)
  // feed design-token names into the class vocabulary so bg-<token> etc.
  // validate in edit_elements/create_interaction (mirrors useSettings' watcher)
  setStyleTokens((project.settings?.tokens ?? []).filter(isValidToken).map((t) => t.name))
  return { project, raw }
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
      // the node's stable id — what bind_interaction's targetId refers to
      id: n.id,
      type: n.type,
      classes: n.classes ?? '',
      interactionCount: n.interactions?.length ?? 0,
      hasOwnContent: !!(n.content || n.src || n.background),
      ...(n.htmlId ? { htmlId: n.htmlId } : {}),
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
 * Resolve an edit's element by stable `id` (preferred — survives structural
 * edits) or 0-based `line`. Same component-instance tracking as nodeAtLine.
 */
function resolveEditNode(page, edit) {
  if (edit.id) {
    let found = null
    let foundInComponent = false
    const visit = (nodes, inComponent) => {
      for (const n of nodes) {
        if (n.id === edit.id) {
          found = n
          foundInComponent = inComponent
          return true
        }
        if (visit(n.children ?? [], inComponent || isComponentType(n.type))) return true
      }
      return false
    }
    visit(page.elements ?? [], false)
    if (!found) throw new Error(`no element with id "${edit.id}" (use get_page to see ids)`)
    return { node: found, inComponent: foundInComponent }
  }
  if (edit.line === undefined) throw new Error('each edit needs an `id` or a `line`')
  return nodeAtLine(page, edit.line)
}

/**
 * Keep a node's display-only code markers ([+] own data, (+) styled, {+}
 * interactions) in step with its state — mirrors syncNodeMarkers for one node.
 * The editor's truth-sync does NOT run on load, so an MCP write must maintain
 * them or the code editor shows a stale affordance. Returns true when page.code
 * changed.
 */
function syncMarkersForNode(page, node) {
  if (node.line === undefined) return false
  const lines = page.code.split('\n')
  let line = lines[node.line]
  if (line === undefined || hasOpenArgBracket(line)) return false
  if (node.type !== 'body' && node.arg === undefined) {
    // a real [name] binding owns the slot — withDataMarker no-ops on it
    const want = !!(node.content || node.src)
    if (want !== (dataMarkerOf(line) === '[+]')) line = withDataMarker(line, want)
  }
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

/**
 * Master node an in-component instance node maps to, by structural position
 * (mirrors export.mjs buildMasterMap / the editor's pairing). Returns null
 * when the instance's structure has diverged past the master's.
 */
function masterNodeFor(project, page, instanceNode) {
  let found = null
  walkNodes(page.elements ?? [], (n) => {
    if (found || !isComponentType(n.type)) return
    const def = (project.components ?? []).find((c) => c.name === n.type)
    if (!def) return
    const pair = (inst, master) => {
      if (found || inst.type !== master.type) return
      if (inst.id === instanceNode.id) {
        found = master
        return
      }
      const len = Math.min(inst.children.length, master.children.length)
      for (let i = 0; i < len; i++) pair(inst.children[i], master.children[i])
    }
    pair(n, def.root)
  })
  return found
}

/**
 * instance node id → { master, rootId } for every in-component node on a page
 * (mirrors export.mjs buildMasterMap). `rootId` is the instance's :Name
 * wrapper id — two nodes in the same instance share it.
 */
function buildInstanceMap(project, page) {
  const map = new Map()
  const pair = (inst, master, rootId) => {
    if (inst.type !== master.type) return
    map.set(inst.id, { master, rootId })
    const len = Math.min(inst.children.length, master.children.length)
    for (let i = 0; i < len; i++) pair(inst.children[i], master.children[i], rootId)
  }
  walkNodes(page.elements ?? [], (n) => {
    if (!isComponentType(n.type)) return
    const def = (project.components ?? []).find((c) => c.name === n.type)
    if (def) pair(n, def.root, n.id)
  })
  return map
}

/**
 * Resolve a binding's stored targetId. Inside a component, a cross-element
 * target must be stored as the MASTER node id (the exporter's scopedTargets
 * matches master ids) and must live in the SAME instance. Returns
 * { targetId } or { error }.
 */
function resolveBindTarget(project, page, ownerNode, inComponent, rawTarget) {
  const target = rawTarget === 'null' || rawTarget === '' ? null : (rawTarget ?? null)
  if (target === null) return { targetId: null }
  if (!inComponent) {
    if (!findNode(page.elements ?? [], target)) {
      return { error: `bind targetId "${target}" is not an element in this page` }
    }
    return { targetId: target }
  }
  const instMap = buildInstanceMap(project, page)
  const ownerInfo = instMap.get(ownerNode.id)
  const targetInfo = instMap.get(target)
  if (!targetInfo || targetInfo.rootId !== ownerInfo?.rootId) {
    return { error: `bind targetId "${target}" must be another element in the same component instance` }
  }
  return { targetId: targetInfo.master.id }
}

/** the editor's structure-adoption: keep master nodes (ids/styles/content)
 * where types line up, mint new ones for new children — recursive, pooled
 * by type so reorders keep identity (mirrors useComponents.adoptStructure) */
function adoptStructure(master, edited, selfName) {
  const pool = [...master.children]
  master.children = edited.children
    .filter((child) => child.type !== selfName)
    .map((child) => {
      const at = pool.findIndex((m) => m.type === child.type)
      const node =
        at !== -1
          ? pool.splice(at, 1)[0]
          : { id: randomUUID(), type: child.type, content: child.content ?? '', children: [] }
      // arg + link are CODE-owned — the edited block is authoritative
      if (child.arg) node.arg = child.arg
      else delete node.arg
      if (child.link) node.link = child.link
      else delete node.link
      adoptStructure(node, child, selfName)
      return node
    })
}

/** rewrite one closed instance block from the master's structure, keeping
 * same-position nodes' identity (mirrors useComponents.rewriteInstanceBlock) */
function rewriteInstanceBlock(page, node, def) {
  if (node.line === undefined) return
  const lines = page.code.split('\n')
  const start = node.line
  const end = node.endLine ?? node.line
  if (end <= start) return
  const indent = lines[start].match(/^\t*/)[0]
  const inner = def.root.children.flatMap((c) => serializeNode(c, `${indent}\t`))
  const oldInnerLength = end - start - 1
  const rest = [...lines.slice(0, start + 1), ...inner, ...lines.slice(end)]
  const map = new Map()
  for (let i = 0; i < rest.length; i++) {
    if (i <= start) map.set(i, i)
    else if (i < start + 1 + inner.length) {
      const innerIndex = i - (start + 1)
      if (innerIndex < oldInnerLength) map.set(i, start + 1 + innerIndex)
    } else {
      map.set(i, i - inner.length + oldInnerLength)
    }
  }
  const before = page.code
  page.code = rest.join('\n')
  page.elements = reconcile(before, page.code, page.elements, map)
}

/** write/prune a per-locale content/src override — empty values delete the
 * key, empty buckets are pruned, so touch-then-clear leaves the node
 * byte-identical (keeps merge signatures stable, mirrors useLocale) */
function setLocaleOverride(node, locale, key, value) {
  node.locales = node.locales ?? {}
  const bucket = { ...(node.locales[locale] ?? {}) }
  if (value) bucket[key] = value
  else delete bucket[key]
  if (Object.keys(bucket).length) node.locales[locale] = bucket
  else delete node.locales[locale]
  if (!Object.keys(node.locales).length) delete node.locales
}

/** a short human summary of an interaction library entry */
const interactionView = (it) => ({
  id: it.id,
  name: it.name,
  toClasses: it.toClasses,
  duration: it.duration,
  easing: it.easing,
})

function findCollection(project, id) {
  const c = (project.collections ?? []).find((c) => c.id === id)
  if (!c) throw new Error(`no collection with id "${id}" (use list_collections)`)
  return c
}

const fieldView = (f) => ({ id: f.id, name: f.name, type: f.type, refCollectionId: f.refCollectionId })
const entryView = (e) => ({ id: e.id, name: e.name, slug: e.slug, values: e.values, locales: e.locales })

// ---------- tools ----------

const tools = [
  {
    name: 'get_guide',
    description:
      'The Guano handbook: the page DSL grammar, the full element registry, how styling/' +
      'content/interactions attach to elements, the class-validation rules, and the intended ' +
      'workflow. READ THIS BEFORE YOUR FIRST WRITE — it answers every "how do I express X" ' +
      'question; nothing needs to be discovered by trial and error.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      if (!GUIDE) throw new Error('GUIDE.md is missing from this installation')
      return { guide: GUIDE }
    },
  },
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
        server: api.base ?? '',
        project: mainProject?.name ?? '(none)',
        user: { name: user.name, email: user.email, role: user.role },
        target: target ?? null,
        targetSet: !!target,
        drafts,
        ...(mainProject
          ? {}
          : {
              note:
                'no project exists yet — it is seeded when an admin opens /admin in a browser; ' +
                'ask the user to do that first, every read/write will fail until then',
            }),
      }
    },
  },
  {
    name: 'set_target',
    description:
      'Choose where writes go: Main or a draft. THE HUMAN DECIDES THIS, NOT YOU — before ' +
      'calling, ask them one question ("Work on Main directly, or in a draft?") unless their ' +
      'message already named a target. Suggest Main for a fresh/empty project (a draft is ' +
      'overkill there); suggest a draft when the site has real content or someone may be ' +
      'editing (Main writes can clobber their work; drafts are reviewed and merged in the ' +
      'editor). Pass { target: "main" } or { target: "<draftId>" }, or ' +
      '{ createDraft: "<name>" } to snapshot Main into a new draft and select it.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: '"main" or an existing draft id' },
        createDraft: { type: 'string', description: 'name for a new draft branched from Main' },
        chosenByUser: {
          type: 'boolean',
          description:
            'REQUIRED true: attests the human explicitly chose this target (in their request ' +
            'or in answer to your question). If they have not, ask them — do not guess.',
        },
      },
      required: ['chosenByUser'],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (args.chosenByUser !== true) {
        throw new Error(
          'the target is the human\'s call — ask them ("Work on Main directly, or in a draft?") ' +
          'and pass chosenByUser: true once they have answered',
        )
      }
      if (args.createDraft) {
        const name = String(args.createDraft).trim() || 'Draft'
        const mainRaw = await storeGetRaw(projectKey(MAIN_ID))
        if (mainRaw === null) {
          throw new Error(
            'no Main project to branch from — a fresh instance seeds its project only when an ' +
            'admin opens the editor. Ask the user to open /admin in a browser once, then retry.',
          )
        }
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
      '(line, id → type, classes, interactionCount, hasOwnContent). Pass the version to writes ' +
      '(set_page_code, edit_elements) so a stale write is rejected. Pass summaryOnly: true to ' +
      'skip the code fields — enough for harvesting ids/versions after a write you authored, ' +
      'and much smaller on big pages. Requires a target.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        summaryOnly: { type: 'boolean', description: 'omit code/numberedCode from the response' },
        elementIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'return only these elements in the summary (big pages: fetch just what you need)',
        },
      },
      required: ['pageId'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      const page = findPage(project, args.pageId)
      let elements = elementSummary(page)
      if (args.elementIds?.length) {
        const wanted = new Set(args.elementIds)
        elements = elements.filter((e) => wanted.has(e.id))
      }
      return {
        target,
        pageId: page.id,
        name: page.name,
        slug: page.path,
        status: page.status,
        version: sha256(page.code),
        ...(args.summaryOnly ? {} : { code: page.code, numberedCode: numbered(page.code) }),
        elements,
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

      // 2. expand freshly written component references (`:Card:` or an empty
      //    `:Card`/`Card:` pair) into their full editable block, exactly like
      //    the editor — instances carry the structure; a bare token would
      //    render empty
      const expanded = expandComponentInstances(args.code, project.components ?? [])

      // 3. protect the @setup + :body scaffold and pin the stored locale line to
      //    the default (like the editor), but keep the body lines VERBATIM —
      //    re-normalizing indentation would diverge from the stored code and
      //    defeat reconcile's line diff. Then re-derive the element tree from the
      //    OLD code → new code so node identity + node-only state survive.
      const meta = parseSetup(expanded)
      const rebuilt = replaceSetup(expanded, {
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
    name: 'create_page',
    description:
      'Add a new page to the target project (empty body, scaffolded like the editor). `slug` ' +
      'must start with "/" and be unique; defaults to "/<slugified name>". `status` defaults to ' +
      'published (use "draft" to keep it out of the export). Returns the page id and version ' +
      'for follow-up writes. Requires a target.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        slug: { type: 'string', description: 'route path, e.g. /about' },
        status: { type: 'string', enum: ['published', 'draft'] },
      },
      required: ['name'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      const name = String(args.name ?? '').trim()
      if (!name) throw new Error('a page name is required')
      const path = args.slug ? String(args.slug) : `/${slugify(name)}`
      if (!path.startsWith('/')) throw new Error('slug must start with "/"')
      if ((project.pages ?? []).some((p) => p.path === path)) {
        return { saved: false, reason: 'slug-taken', message: `a page with slug "${path}" already exists` }
      }
      const page = createPage(name, path, project.defaultLocale || 'en')
      if (args.status === 'draft') {
        page.status = 'draft'
        page.code = replaceSetup(page.code, {
          name,
          slug: path,
          status: 'draft',
          locale: project.defaultLocale || 'en',
        })
        page.elements = parseSyntax(page.code)
      }
      project.pages = project.pages ?? []
      project.pages.push(page)
      await saveTargetProject(project)
      return { saved: true, pageId: page.id, slug: path, version: sha256(page.code) }
    },
  },
  {
    name: 'delete_page',
    description:
      'Delete a page. The home page (slug "/") can never be deleted, and a collection template ' +
      'page belongs to its collection — use delete_collection for those. Requires a target.',
    inputSchema: {
      type: 'object',
      properties: { pageId: { type: 'string' } },
      required: ['pageId'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      const page = findPage(project, args.pageId)
      const home = (project.pages ?? []).find((p) => p.path === '/') ?? project.pages?.[0]
      if (page.id === home?.id) {
        return { saved: false, reason: 'home-page', message: 'the home page can never be deleted' }
      }
      if (page.collectionId) {
        return {
          saved: false,
          reason: 'collection-template',
          message: 'this page is a collection template — delete the collection instead (delete_collection)',
        }
      }
      project.pages = project.pages.filter((p) => p.id !== page.id)
      await saveTargetProject(project)
      return { saved: true, deleted: page.id }
    },
  },
  {
    name: 'set_page_seo',
    description:
      'Per-page SEO overrides: `title` (otherwise the project titleTemplate applies to the page ' +
      'name) and `description` (otherwise the project default). "" clears an override. This is ' +
      'the ONLY way to set page metadata — extra @setup keys are dropped. Requires a target.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['pageId'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      const page = findPage(project, args.pageId)
      const seo = { ...(page.seo ?? {}) }
      if (args.title !== undefined) {
        if (args.title) seo.title = args.title
        else delete seo.title
      }
      if (args.description !== undefined) {
        if (args.description) seo.description = args.description
        else delete seo.description
      }
      if (Object.keys(seo).length) page.seo = seo
      else delete page.seo
      await saveTargetProject(project)
      return { saved: true, pageId: page.id, seo: page.seo ?? null }
    },
  },
  {
    name: 'list_components',
    description:
      'The project\'s shared components: id, name (the :Name: token), structure (DSL block), ' +
      'and how many instances exist across pages. Requires a target.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const { project } = await loadTargetProject()
      return {
        components: (project.components ?? []).map((def) => {
          let instances = 0
          for (const p of project.pages ?? []) {
            walkNodes(p.elements ?? [], (n) => {
              if (n.type === def.name) instances++
            })
          }
          return {
            id: def.id,
            name: def.name,
            instances,
            structure: [`:${def.name}`, ...def.root.children.flatMap((c) => serializeNode(c, '\t')), `${def.name}:`].join('\n'),
          }
        }),
      }
    },
  },
  {
    name: 'create_component',
    description:
      'Turn an existing element (and its subtree) into a shared component: the subtree becomes ' +
      'the master, the original block is wrapped as :Name … Name: (an instance). Reuse it on ' +
      'other pages by writing :Name: in their code (set_page_code expands it). Styles and ' +
      'interactions on inner elements are SHARED across instances (edit any instance — the ' +
      'edit lands on the master); text content stays per-instance. Requires a target.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        id: { type: 'string', description: 'element id (from get_page) whose subtree becomes the component' },
        name: { type: 'string', description: 'component name — normalized to CapitalCase' },
        version: { type: 'string' },
      },
      required: ['pageId', 'id', 'name', 'version'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      const page = findPage(project, args.pageId)
      const current = sha256(page.code)
      if (args.version !== current) {
        return { saved: false, reason: 'stale-version', currentVersion: current }
      }
      const { node: source, inComponent } = resolveEditNode(page, { id: args.id })
      if (source.line === undefined || source.type === 'body') {
        return { saved: false, reason: 'invalid-source', message: 'pick a real element, not the body' }
      }
      if (isComponentType(source.type) || inComponent) {
        return { saved: false, reason: 'invalid-source', message: 'element is already (part of) a component' }
      }
      const name = normalizeComponentName(args.name, (project.components ?? []).map((c) => c.name))
      // master: a deep clone with fresh ids in the master id space
      const cloned = JSON.parse(JSON.stringify(source))
      walkNodes([cloned], (n) => {
        n.id = randomUUID()
        delete n.line
        delete n.endLine
      })
      const root = { id: randomUUID(), type: name, content: '', children: [cloned] }
      project.components = project.components ?? []
      project.components.push({ id: randomUUID(), name, root })

      // wrap the source block: open line, inner one level deeper, close line
      // (exact line map — mirrors the editor's createComponent)
      const lines = page.code.split('\n')
      const start = source.line
      const end = source.endLine ?? source.line
      const indent = lines[start].match(/^\t*/)[0]
      const rest = [
        ...lines.slice(0, start),
        `${indent}:${name}`,
        ...lines.slice(start, end + 1).map((l) => `\t${l}`),
        `${indent}${name}:`,
        ...lines.slice(end + 1),
      ]
      const map = new Map()
      for (let i = 0; i < rest.length; i++) {
        if (i < start) map.set(i, i)
        else if (i >= start + 1 && i <= end + 1) map.set(i, i - 1)
        else if (i > end + 2) map.set(i, i - 2)
      }
      const before = page.code
      page.code = rest.join('\n')
      page.elements = reconcile(before, page.code, page.elements, map)
      await saveTargetProject(project)
      const def = project.components[project.components.length - 1]
      return {
        saved: true,
        componentId: def.id,
        name,
        usage: `write ':${name}:' in any page's code to add an instance`,
        version: sha256(page.code),
      }
    },
  },
  {
    name: 'update_component',
    description:
      "Replace a component's STRUCTURE by passing its full DSL block (`:Name … Name:`). Master " +
      'nodes are re-adopted by type (styles/interactions/content survive where the shape ' +
      'matches; new elements start clean) and every instance block on every page is rewritten ' +
      'to match. Use edit_elements on any instance to style shared elements. Requires a target.',
    inputSchema: {
      type: 'object',
      properties: {
        componentId: { type: 'string' },
        code: { type: 'string', description: 'the full block: :Name\\n\\t… \\nName:' },
      },
      required: ['componentId', 'code'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      const def = (project.components ?? []).find((c) => c.id === args.componentId)
      if (!def) throw new Error(`no component with id "${args.componentId}" (use list_components)`)
      const blockLines = String(args.code ?? '').split('\n').filter((l) => l.trim())
      if (blockLines[0]?.trim() !== `:${def.name}` || blockLines[blockLines.length - 1]?.trim() !== `${def.name}:`) {
        return {
          saved: false,
          reason: 'invalid-block',
          message: `the code must open with ':${def.name}' and close with '${def.name}:'`,
        }
      }
      // validate the inner structure through the normal document validator
      const doc = [
        '@setup', '\tname: x', '\tslug: /x', '\tstatus: draft', '\tlocale: en',
        ':body', ...blockLines.map((l) => (l.startsWith('\t') ? l : `\t${l}`)), 'body:',
      ].join('\n')
      const { collectionNames, listFieldNames } = knownNames(project)
      const diagnostics = validateDocument(doc, [def.name], collectionNames, listFieldNames)
      if (diagnostics.length) return { saved: false, reason: 'invalid-code', diagnostics }
      const parsed = parseSyntax(blockLines.join('\n'))
      const editedRoot = parsed.find((n) => n.type === def.name)
      if (!editedRoot) return { saved: false, reason: 'invalid-block', message: 'could not parse the block' }
      let nested = false
      walkNodes(editedRoot.children, (n) => {
        if (isComponentType(n.type)) nested = true
      })
      if (nested) {
        return { saved: false, reason: 'invalid-block', message: 'components cannot contain other components' }
      }

      // adopt the new shape into the master (identity kept where types match),
      // then rewrite every closed instance block to the new structure
      adoptStructure(def.root, editedRoot, def.name)
      let updatedInstances = 0
      for (const p of project.pages ?? []) {
        const instances = []
        walkNodes(p.elements ?? [], (n) => {
          if (n.type === def.name) instances.push(n)
        })
        for (const inst of instances) {
          const codeLines = p.code.split('\n')
          const closed =
            inst.line !== undefined &&
            inst.endLine !== undefined &&
            inst.endLine > inst.line &&
            codeLines[inst.endLine]?.trim() === `${def.name}:`
          if (closed) {
            rewriteInstanceBlock(p, inst, def)
            updatedInstances++
          }
        }
      }
      await saveTargetProject(project)
      return { saved: true, componentId: def.id, updatedInstances }
    },
  },
  {
    name: 'get_settings',
    description:
      'Project-level settings an agent can work with: site SEO defaults, design tokens ' +
      '(color classes), fonts, and the custom <head> HTML. Requires a target.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const { project } = await loadTargetProject()
      const s = project.settings ?? defaultSettings()
      return {
        seo: s.seo ?? {},
        domain: s.domain ?? '',
        tokens: (s.tokens ?? []).map((t) => ({ name: t.name, value: t.value })),
        fonts: s.fonts ?? { family: '' },
        customCodeHead: s.customCode?.head ?? '',
      }
    },
  },
  {
    name: 'update_settings',
    description:
      'Update project settings — any subset of: `tokens` REPLACES the design-token list ' +
      '([{name, value}] — kebab-case name, hex value; a token "brand" enables bg-brand/' +
      'text-brand/border-brand everywhere, so PREFER tokens over repeating arbitrary hex ' +
      'classes); `seo` merges {siteName, titleTemplate ("%s" = page name), description}; ' +
      '`fonts` merges {family, googleFontsUrl (must be a https://fonts.googleapis.com/… CSS ' +
      'URL)}; `customCodeHead` replaces the raw HTML injected into every exported <head> — ' +
      'intended for font @font-face/preload links, keep it minimal. Requires a target.',
    inputSchema: {
      type: 'object',
      properties: {
        tokens: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, value: { type: 'string' } },
            required: ['name', 'value'],
            additionalProperties: false,
          },
        },
        seo: {
          type: 'object',
          properties: {
            siteName: { type: 'string' },
            titleTemplate: { type: 'string' },
            description: { type: 'string' },
          },
          additionalProperties: false,
        },
        fonts: {
          type: 'object',
          properties: { family: { type: 'string' }, googleFontsUrl: { type: 'string' } },
          additionalProperties: false,
        },
        customCodeHead: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      project.settings = project.settings ?? defaultSettings()
      const s = project.settings

      if (args.tokens !== undefined) {
        const invalid = args.tokens.filter((t) => !isValidToken({ name: t.name, value: t.value }))
        if (invalid.length) {
          return {
            saved: false,
            reason: 'invalid-tokens',
            invalid: invalid.map((t) => t.name),
            message:
              'token names are kebab-case ([a-z][a-z0-9-]*), values are #hex; reserved ' +
              `(Tailwind palette) names: ${[...RESERVED_TOKEN_NAMES].join(', ')}`,
          }
        }
        // keep existing ids for same-name tokens so unrelated diffs stay quiet
        const byName = new Map((s.tokens ?? []).map((t) => [t.name, t.id]))
        s.tokens = args.tokens.map((t) => ({
          id: byName.get(t.name) ?? randomUUID(),
          name: t.name,
          value: t.value,
        }))
        setStyleTokens(s.tokens.map((t) => t.name))
      }
      if (args.seo !== undefined) {
        s.seo = { ...(s.seo ?? {}), ...args.seo }
      }
      if (args.fonts !== undefined) {
        const url = args.fonts.googleFontsUrl
        if (url && !url.startsWith('https://fonts.googleapis.com/')) {
          return {
            saved: false,
            reason: 'invalid-fonts-url',
            message: 'googleFontsUrl must start with https://fonts.googleapis.com/ (or be "")',
          }
        }
        s.fonts = { ...(s.fonts ?? { family: '' }), ...args.fonts }
        if (s.fonts.googleFontsUrl === '') delete s.fonts.googleFontsUrl
      }
      if (args.customCodeHead !== undefined) {
        s.customCode = { ...(s.customCode ?? {}), head: args.customCodeHead }
      }

      await saveTargetProject(project)
      return {
        saved: true,
        tokens: (s.tokens ?? []).map((t) => ({ name: t.name, value: t.value })),
        seo: s.seo,
        fonts: s.fonts,
        customCodeHead: s.customCode?.head ?? '',
      }
    },
  },
  {
    name: 'edit_elements',
    description:
      'Batch-edit elements on a page: classes, text content, media src, html id, and ' +
      'interaction bindings (bindInteractions/unbindInteractionIds), for MANY elements in ONE ' +
      'call (one version check, one save — always prefer this over one call per element). Address each edit by the element `id` from get_page (PREFERRED — stable and ' +
      'immune to line-counting mistakes) or its 0-based `line`; optionally pass `expectType` ' +
      '(e.g. "h1") to make a misaddressed edit fail instead of landing on the wrong element. ' +
      'Each result echoes the element it touched (line, id, type) — check it. ' +
      'addClasses/removeClasses work like the Style panel (validated; conflicts replaced; ' +
      'flex/grid prerequisites auto-added; refused inside component instances). `content` is ' +
      'the element\'s own text — leaf elements only; inline rich tags b/strong/i/em/u/br/ul/ol/' +
      'li/a[href] are kept (sanitized), everything else is stripped; "" clears it back to the ' +
      'placeholder. `src` (image/video only) takes a /media/… path, https URL, or data: URL. ' +
      '`background` (any element) layers background media behind its content, same URL rules; ' +
      '"" clears. `htmlId` sets the html id (anchor target); "" clears. A non-default `locale` ' +
      'writes content/src as per-locale overrides instead. Per-edit failures are reported in the ' +
      'result and do NOT abort the other edits. Pass the `version` from get_page. Requires a target.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        version: { type: 'string', description: 'the version hash from get_page' },
        edits: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'element id from get_page (preferred address)' },
              line: { type: 'integer', description: '0-based source line (alternative address)' },
              expectType: { type: 'string', description: 'refuse the edit unless the element is this type' },
              addClasses: { type: 'array', items: { type: 'string' } },
              removeClasses: { type: 'array', items: { type: 'string' } },
              content: { type: 'string' },
              src: { type: 'string' },
              background: { type: 'string' },
              htmlId: { type: 'string' },
              arg: {
                type: 'string',
                description:
                  'the token\'s […] slot: a field binding (or collection name on collection-list/item); "" clears the binding',
              },
              listQuery: {
                type: ['object', 'null'],
                description:
                  'collection-list only: filter → sort → limit for the entries it repeats; null or {} clears',
                properties: {
                  limit: { type: 'integer', minimum: 1 },
                  sortField: { type: 'string', description: 'a field name, or "createdAt"' },
                  sortDir: { type: 'string', enum: ['asc', 'desc'] },
                  filter: {
                    type: 'object',
                    properties: {
                      field: { type: 'string' },
                      equals: { type: 'string' },
                      notEmpty: { type: 'boolean' },
                    },
                    required: ['field'],
                    additionalProperties: false,
                  },
                },
                additionalProperties: false,
              },
              bindInteractions: {
                type: 'array',
                description: 'library interactions to bind — batch these here, not one bind_interaction call each',
                items: {
                  type: 'object',
                  properties: {
                    interactionId: { type: 'string' },
                    trigger: { type: 'string', enum: ['hover', 'click', 'appear'] },
                    targetId: { type: 'string', description: 'element id to animate; omit for the element itself' },
                  },
                  required: ['interactionId', 'trigger'],
                  additionalProperties: false,
                },
              },
              unbindInteractionIds: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: false,
          },
        },
        locale: {
          type: 'string',
          description: 'omit for the default locale; a non-default locale localizes content/src',
        },
      },
      required: ['pageId', 'edits'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      const page = findPage(project, args.pageId)
      const current = sha256(page.code)
      if (typeof args.version !== 'string') {
        return {
          saved: false,
          reason: 'missing-version',
          message: 'pass the page version — here is the current one, retry with it',
          currentVersion: current,
        }
      }
      if (args.version !== current) {
        return { saved: false, reason: 'stale-version', currentVersion: current }
      }
      const defaultLocale = project.defaultLocale || 'en'
      const locale = args.locale || defaultLocale
      const localized = locale !== defaultLocale
      if (localized && !(project.locales ?? [defaultLocale]).includes(locale)) {
        return { saved: false, reason: 'unknown-locale', locales: project.locales ?? [defaultLocale] }
      }

      let changed = false
      const results = []
      for (const edit of args.edits) {
        const errors = []
        const applied = []
        let node, inComponent
        try {
          ;({ node, inComponent } = resolveEditNode(page, edit))
        } catch (e) {
          results.push({ ...(edit.id ? { id: edit.id } : {}), line: edit.line, errors: [e.message] })
          continue
        }
        if (edit.expectType && node.type !== edit.expectType) {
          results.push({
            line: node.line,
            id: node.id,
            type: node.type,
            errors: [`expectType mismatch: element here is ':${node.type}', not ':${edit.expectType}' — re-read get_page`],
          })
          continue
        }

        // --- classes (never localized; masters own them inside instances —
        //     in-component edits REDIRECT to the mapped master, editor-style) ---
        if (edit.addClasses?.length || edit.removeClasses?.length) {
          const styleTarget = inComponent ? masterNodeFor(project, page, node) : node
          if (localized) {
            errors.push('classes are not localizable — omit locale for class edits')
          } else if (!styleTarget) {
            errors.push('classes refused: this instance node has no master counterpart (structure diverged)')
          } else {
            // removes run FIRST so remove+add of the same class nets to the add
            // (a re-apply), not a silent removal
            const removeSet = new Set(edit.removeClasses ?? [])
            let tokens = (styleTarget.classes ?? '').split(/\s+/).filter(Boolean).filter((t) => !removeSet.has(t))
            for (const cls of edit.addClasses ?? []) {
              if (tokens.includes(cls)) continue // idempotent re-apply — not an error
              const result = applyClass(cls, tokens)
              if (result.error !== undefined) errors.push(`class "${cls}": ${result.error}`)
              else tokens = result.tokens
            }
            styleTarget.classes = tokens.join(' ')
            if (!styleTarget.classes) delete styleTarget.classes // keep untouched nodes byte-identical
            applied.push(inComponent ? 'classes (on component master — all instances)' : 'classes')
            changed = true
          }
        }

        // --- own text content (leaf elements only; rich subset sanitized) ---
        if (edit.content !== undefined) {
          if (isComponentType(node.type)) {
            errors.push('content refused: a component instance token has no own text')
          } else if (!isLeafElement(node.type)) {
            errors.push(`content refused: ':${node.type}' is a container — put text on a leaf inside it`)
          } else {
            const value = isRich(edit.content) ? sanitizeRich(edit.content) : edit.content
            if (localized) {
              setLocaleOverride(node, locale, 'content', value)
            } else if (value) {
              node.content = value
            } else {
              delete node.content
            }
            applied.push('content')
            changed = true
          }
        }

        // --- media src (image/video only; scheme allowlist) ---
        if (edit.src !== undefined) {
          if (node.type !== 'image' && node.type !== 'video') {
            errors.push(`src refused: ':${node.type}' is not an image/video element`)
          } else if (edit.src && !SAFE_SRC.test(edit.src)) {
            errors.push('src refused: use a /media/… path, https:// URL, or data:image|video URL')
          } else {
            if (localized) {
              setLocaleOverride(node, locale, 'src', edit.src)
            } else if (edit.src) {
              node.src = edit.src
            } else {
              delete node.src
            }
            applied.push('src')
            changed = true
          }
        }

        // --- background media (any element; layered behind content) ---
        if (edit.background !== undefined) {
          if (localized) {
            errors.push('background is not localizable — omit locale for background edits')
          } else if (edit.background && !SAFE_SRC.test(edit.background)) {
            errors.push('background refused: use a /media/… path, https:// URL, or data:image|video URL')
          } else {
            if (edit.background) node.background = edit.background
            else delete node.background
            applied.push('background')
            changed = true
          }
        }

        // --- arg (the token's […] slot — CODE-owned, so patch the line and
        //     reconcile with a same-line identity map; no line count change) ---
        if (edit.arg !== undefined) {
          const value = String(edit.arg)
          if (node.line === undefined || node.type === 'body') {
            errors.push('arg refused: this element\'s arg is not editable')
          } else if (value && !/^[a-z0-9.+-]+$/.test(value)) {
            errors.push('arg refused: lowercase field path ([a-z0-9.-], one dot max for a reference hop)')
          } else if (
            (node.type === 'collection-list' || node.type === 'collection-item') &&
            (() => {
              const { collectionNames, listFieldNames } = knownNames(project)
              return !value || !(collectionNames.includes(value) ||
                (node.type === 'collection-list' && listFieldNames.includes(value)))
            })()
          ) {
            errors.push(`arg refused: ':${node.type}' needs a real collection name`)
          } else {
            const lines = page.code.split('\n')
            const head = lines[node.line]?.match(/^(\s*:[a-zA-Z][a-zA-Z0-9-]*)(\[[a-z0-9.+-]*\])?/)
            if (!head) {
              errors.push('arg refused: could not locate the element token on its line')
            } else {
              const rest = lines[node.line].slice(head[1].length + (head[2]?.length ?? 0))
              lines[node.line] = head[1] + (value ? `[${value}]` : '') + rest
              const newCode = lines.join('\n')
              const identity = new Map(lines.map((_, i) => [i, i]))
              page.elements = reconcile(page.code, newCode, page.elements, identity)
              page.code = newCode
              node.arg = value || undefined
              applied.push('arg')
              changed = true
            }
          }
        }

        // --- listQuery (collection-list only; filter → sort → limit) ---
        if (edit.listQuery !== undefined) {
          if (node.type !== 'collection-list') {
            errors.push(`listQuery refused: ':${node.type}' is not a collection-list`)
          } else {
            const q = edit.listQuery
            const empty = q === null || (typeof q === 'object' && !Object.keys(q).length)
            if (empty) {
              delete node.listQuery
              applied.push('listQuery')
              changed = true
            } else {
              // soft-validate field names against the collection the list names
              const col = (project.collections ?? []).find((c) => c.name === node.arg)
              const fieldOk = (name) =>
                name === 'createdAt' || !col || (col.fields ?? []).some((f) => f.name === name)
              const bad = []
              if (q.sortField && !fieldOk(q.sortField)) bad.push(`sortField "${q.sortField}"`)
              if (q.filter?.field && !fieldOk(q.filter.field)) bad.push(`filter.field "${q.filter.field}"`)
              if (bad.length) {
                errors.push(`listQuery refused: ${bad.join(', ')} not in collection "${node.arg}"`)
              } else {
                node.listQuery = q
                applied.push('listQuery')
                changed = true
              }
            }
          }
        }

        // --- interaction bindings (batched; masters own them inside instances) ---
        if (edit.bindInteractions?.length || edit.unbindInteractionIds?.length) {
          const bindTargetNode = inComponent ? masterNodeFor(project, page, node) : node
          if (localized) {
            errors.push('interactions are not localizable — omit locale for binding edits')
          } else if (!bindTargetNode) {
            errors.push('interactions refused: this instance node has no master counterpart (structure diverged)')
          } else {
            for (const bindingId of edit.unbindInteractionIds ?? []) {
              const before = bindTargetNode.interactions?.length ?? 0
              bindTargetNode.interactions = (bindTargetNode.interactions ?? []).filter((b) => b.id !== bindingId)
              if (bindTargetNode.interactions.length === before) errors.push(`no binding "${bindingId}" on this element`)
              else {
                applied.push('unbind')
                changed = true
              }
              if (!bindTargetNode.interactions.length) delete bindTargetNode.interactions
            }
            for (const bind of edit.bindInteractions ?? []) {
              if (!(project.interactions ?? []).some((it) => it.id === bind.interactionId)) {
                errors.push(`no interaction with id "${bind.interactionId}" (use list_interactions)`)
                continue
              }
              const resolved = resolveBindTarget(project, page, node, inComponent, bind.targetId)
              if (resolved.error) {
                errors.push(resolved.error)
                continue
              }
              bindTargetNode.interactions = bindTargetNode.interactions ?? []
              bindTargetNode.interactions.push({
                id: randomUUID(),
                interactionId: bind.interactionId,
                trigger: bind.trigger,
                targetId: resolved.targetId,
              })
              applied.push(inComponent ? 'bind (on component master — all instances)' : 'bind')
              changed = true
            }
          }
        }

        // --- html id (anchor target; never localized) ---
        if (edit.htmlId !== undefined) {
          if (localized) {
            errors.push('htmlId is not localizable — omit locale for htmlId edits')
          } else if (edit.htmlId && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(edit.htmlId)) {
            errors.push('htmlId refused: must start with a letter and use only letters/digits/-/_')
          } else {
            if (edit.htmlId) node.htmlId = edit.htmlId
            else delete node.htmlId
            applied.push('htmlId')
            changed = true
          }
        }

        // marker truth-sync skips component-instance subtrees, like the editor
        if (!inComponent && syncMarkersForNode(page, node)) changed = true
        // echo the element's identity so a misaddressed edit is visible
        results.push({
          line: node.line,
          id: node.id,
          type: node.type,
          applied,
          ...(errors.length ? { errors } : {}),
        })
      }

      if (changed) await saveTargetProject(project)
      return {
        saved: changed,
        version: sha256(page.code),
        results,
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
      'Apply ONE library interaction to an element — for several bindings, batch them via ' +
      'edit_elements.bindInteractions instead (one call, one version). Address by element `id` ' +
      '(preferred) or 0-based `line`. trigger is hover | click | appear; targetId is the node ' +
      'the effect animates — a real element id in this page, or OMIT it for the element itself. ' +
      'Pass the `version` from get_page. Elements inside a component instance are refused ' +
      '(interactions live on the master). Requires a target.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        id: { type: 'string', description: 'element id from get_page (preferred address)' },
        line: { type: 'integer', description: '0-based source line (alternative address)' },
        interactionId: { type: 'string' },
        trigger: { type: 'string', enum: ['hover', 'click', 'appear'] },
        targetId: { type: ['string', 'null'] },
        version: { type: 'string' },
      },
      required: ['pageId', 'interactionId', 'trigger', 'version'],
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
      const { node, inComponent } = resolveEditNode(page, args)
      // in-component bindings redirect to the master (editor parity); a
      // cross-element targetId is translated to the target's master id
      const bindNode = inComponent ? masterNodeFor(project, page, node) : node
      if (!bindNode) {
        return {
          saved: false,
          reason: 'component-instance',
          message: 'this instance node has no master counterpart (structure diverged)',
        }
      }
      const resolved = resolveBindTarget(project, page, node, inComponent, args.targetId)
      if (resolved.error) throw new Error(resolved.error)
      const binding = {
        id: randomUUID(),
        interactionId: args.interactionId,
        trigger: args.trigger,
        targetId: resolved.targetId,
      }
      bindNode.interactions = bindNode.interactions ?? []
      bindNode.interactions.push(binding)
      if (!inComponent) syncMarkersForNode(page, node)
      await saveTargetProject(project)
      return { saved: true, line: node.line, id: node.id, binding, version: sha256(page.code) }
    },
  },
  {
    name: 'unbind_interaction',
    description:
      'Remove an interaction binding from an element (addressed by `id` or `line`, plus the ' +
      '`bindingId`). Pass the `version` from get_page. Requires a target.',
    inputSchema: {
      type: 'object',
      properties: {
        pageId: { type: 'string' },
        id: { type: 'string', description: 'element id from get_page (preferred address)' },
        line: { type: 'integer', description: '0-based source line (alternative address)' },
        bindingId: { type: 'string' },
        version: { type: 'string' },
      },
      required: ['pageId', 'bindingId', 'version'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      const page = findPage(project, args.pageId)
      const current = sha256(page.code)
      if (args.version !== current) {
        return { saved: false, reason: 'stale-version', currentVersion: current }
      }
      const { node } = resolveEditNode(page, args)
      const before = node.interactions?.length ?? 0
      node.interactions = (node.interactions ?? []).filter((b) => b.id !== args.bindingId)
      if (node.interactions.length === before) {
        return { saved: false, reason: 'not-found', message: `no binding "${args.bindingId}" on this element` }
      }
      if (!node.interactions.length) delete node.interactions
      syncMarkersForNode(page, node)
      await saveTargetProject(project)
      return { saved: true, line: node.line, id: node.id, version: sha256(page.code) }
    },
  },
  {
    name: 'list_collections',
    description:
      'The target project\'s CMS collections: id, name, field count, entry count, template page ' +
      'id. Requires a target.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const { project } = await loadTargetProject()
      return {
        collections: (project.collections ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          fieldCount: c.fields?.length ?? 0,
          entryCount: c.entries?.length ?? 0,
          templatePageId: c.templatePageId,
        })),
      }
    },
  },
  {
    name: 'get_collection',
    description:
      'One collection in full: its fields (id, name, type) and entries (id, name, slug, values, ' +
      'locale overrides). Requires a target.',
    inputSchema: {
      type: 'object',
      properties: { collectionId: { type: 'string' } },
      required: ['collectionId'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      const c = findCollection(project, args.collectionId)
      return {
        id: c.id,
        name: c.name,
        templatePageId: c.templatePageId,
        fields: (c.fields ?? []).map(fieldView),
        entries: (c.entries ?? []).map(entryView),
      }
    },
  },
  {
    name: 'create_collection',
    description:
      'Create a CMS collection and its template page (a real page bound with :body[name], ' +
      'scaffolded with :h1[title]). `name` is lowercased to a slug and the template CLAIMS the ' +
      '"/<name>" route (entries render at /<name>/<slug>) — so name collections SINGULAR ' +
      '("post", "feature") and keep the plural free for your index page. Fails if a page ' +
      'already owns that route. Starts with one text field, "title". Requires a target.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      const name = String(args.name ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
      if (!name) throw new Error('a name is required')
      if ((project.collections ?? []).some((c) => c.name === name)) {
        throw new Error(`a collection named "${name}" already exists`)
      }
      if ((project.pages ?? []).some((p) => p.path === `/${name}`)) {
        return {
          saved: false,
          reason: 'slug-taken',
          message:
            `a page already owns "/${name}" — the collection template claims that route. ` +
            'Pick another collection name (tip: singular, e.g. "feature" not "features")',
        }
      }
      const label = name.charAt(0).toUpperCase() + name.slice(1)
      const code = buildDocument(
        { name: label, slug: `/${name}`, status: 'published', locale: project.defaultLocale || 'en' },
        ['\t:section', '\t\t:h1[title]:', '\tsection:'],
        name,
      )
      const page = {
        id: randomUUID(),
        name: `${label} template`,
        path: `/${name}`,
        status: 'published',
        code,
        elements: parseSyntax(code),
        collectionId: '',
      }
      const collection = {
        id: randomUUID(),
        name,
        fields: [{ id: randomUUID(), name: 'title', type: 'text' }],
        templatePageId: page.id,
        entries: [],
      }
      page.collectionId = collection.id
      project.pages = project.pages ?? []
      project.collections = project.collections ?? []
      project.pages.push(page)
      project.collections.push(collection)
      await saveTargetProject(project)
      return {
        saved: true,
        collection: {
          id: collection.id,
          name,
          templatePageId: page.id,
          templateSlug: `/${name}`,
          templateVersion: sha256(page.code),
          fields: collection.fields.map(fieldView),
        },
      }
    },
  },
  {
    name: 'upsert_entry',
    description:
      'Create or update a collection entry. Omit entryId to create; pass it to update. `values` ' +
      'maps field NAME → value (string; array for multi-reference) — unknown field names are ' +
      'rejected without saving. For a non-default `locale`, `values` become per-locale overrides ' +
      '(emptied keys are pruned); name/slug are default-locale only. Requires a target.',
    inputSchema: {
      type: 'object',
      properties: {
        collectionId: { type: 'string' },
        entryId: { type: 'string' },
        name: { type: 'string' },
        slug: { type: 'string' },
        values: { type: 'object', additionalProperties: true },
        locale: { type: 'string' },
      },
      required: ['collectionId'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      const c = findCollection(project, args.collectionId)
      const fieldByName = new Map((c.fields ?? []).map((f) => [f.name, f]))
      const values = args.values ?? {}
      const unknown = Object.keys(values).filter((k) => !fieldByName.has(k))
      if (unknown.length) return { saved: false, reason: 'unknown-fields', unknownFields: unknown }

      let entry = args.entryId ? (c.entries ?? []).find((e) => e.id === args.entryId) : null
      if (args.entryId && !entry) throw new Error(`no entry with id "${args.entryId}" in this collection`)
      const creating = !entry
      if (creating) {
        entry = { id: randomUUID(), name: '', slug: '', values: {}, createdAt: Date.now() }
        c.entries = c.entries ?? []
        c.entries.push(entry)
      }

      const isDefaultLocale = !args.locale || args.locale === (project.defaultLocale || 'en')
      if (isDefaultLocale) {
        if (typeof args.name === 'string') entry.name = args.name
        if (typeof args.slug === 'string') {
          const slug = slugify(args.slug)
          if ((c.entries ?? []).some((e) => e !== entry && e.slug === slug)) {
            return { saved: false, reason: 'slug-taken', message: `slug "${slug}" is already used in this collection` }
          }
          entry.slug = slug
        } else if (creating) {
          // derive a unique slug from the name (mirrors addEntry)
          let base = slugify(entry.name || `${c.name}-${c.entries.length}`)
          let slug = base || `${c.name}-${c.entries.length}`
          let i = 1
          while ((c.entries ?? []).some((e) => e !== entry && e.slug === slug)) slug = `${base}-${++i}`
          entry.slug = slug
        }
        for (const [k, v] of Object.entries(values)) {
          const f = fieldByName.get(k)
          if (f.type === 'multi-reference') entry.values[k] = Array.isArray(v) ? v.map(String) : [String(v)]
          else entry.values[k] = String(v)
        }
      } else {
        // per-locale overrides (strings only), pruned when emptied
        const code = args.locale
        entry.locales = entry.locales ?? {}
        const bucket = { ...(entry.locales[code] ?? {}) }
        for (const [k, v] of Object.entries(values)) {
          const s = String(v)
          if (s === '') delete bucket[k]
          else bucket[k] = s
        }
        if (Object.keys(bucket).length) entry.locales[code] = bucket
        else delete entry.locales[code]
        if (entry.locales && !Object.keys(entry.locales).length) delete entry.locales
      }

      await saveTargetProject(project)
      return { saved: true, created: creating, entry: entryView(entry) }
    },
  },
  {
    name: 'delete_entry',
    description: 'Remove an entry from a collection. Requires a target.',
    inputSchema: {
      type: 'object',
      properties: { collectionId: { type: 'string' }, entryId: { type: 'string' } },
      required: ['collectionId', 'entryId'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      const c = findCollection(project, args.collectionId)
      const before = c.entries?.length ?? 0
      c.entries = (c.entries ?? []).filter((e) => e.id !== args.entryId)
      if (c.entries.length === before) return { saved: false, reason: 'not-found' }
      await saveTargetProject(project)
      return { saved: true }
    },
  },
  {
    name: 'update_collection',
    description:
      "Change a collection's schema: `addFields` ([{name, type?, refCollectionId?}] — type is " +
      'text (default) | image | date | reference | multi-reference; reference types need ' +
      'refCollectionId; field names are lowercase kebab-case and become the [name] binding ' +
      'args) and/or `removeFields` (by name — entries keep orphaned values, bindings to the ' +
      'name break). Requires a target.',
    inputSchema: {
      type: 'object',
      properties: {
        collectionId: { type: 'string' },
        addFields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: { type: 'string', enum: ['text', 'image', 'date', 'reference', 'multi-reference'] },
              refCollectionId: { type: 'string' },
            },
            required: ['name'],
            additionalProperties: false,
          },
        },
        removeFields: { type: 'array', items: { type: 'string' } },
      },
      required: ['collectionId'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      const c = findCollection(project, args.collectionId)
      const errors = []
      for (const f of args.addFields ?? []) {
        const name = String(f.name ?? '')
        if (!/^[a-z][a-z0-9-]*$/.test(name)) {
          errors.push(`field "${name}": names are lowercase kebab-case ([a-z][a-z0-9-]*)`)
          continue
        }
        if ((c.fields ?? []).some((x) => x.name === name)) {
          errors.push(`field "${name}" already exists`)
          continue
        }
        const type = f.type ?? 'text'
        if ((type === 'reference' || type === 'multi-reference')) {
          if (!f.refCollectionId || !(project.collections ?? []).some((x) => x.id === f.refCollectionId)) {
            errors.push(`field "${name}": ${type} needs a refCollectionId of an existing collection`)
            continue
          }
        }
        c.fields = c.fields ?? []
        c.fields.push({
          id: randomUUID(),
          name,
          type,
          ...(f.refCollectionId ? { refCollectionId: f.refCollectionId } : {}),
        })
      }
      for (const name of args.removeFields ?? []) {
        const before = c.fields?.length ?? 0
        c.fields = (c.fields ?? []).filter((f) => f.name !== name)
        if (c.fields.length === before) errors.push(`no field named "${name}" to remove`)
      }
      await saveTargetProject(project)
      return {
        saved: true,
        fields: (c.fields ?? []).map(fieldView),
        ...(errors.length ? { errors } : {}),
      }
    },
  },
  {
    name: 'delete_collection',
    description:
      'Delete a collection AND its template page. Its entries are gone; :collection-list[name] ' +
      'blocks referencing it become validation errors on the next structural edit. Requires a target.',
    inputSchema: {
      type: 'object',
      properties: { collectionId: { type: 'string' } },
      required: ['collectionId'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      const c = findCollection(project, args.collectionId)
      project.pages = (project.pages ?? []).filter((p) => p.id !== c.templatePageId)
      project.collections = (project.collections ?? []).filter((x) => x.id !== c.id)
      await saveTargetProject(project)
      return { saved: true, deleted: c.name }
    },
  },
  {
    name: 'list_comments',
    description:
      'Comments on the target project (shared across drafts; never merged). Each has id, pageId, ' +
      'author, text, resolved, and replies. Requires a target.',
    inputSchema: {
      type: 'object',
      properties: { includeResolved: { type: 'boolean', description: 'default true' } },
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      let comments = project.comments ?? []
      if (args.includeResolved === false) comments = comments.filter((c) => !c.resolved)
      return {
        comments: comments.map((c) => ({
          id: c.id,
          pageId: c.pageId,
          author: c.author,
          text: c.text,
          resolved: c.resolved,
          createdAt: c.createdAt,
          replies: (c.replies ?? []).map((r) => ({ id: r.id, author: r.author, text: r.text, createdAt: r.createdAt })),
        })),
      }
    },
  },
  {
    name: 'reply_to_comment',
    description:
      'Add a reply to a comment thread, authored as the authenticated token owner. Requires a target.',
    inputSchema: {
      type: 'object',
      properties: { commentId: { type: 'string' }, text: { type: 'string' } },
      required: ['commentId', 'text'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const { project } = await loadTargetProject()
      const comment = (project.comments ?? []).find((c) => c.id === args.commentId)
      if (!comment) throw new Error(`no comment with id "${args.commentId}"`)
      const text = String(args.text ?? '').trim()
      if (!text) throw new Error('reply text is required')
      const user = await whoami()
      const reply = { id: randomUUID(), text, author: user.name || user.email, createdAt: Date.now() }
      comment.replies = comment.replies ?? []
      comment.replies.push(reply)
      await saveTargetProject(project)
      return { saved: true, commentId: comment.id, reply }
    },
  },
  {
    name: 'list_media',
    description:
      'The media library: assets (id, name, kind, mime, size, url to use as an element `src`/' +
      '`background`) and folders. Library-wide, not per-target.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      if (!mediaIndex) throw new Error('media is not supported by this connection')
      const { assets, folders } = await mediaIndex()
      return {
        assets: (assets ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
          mime: a.mime,
          size: a.size,
          url: `/media/${a.id}`,
          ...(a.folderId ? { folderId: a.folderId } : {}),
        })),
        folders: (folders ?? []).map((f) => ({ id: f.id, name: f.name })),
      }
    },
  },
  {
    name: 'upload_media',
    description:
      'Upload an asset to the media library from a base64 data URL (data:<mime>;base64,…). ' +
      'The server enforces the same mime allowlist, size caps and quota as browser uploads ' +
      '(images/video/audio/pdf/fonts; no html/js). Returns the asset and its /media/… url — ' +
      'use that as an element `src` or `background`. Library-wide, not per-target.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'display name, e.g. "editor-screenshot.png"' },
        dataUrl: { type: 'string', description: 'data:<mime>;base64,<payload>' },
        folderId: { type: 'string' },
      },
      required: ['name', 'dataUrl'],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (!mediaUpload) throw new Error('media is not supported by this connection')
      const m = String(args.dataUrl ?? '').match(/^data:([a-z0-9.+/-]+);base64,(.+)$/is)
      if (!m) throw new Error('dataUrl must be a base64 data URL: data:<mime>;base64,…')
      const bytes = Buffer.from(m[2], 'base64')
      if (!bytes.length) throw new Error('dataUrl payload is empty or not valid base64')
      const asset = await mediaUpload({
        name: String(args.name ?? '').trim() || 'untitled',
        folderId: args.folderId,
        mime: m[1].toLowerCase(),
        bytes,
      })
      return {
        saved: true,
        asset: { id: asset.id, name: asset.name, kind: asset.kind, mime: asset.mime, size: asset.size },
        url: `/media/${asset.id}`,
      }
    },
  },
  {
    name: 'publish',
    description:
      'Publish the CURRENT TARGET as the live static site (server export). Editor+ only ' +
      '(enforced server-side). Returns export stats. Note: this publishes the target you chose — ' +
      'publishing a draft bypasses the merge-into-Main flow. Requires a target.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const { project } = await loadTargetProject()
      const stats = await publish(project)
      return { published: true, target, stats }
    },
  },
]

  const toolMap = new Map(tools.map((t) => [t.name, t]))

  return {
    tools,
    toolMap,
    getTarget: () => target,
    setTarget: (t) => {
      target = t
    },
  }
}
