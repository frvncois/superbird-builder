import { computed, ref } from 'vue'
import { useProject } from './useProject'
import { usePage } from './usePage'
import type { Comment, CommentAnchor } from '@/types/editor'

export type CommentVisibility = 'all' | 'pending' | 'resolved' | 'none'

const visibility = ref<CommentVisibility>('all')

/** whether comment pins render on the canvas (off by default) */
const displayOnCanvas = ref(false)

/** comment-drop tool: while on, the canvas shows a crosshair and a click
 * anchors a new comment. A toggle (press C on/off), not a momentary hold. */
const commentMode = ref(false)

// dummy current user until auth/the API is wired in
export const CURRENT_USER = 'You'

/** comment whose thread popover is open on the canvas */
const activeCommentId = ref<string | null>(null)

/** bumped when the canvas should pan to the active comment */
const focusTick = ref(0)

export function useComments() {
  const { project } = useProject()
  const { setActivePage } = usePage()

  const comments = computed(() => project.value.comments)

  const activeComment = computed(
    () => comments.value.find((c) => c.id === activeCommentId.value) ?? null,
  )

  function matchesVisibility(comment: Comment): boolean {
    switch (visibility.value) {
      case 'all':
        return true
      case 'pending':
        return !comment.resolved
      case 'resolved':
        return comment.resolved
      case 'none':
        return false
    }
  }

  /** comments to pin on the canvas for a page, honouring the Show filter */
  function visibleComments(pageId: string): Comment[] {
    if (!displayOnCanvas.value) return []
    return comments.value.filter((c) => c.pageId === pageId && matchesVisibility(c))
  }

  /** every comment across all pages, honouring the Show filter (newest first) */
  const filteredComments = computed(() =>
    comments.value.filter(matchesVisibility).slice().sort((a, b) => b.createdAt - a.createdAt),
  )

  function addComment(at: {
    pageId: string
    anchor?: CommentAnchor
    breakpointId?: string | null
    x?: number
    y?: number
  }): Comment {
    const comment: Comment = {
      id: crypto.randomUUID(),
      ...at,
      text: '',
      author: CURRENT_USER,
      resolved: false,
      createdAt: Date.now(),
      replies: [],
    }
    project.value.comments.push(comment)
    displayOnCanvas.value = true // adding a comment reveals the pins
    // the tool stays armed (like Figma) so you can drop several in a row —
    // press C again or Esc to leave. The new pin's thread opens for typing.
    activeCommentId.value = comment.id
    return comment
  }

  function removeComment(id: string) {
    project.value.comments = project.value.comments.filter((c) => c.id !== id)
    if (activeCommentId.value === id) activeCommentId.value = null
  }

  function toggleResolved(id: string) {
    const comment = comments.value.find((c) => c.id === id)
    if (comment) comment.resolved = !comment.resolved
  }

  function reply(id: string, text: string) {
    const comment = comments.value.find((c) => c.id === id)
    if (comment && text.trim()) {
      comment.replies.push({
        id: crypto.randomUUID(),
        text: text.trim(),
        author: CURRENT_USER,
        createdAt: Date.now(),
      })
    }
  }

  function openComment(id: string | null) {
    activeCommentId.value = id
  }

  /** navigate to a comment: switch to its page and ask the canvas to pan to it */
  function goToComment(id: string) {
    const comment = comments.value.find((c) => c.id === id)
    if (!comment) return
    setActivePage(comment.pageId)
    activeCommentId.value = id
    focusTick.value++
  }

  const toggleCommentMode = () => {
    commentMode.value = !commentMode.value
    if (commentMode.value) displayOnCanvas.value = true // show existing pins too
  }
  const exitCommentMode = () => (commentMode.value = false)

  return {
    comments,
    visibility,
    displayOnCanvas,
    commentMode,
    activeCommentId,
    activeComment,
    focusTick,
    visibleComments,
    filteredComments,
    addComment,
    removeComment,
    toggleResolved,
    reply,
    openComment,
    goToComment,
    toggleCommentMode,
    exitCommentMode,
  }
}
