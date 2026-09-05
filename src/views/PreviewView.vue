<script setup lang="ts">
// Content-editor mode: the site rendered as a live, navigable preview (no
// breakpoint frames, no side panels). Cmd+Click text/media to edit in place.
// Same admin zone + project singleton as the editor, so autosave keeps
// running and switching views lands on the same page.
import { computed, nextTick, ref, watch } from 'vue'
import AppHeader from '@/components/shared/AppHeader.vue'
import ContentRenderer from '@/components/site/ContentRenderer.vue'
import CommentLayer from '@/components/site/CommentLayer.vue'
import MediaLibraryModal from '@/components/shared/MediaLibraryModal.vue'
import EntryScope from '@/components/shared/EntryScope.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { PenLine } from 'lucide-vue-next'
import { useEditorBoot } from '@/composables/useEditorBoot'
import { useContentShortcuts } from '@/composables/useContentShortcuts'
import { usePage } from '@/composables/usePage'
import { useCollections } from '@/composables/useCollections'
import { useProject } from '@/composables/useProject'
import { useThemeTokens } from '@/composables/useThemeTokens'
import { useContentEditing } from '@/composables/useContentEditing'
import { useComments } from '@/composables/useComments'
import { useCommentMode } from '@/composables/useCommentMode'
import { useMediaLibrary } from '@/composables/useMediaLibrary'
import { anchorFromPoint } from '@/lib/commentAnchor'

// runtime Tailwind so class strings typed in the editor compile in the preview
void import('@tailwindcss/browser')

// undo/redo + save (⌘Z / ⌘⇧Z / ⌘S); skips the inline text editor
useContentShortcuts()

const { ready, bootError, reloadPage } = useEditorBoot()
const { activePage } = usePage()
const { collections, activeCollection, activeEntry } = useCollections()
const { project } = useProject()
const { menu, closeMenu, requestEdit } = useContentEditing()
const { addComment, activeComment, focusTick } = useComments()
const { open: mediaOpen, close: closeMediaLibrary } = useMediaLibrary()

// C toggles the comment-drop tool (Esc exits); click drops a comment pinned
// to the element under the cursor
const { commentMode } = useCommentMode()
const mainEl = ref<HTMLElement>()

function onPreviewClick(e: MouseEvent) {
  if (!commentMode.value || !mainEl.value) return
  const anchor = anchorFromPoint(e.clientX, e.clientY, mainEl.value)
  if (!anchor) return
  e.preventDefault()
  e.stopPropagation() // capture-phase: beat the renderer's navigate/edit click
  addComment({ pageId: activePage.value.id, anchor })
}

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
  <div
    v-if="bootError"
    class="flex min-h-screen flex-col items-center justify-center gap-3 bg-background"
  >
    <p class="text-sm font-medium">{{ bootError }}</p>
    <ButtonUI variant="outline" size="sm" @click="reloadPage">Retry</ButtonUI>
  </div>

  <div v-else-if="ready" class="grid h-screen grid-rows-[auto_1fr] overflow-hidden">
    <header class="flex items-center p-2">
      <AppHeader mode="content" />
    </header>

    <main
      ref="mainEl"
      class="overflow-auto bg-white font-sans text-black select-text"
      :class="commentMode && 'cursor-crosshair'"
      :style="fontStyle"
      @click.capture="onPreviewClick"
    >
      <div class="flex min-h-full flex-col">
        <EntryScope
          v-if="activeEntry && activeCollection"
          :collection="activeCollection"
          :entry="activeEntry"
        >
          <ContentRenderer v-for="node in activePage.elements" :key="node.id" :node="node" />
        </EntryScope>
        <EntryScope
          v-else-if="templateCollection"
          :collection="templateCollection"
          :entry="null"
        >
          <ContentRenderer v-for="node in activePage.elements" :key="node.id" :node="node" />
        </EntryScope>
        <template v-else>
          <ContentRenderer v-for="node in activePage.elements" :key="node.id" :node="node" />
        </template>
      </div>
    </main>

    <!-- floating comment pins over the preview -->
    <CommentLayer :root="mainEl ?? null" />

    <MediaLibraryModal v-if="mediaOpen" @close="closeMediaLibrary" />

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

  <div v-else class="flex min-h-screen items-center justify-center bg-background">
    <p class="text-xs text-muted-foreground">Loading…</p>
  </div>
</template>
