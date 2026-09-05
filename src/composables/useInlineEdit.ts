import { nextTick, ref, type Ref } from 'vue'
import { sanitizeRich } from '@/lib/shared/richtext.js'

/**
 * Inline plaintext editing on a canvas element, shared by the build-mode
 * ElementRenderer (double-click, Esc cancels) and the Preview-mode
 * PreviewRenderer (double-click, Esc saves). While editing, a dedicated span is
 * mounted that Vue renders EMPTY — its text is managed only by us — so Vue's
 * fragment anchors for the interpolation and child renderers survive.
 */
export function useInlineEdit(opts: {
  /** whether this element can be text-edited right now */
  editable: Ref<boolean>
  /** the text the editor opens with */
  initialText: () => string
  /** persist the edited text */
  commit: (text: string) => void
  /** rich mode: the span edits sanitized HTML instead of plain text —
   * the host must render contenteditable="true" (not plaintext-only) */
  rich?: Ref<boolean>
  /** what Esc does — 'cancel' discards, 'save' commits (default 'cancel') */
  escBehavior?: 'cancel' | 'save'
  /** called after a keyboard exit (Enter/Esc), e.g. to return focus to the editor */
  onExit?: () => void
}) {
  const editing = ref(false)
  const editEl = ref<HTMLElement>()
  let editStart = ''

  function startEditing(e?: Event) {
    if (!opts.editable.value || editing.value) return
    e?.stopPropagation()
    e?.preventDefault()
    editing.value = true
    const initial = opts.initialText()
    nextTick(() => {
      const target = editEl.value
      if (!target) return
      if (opts.rich?.value) target.innerHTML = sanitizeRich(initial)
      else target.textContent = initial
      editStart = initial
      target.focus()
      const range = document.createRange()
      range.selectNodeContents(target)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
  }

  function finishEditing(cancel: boolean) {
    if (!editing.value) return
    const text = opts.rich?.value
      ? sanitizeRich(editEl.value?.innerHTML ?? '')
      : (editEl.value?.textContent ?? '')
    editing.value = false // unmounts the span (and our manual text with it)
    if (cancel || text === editStart) return
    opts.commit(text)
  }

  function onEditKeydown(e: KeyboardEvent) {
    // keep editor-wide shortcuts (undo, panels, Esc handlers) out of the session
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      finishEditing(false)
      opts.onExit?.()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      finishEditing(opts.escBehavior !== 'save')
      opts.onExit?.()
    }
  }

  return { editing, editEl, startEditing, finishEditing, onEditKeydown }
}
