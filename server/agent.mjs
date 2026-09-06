// In-editor AI assistant: POST /api/agent runs a Claude agentic loop over the
// SAME tool registry the `guano mcp` stdio server uses (packages/guano/mcp/
// tools.mjs) — one tool implementation, two surfaces. The browser chat pane
// streams progress back as SSE events while the loop edits the project through
// an in-server adapter (store access + publish provided by index.mjs).
//
// Zero npm deps by design: the Anthropic Messages API is called with plain
// fetch (node ≥18 global). The API key is server-managed config (agent.json in
// the data dir, like publish.json for the GitHub token) — never in the project
// blob, never echoed back to the client; GUANO_ANTHROPIC_KEY overrides for
// deploys, GUANO_ANTHROPIC_BASE exists for tests/proxies.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_DIR, fail, send, writeAtomic } from './util.mjs'

const AGENT_CONFIG = join(DATA_DIR, 'agent.json')
const DEFAULT_MODEL = 'claude-opus-4-8'
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_ITERATIONS = 30 // agentic-loop runaway backstop
const MAX_BODY = 1024 * 1024 // chat request cap (conversation text only)

// ---------- config (server-managed; key is write-only) ----------

/** agent config with env overrides. Always well-formed. */
export async function readAgentConfig() {
  let stored = {}
  try {
    stored = JSON.parse(await readFile(AGENT_CONFIG, 'utf8'))
  } catch {
    // no config yet
  }
  return {
    key: process.env.GUANO_ANTHROPIC_KEY || stored?.anthropic?.key || '',
    keyFromEnv: !!process.env.GUANO_ANTHROPIC_KEY,
    model: process.env.GUANO_ANTHROPIC_MODEL || stored?.model || DEFAULT_MODEL,
    base: process.env.GUANO_ANTHROPIC_BASE || 'https://api.anthropic.com',
  }
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** GET/PUT /api/agent-config — mirror of publish-config: the key is stored
 * server-side and NEVER echoed; GET only reports whether one is set. */
export async function handleAgentConfig(req, res, user) {
  if (!user) return fail(res, 401, 'unauthorized')
  if (user.role === 'contributor') return fail(res, 403, 'forbidden')

  if (req.method === 'GET') {
    const cfg = await readAgentConfig()
    return send(
      res,
      200,
      JSON.stringify({ anthropic: { keySet: !!cfg.key, keyFromEnv: cfg.keyFromEnv }, model: cfg.model }),
    )
  }
  if (req.method === 'PUT') {
    const body = await readBody(req)
    let patch
    try {
      patch = JSON.parse(body ?? '')
    } catch {
      return fail(res, 400, 'invalid request')
    }
    let stored = {}
    try {
      stored = JSON.parse(await readFile(AGENT_CONFIG, 'utf8'))
    } catch {
      // first write
    }
    if (patch?.anthropic && 'key' in patch.anthropic) {
      stored.anthropic = { key: String(patch.anthropic.key ?? '').trim() } // '' clears
    }
    if ('model' in patch) {
      const m = String(patch.model ?? '').trim()
      if (m) stored.model = m
      else delete stored.model
    }
    await writeAtomic(AGENT_CONFIG, JSON.stringify(stored))
    const cfg = await readAgentConfig()
    return send(
      res,
      200,
      JSON.stringify({ ok: true, anthropic: { keySet: !!cfg.key, keyFromEnv: cfg.keyFromEnv }, model: cfg.model }),
    )
  }
  return fail(res, 404, 'not found')
}

// ---------- shared tool registry + bundled editor runtime ----------

// The layouts differ between the repo (packages/guano/…) and the packed npm
// package (mcp/ + runtime/ as siblings of server/) — probe both.
const HERE = fileURLToPath(new URL('.', import.meta.url))
const CANDIDATES = {
  tools: ['../packages/guano/mcp/tools.mjs', '../mcp/tools.mjs'],
  runtime: ['../packages/guano/runtime/mcp-runtime.mjs', '../runtime/mcp-runtime.mjs'],
}

let modules = null
async function loadModules() {
  if (modules) return modules
  const resolve = async (paths, label) => {
    for (const p of paths) {
      try {
        return await import(new URL(p, import.meta.url).href)
      } catch (e) {
        if (e?.code !== 'ERR_MODULE_NOT_FOUND') throw e // real error inside the module
      }
    }
    throw new Error(
      `${label} module not found near ${HERE} — build it with \`npm run build:mcp-runtime\``,
    )
  }
  const [tools, runtime] = await Promise.all([
    resolve(CANDIDATES.tools, 'mcp tools'),
    resolve(CANDIDATES.runtime, 'mcp runtime bundle'),
  ])
  modules = { createToolSet: tools.createToolSet, runtime }
  return modules
}

// ---------- the agentic loop ----------

/** compact tool-input view for progress events — big strings (page code) are
 * truncated so the SSE stream stays light */
function summarizeInput(input) {
  const out = {}
  for (const [k, v] of Object.entries(input ?? {})) {
    out[k] = typeof v === 'string' && v.length > 120 ? v.slice(0, 120) + '…' : v
  }
  return out
}

function systemPrompt(project, target) {
  const pages = (project?.pages ?? [])
    .map((p) => `- ${p.name} (id: ${p.id}, slug: ${p.path}, status: ${p.status})`)
    .join('\n')
  return `You are the built-in assistant of Guano, a visual website builder. You edit the user's website through tools. The human is watching the editor — their canvas refreshes with your changes when you finish.

Current project: "${project?.name ?? 'Untitled'}". Your writes go to the target "${target}" (already selected — never ask about targets).

Pages:
${pages || '(none)'}

The page structure language (DSL): indentation-based, one element token per line, tabs for nesting. A page document is an @setup block (name/slug/status/locale) then :body … body:. Leaf elements are written :h1: / :paragraph: / :image: / :span: / :button: / :link: / :input: / :list-item:; containers open :section … section: (also div, container, grid, header, footer, nav, main, aside, article, form, list). Capitalized tokens like :Card … Card: are component instances. [name] in the arg slot binds a collection field (:h1[title]:); :collection-list[posts] … collection-list: repeats children per entry. Markers like (+) and {+} are display-only — never type them yourself; they are maintained automatically.

Working rules:
- get_page before any edit; pass its \`version\` to every write. On stale-version, re-read and retry once.
- Structure (adding/removing/moving elements) = set_page_code with the FULL document. Keep unchanged lines byte-identical — styling and content live on elements matched by line, and gratuitous rewrites lose nothing but churn the diff.
- Styling, text content, media src, html ids = edit_elements, BATCHED: one call with an edits[] entry per element, not one call per element. Classes are validated like the Style panel (invalid ones come back as per-edit errors). Existing text is the user's content — do not rewrite it unless asked.
- Animations = create_interaction + bind_interaction (trigger: hover | click | appear).
- CMS content = the collection tools. Publishing = publish (only when explicitly asked).
- If a tool refuses (component-instance, invalid classes, diagnostics), adjust and retry rather than repeating the same call.
- Be concise in chat: say what you changed, not a tool-by-tool narration.`
}

async function callAnthropic(cfg, payload) {
  let res
  try {
    res = await fetch(`${cfg.base}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': cfg.key,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } catch (e) {
    throw new Error(`cannot reach the Anthropic API (${e.message})`)
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.error?.message ?? `Anthropic API error (${res.status})`)
  }
  return res.json()
}

/**
 * POST /api/agent — body { messages: [{role:'user'|'assistant', content:string}],
 * target: 'main' | '<branchId>' }. Streams SSE events:
 *   {type:'text', text}            assistant prose (per API turn)
 *   {type:'tool', name, input}     a tool is being executed (input summarized)
 *   {type:'done'}                  loop finished cleanly
 *   {type:'error', message}        loop aborted
 * `api` is the in-server adapter built by index.mjs (store + whoami + publish).
 */
export async function handleAgent(req, res, user, api) {
  if (!user) return fail(res, 401, 'unauthorized')
  if (user.role === 'contributor') return fail(res, 403, 'forbidden')

  const cfg = await readAgentConfig()
  if (!cfg.key) {
    return fail(res, 400, 'no Anthropic API key configured — set one in Settings → Access')
  }

  const body = await readBody(req)
  let messages, target
  try {
    ;({ messages, target } = JSON.parse(body ?? ''))
    if (!Array.isArray(messages) || !messages.length) throw new Error('no messages')
    if (typeof target !== 'string' || !target) throw new Error('no target')
  } catch {
    return fail(res, 400, 'invalid request')
  }

  let toolSet, runtime
  try {
    const mods = await loadModules()
    runtime = mods.runtime
    toolSet = mods.createToolSet({ api, runtime })
  } catch (e) {
    console.error(e)
    return fail(res, 500, e.message)
  }

  // the human picked the target in the UI — preset it and drop set_target so
  // the model can't silently switch where writes go mid-conversation
  const projectRaw = await api.storeGetRaw(`guano-project:${target}`)
  if (projectRaw === null) return fail(res, 400, `unknown target "${target}"`)
  toolSet.setTarget(target)
  const tools = toolSet.tools.filter((t) => t.name !== 'set_target')
  const toolMap = new Map(tools.map((t) => [t.name, t]))

  // SSE from here on — errors become stream events, not HTTP statuses
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  const emit = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
  let clientGone = false
  req.on('close', () => (clientGone = true))

  const apiMessages = messages.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content ?? ''),
  }))

  const payloadBase = {
    model: cfg.model,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: systemPrompt(JSON.parse(projectRaw), target),
    tools: tools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      input_schema: inputSchema,
    })),
  }

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await callAnthropic(cfg, { ...payloadBase, messages: apiMessages })

      const toolUses = []
      for (const block of response.content) {
        if (block.type === 'text' && block.text) emit({ type: 'text', text: block.text })
        if (block.type === 'tool_use') toolUses.push(block)
      }

      if (response.stop_reason !== 'tool_use' || !toolUses.length) {
        emit({ type: 'done' })
        return res.end()
      }

      // append the FULL assistant content (incl. thinking blocks — required
      // for multi-turn coherence), then all tool results in ONE user message
      apiMessages.push({ role: 'assistant', content: response.content })
      const results = []
      for (const use of toolUses) {
        if (clientGone) return res.end() // user closed the chat — stop burning tokens
        emit({ type: 'tool', name: use.name, input: summarizeInput(use.input) })
        const tool = toolMap.get(use.name)
        try {
          if (!tool) throw new Error(`unknown tool: ${use.name}`)
          const result = await tool.handler(use.input ?? {})
          results.push({
            type: 'tool_result',
            tool_use_id: use.id,
            content: JSON.stringify(result),
          })
        } catch (e) {
          results.push({
            type: 'tool_result',
            tool_use_id: use.id,
            content: e?.message ?? String(e),
            is_error: true,
          })
        }
      }
      apiMessages.push({ role: 'user', content: results })
    }
    emit({ type: 'error', message: `stopped after ${MAX_ITERATIONS} tool rounds — ask me to continue` })
    res.end()
  } catch (e) {
    console.error('agent loop:', e)
    emit({ type: 'error', message: e?.message ?? 'agent failed' })
    res.end()
  }
}
