<script setup lang="ts">
// The full-site live preview used inside the editor shell's Preview mode:
// the site rendered as one navigable full-width column (no breakpoint frames).
// Double-click text/media to edit in place; hold C and click to drop a comment.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PreviewRenderer from '@/components/site/PreviewRenderer.vue'
import CommentLayer from '@/components/site/CommentLayer.vue'
import EntryScope from '@/components/shared/EntryScope.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { PenLine } from 'lucide-vue-next'
import { usePage } from '@/composables/usePage'
import { useCollections } from '@/composables/useCollections'
import { useProject } from '@/composables/useProject'
import { useThemeTokens } from '@/composables/useThemeTokens'
import { usePreviewEditing } from '@/composables/usePreviewEditing'
import { useComments } from '@/composables/useComments'
import { useCommentMode } from '@/composables/useCommentMode'
import { anchorFromPoint } from '@/lib/commentAnchor'
import { useAnimation } from '@/composables/useAnimation'
import { useMotion } from '@/composables/useMotion'
import { walkNodes } from '@/lib/tree'

// runtime Tailwind so class strings typed in the editor compile in the preview
void import('@tailwindcss/browser')

const { activePage } = usePage()
const { collections, activeCollection, activeEntry } = useCollections()
const { project } = useProject()
const { menu, closeMenu, requestEdit } = usePreviewEditing()
const { addComment, activeComment, focusTick } = useComments()

// C toggles the comment-drop tool (Esc exits); click drops a comment pinned
// to the element under the cursor
const { commentMode } = useCommentMode()
const mainEl = ref<HTMLElement>()
// `main` is overflow-hidden (fixed-child containment); this inner wrapper is
// what actually scrolls, so scrub progress measures against it
const scrollEl = ref<HTMLElement>()

function onPreviewClick(e: MouseEvent) {
  if (!commentMode.value || !mainEl.value) return
  const anchor = anchorFromPoint(e.clientX, e.clientY, mainEl.value)
  if (!anchor) return
  e.preventDefault()
  e.stopPropagation() // capture-phase: beat the renderer's navigate/edit click
  addComment({ pageId: activePage.value.id, anchor })
}

// --- scroll-driven (scrub) animations ---
// Preview is the only editor surface with a real scroll container (the canvas
// frames don't scroll), so this is where scrub bindings can be previewed for
// real. The published site does the same thing against the window.
const { animationFor } = useAnimation()
const motion = useMotion()

/** every scrub binding on the page, with the node its animation moves.
 * ownerId is the node the binding LIVES on — progress is measured against the
 * owner's viewport position (it is the scroll trigger), exactly like the
 * published runtime; targetId is only where the values land. Measuring the
 * target instead diverges as soon as targetId points elsewhere (a marker
 * driving a pinned stage). */
const scrubBindings = computed(() => {
  const list: {
    ownerId: string
    targetId: string
    binding: import('@/types/editor').AnimationBinding
  }[] = []
  walkNodes(activePage.value.elements, (node) => {
    for (const binding of node.animations ?? []) {
      if (binding.trigger === 'scrub') {
        list.push({ ownerId: node.id, targetId: binding.targetId ?? node.id, binding })
      }
    }
  })
  return list
})

let scrubFrame: number | null = null
function updateScrub() {
  scrubFrame = null
  const root = scrollEl.value
  if (!root || !scrubBindings.value.length) return
  const vh = root.clientHeight
  for (const { ownerId, targetId, binding } of scrubBindings.value) {
    const animation = animationFor(binding.animationId)
    if (!animation) continue
    const el = root.querySelector(`[data-node-id="${ownerId}"]`)
    if (!el) continue
    // top relative to the scroll container, so progress matches what the
    // viewer sees rather than the document
    const top = el.getBoundingClientRect().top - root.getBoundingClientRect().top
    motion.scrubTo(binding, animation, targetId, motion.scrubProgressFor(binding, top, vh))
  }
}
function onScroll() {
  if (scrubFrame === null) scrubFrame = requestAnimationFrame(updateScrub)
}
onMounted(() => {
  scrollEl.value?.addEventListener('scroll', onScroll, { passive: true })
  void nextTick(updateScrub)
})
onBeforeUnmount(() => {
  scrollEl.value?.removeEventListener('scroll', onScroll)
  if (scrubFrame !== null) cancelAnimationFrame(scrubFrame)
})
// a page switch re-seats every scrub binding at its scroll position
watch(() => activePage.value.id, () => void nextTick(updateScrub))

// clicking a comment in the list scrolls the preview to its anchored element
watch(focusTick, async () => {
  await nextTick()
  const anchor = activeComment.value?.anchor
  if (!anchor || !mainEl.value) return
  mainEl.value
    .querySelector(`[data-node-id="${anchor.nodeId}"]`)
    ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
})

// design tokens + Google Fonts for the preview
useThemeTokens()

const templateCollection = computed(() =>
  activePage.value.collectionId
    ? (collections.value.find((c) => c.id === activePage.value.collectionId) ?? null)
    : null,
)

const fontStyle = computed(() => ({
  fontFamily: project.value.settings.fonts.family || undefined,
}))
</script>

<template>
  <div class="relative h-full">
    <!-- This pane IS the site's viewport, and it has to behave like one on two
         axes:
         · `isolate` traps the site in its own stacking context, so a user
           element's z-index (even a fixed one at z-100000000) can never paint
           over the editor chrome (pages drawer, rail, sidebar).
         · `contain-paint` makes it the containing block for `position: fixed`
           descendants, so a fixed header/nav/cookie bar spans THIS pane rather
           than the browser window — otherwise it slid under the left rail and
           over the right sidebar.
         The containment must sit on a NON-scrolling element with the scrolling
         moved to the wrapper below: put both on one element and fixed children
         are confined but scroll away with the content, which is worse than the
         original bug (a "fixed" header would visibly scroll off). -->
    <main
      ref="mainEl"
      data-site-scope
      class="isolate h-full overflow-hidden contain-paint bg-white font-sans text-black select-text"
      :class="commentMode && 'cursor-crosshair'"
      :style="fontStyle"
      @click.capture="onPreviewClick"
    >
      <div ref="scrollEl" class="h-full overflow-auto">
        <div class="flex min-h-full flex-col">
          <EntryScope
            v-if="activeEntry && activeCollection"
            :collection="activeCollection"
            :entry="activeEntry"
          >
            <PreviewRenderer v-for="node in activePage.elements" :key="node.id" :node="node" />
          </EntryScope>
          <EntryScope v-else-if="templateCollection" :collection="templateCollection" :entry="null">
            <PreviewRenderer v-for="node in activePage.elements" :key="node.id" :node="node" />
          </EntryScope>
          <template v-else>
            <PreviewRenderer v-for="node in activePage.elements" :key="node.id" :node="node" />
          </template>
        </div>
      </div>
    </main>

    <!-- floating comment pins over the preview -->
    <CommentLayer :root="mainEl ?? null" />

    <!-- "Edit content" context menu -->
    <template v-if="menu">
      <div class="fixed inset-0 z-[90]" @click="closeMenu" @contextmenu.prevent="closeMenu" />
      <div
        class="fixed z-[91] min-w-36 rounded-xl border border-input bg-background p-1 shadow-lg"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      >
        <ButtonUI
          variant="ghost"
          size="sm"
          :icon="PenLine"
          class="w-full justify-start"
          @click="requestEdit(menu.nodeId)"
        >
          Edit content
        </ButtonUI>
      </div>
    </template>
  </div>
</template>
