import { ref } from 'vue'
import {
  usePersistence,
  activeBranchId,
  autosaveSuspended,
  projectStorageKey,
} from './usePersistence'
import { flushStore, rehydrateStore } from '@/lib/store'
import { readStoredProject } from '@/lib/storage'

// The in-editor AI assistant. send() runs one agent turn against POST
// /api/agent (an SSE stream of text/tool events) with the CURRENT branch as
// the write target. Lock+refresh concurrency: pending human edits are flushed
// first, autosave is suspended for the duration (latest-wins store — a
// debounced save of the stale in-memory project would clobber the agent), and
// on completion the project is re-read from the server and swapped in via
// resetTo, so the canvas shows the agent's work immediately. Undo history
// resets on refresh (same trade-off as a branch switch).

export type AgentChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; label: string }
  | { kind: 'error'; text: string }

/** friendly progress labels for tool activity rows */
const TOOL_LABELS: Record<string, string> = {
  get_status: 'Checking the project',
  list_pages: 'Reading the page list',
  get_page: 'Reading a page',
  set_page_code: 'Editing page structure',
  get_styles: 'Reading element styles',
  set_element_classes: 'Styling an element',
  list_interactions: 'Reading animations',
  create_interaction: 'Creating an animation',
  bind_interaction: 'Applying an animation',
  unbind_interaction: 'Removing an animation',
  list_collections: 'Reading collections',
  get_collection: 'Reading a collection',
  create_collection: 'Creating a collection',
  upsert_entry: 'Writing a collection entry',
  delete_entry: 'Deleting a collection entry',
  list_comments: 'Reading comments',
  reply_to_comment: 'Replying to a comment',
  publish: 'Publishing the site',
}

// module singletons — chat survives pane toggles, cleared on reload
const leftPane = ref<'code' | 'assistant'>('code')
const items = ref<AgentChatItem[]>([])
const busy = ref(false)
/** null = unknown (not fetched), false = no key configured */
const configured = ref<boolean | null>(null)

async function checkConfigured() {
  try {
    const res = await fetch('/api/agent-config')
    configured.value = res.ok ? !!(await res.json()).anthropic?.keySet : false
  } catch {
    configured.value = false
  }
}

export function useAgent() {
  const { saveNow, resetTo } = usePersistence()

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busy.value) return
    items.value.push({ kind: 'user', text: trimmed })
    busy.value = true

    // flush human edits so the agent reads the current state (saveNow only
    // ENQUEUES the write — await the actual server ack), then freeze autosave
    // for the run (see the module comment)
    saveNow()
    await flushStore()
    autosaveSuspended.value = true

    // the conversation the model sees: user/assistant text only
    const messages = items.value
      .filter((i): i is Extract<AgentChatItem, { kind: 'user' | 'assistant' }> =>
        i.kind === 'user' || i.kind === 'assistant',
      )
      .map((i) => ({ role: i.kind, content: i.text }))

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages, target: activeBranchId.value }),
      })
      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => null)
        throw new Error(detail?.error ?? `request failed (${res.status})`)
      }

      // consume the SSE stream incrementally so activity shows live
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl
        while ((nl = buffer.indexOf('\n\n')) !== -1) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 2)
          if (!line.startsWith('data: ')) continue
          const event = JSON.parse(line.slice(6))
          if (event.type === 'text') items.value.push({ kind: 'assistant', text: event.text })
          else if (event.type === 'tool')
            items.value.push({ kind: 'tool', name: event.name, label: TOOL_LABELS[event.name] ?? event.name })
          else if (event.type === 'error') items.value.push({ kind: 'error', text: event.message })
        }
      }
    } catch (e) {
      items.value.push({ kind: 'error', text: e instanceof Error ? e.message : 'The assistant failed' })
    } finally {
      // pull the agent's writes into the editor: re-read the branch blob and
      // swap it in (fresh undo history, like a branch switch)
      try {
        const key = projectStorageKey(activeBranchId.value)
        await rehydrateStore([key]) // force past the hydrated-keys cache
        const stored = readStoredProject(key)
        if (stored) resetTo(stored)
      } catch {
        // refresh failed — the next reload will converge; don't lose the chat
      }
      autosaveSuspended.value = false
      busy.value = false
    }
  }

  function clear() {
    if (!busy.value) items.value = []
  }

  return { leftPane, items, busy, configured, checkConfigured, send, clear }
}
