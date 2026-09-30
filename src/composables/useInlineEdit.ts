import { nextTick, ref, type Ref } from 'vue'
import { sanitizeRich } from '@/lib/shared/richtext.js'

/**
 * Inline plaintext editing on a canvas element: double-click to edit, Enter to
 * commit, Esc to discard. The Build canvas (`ElementRenderer`) is the only
 * caller — Play renders the site read-only and has no editing gesture of its
 * own. While editing, a dedicated span is mounted that Vue renders EMPTY — its
 * text is managed only by us — so Vue's fragment anchors for the interpolation
 * and child renderers survive.
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
      // Typing a space inside a <button> or a <summary> "clicks" it on keyup —
      // the browser's keyboard activation — and that click ends the edit
      // mid-word. The listener dies with the span, which is unmounted on exit.
      target.addEventListener('keyup', (event) => {
        if (event.key === ' ') event.preventDefault()
      })
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
      finishEditing(true) // Esc discards, like Escape everywhere else in the editor
      opts.onExit?.()
    }
  }

  return { editing, editEl, startEditing, finishEditing, onEditKeydown }
}
