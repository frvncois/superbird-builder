<script lang="ts">
// One pending link navigation for the whole tree: a single click schedules
// it, ANY double-click cancels it (clicks bubble — a dblclick on an image
// inside a link must cancel the link's timer, and stopPropagation on the
// child's dblclick would otherwise hide it from the parent).
const NAV_DELAY_MS = 250
let pendingNav: number | null = null
function cancelPendingNav() {
  if (pendingNav !== null) {
    clearTimeout(pendingNav)
    pendingNav = null
  }
}
</script>

<script setup lang="ts">
// Preview-mode renderer: the site rendered like a live preview, navigable by
// clicking links (state-driven — switches the active page/entry, no URL
// change), with double-click inline editing of text and image/video src.
// Built on the shared rendering core (useRenderNode); editing is layered on
// top. Links follow on single click; double-click edits a link's text.
import { computed, watch } from 'vue'
import EntryScope from '@/components/shared/EntryScope.vue'
import { useLocale } from '@/composables/useLocale'
import { useRenderNode } from '@/composables/useRenderNode'
import { useInlineEdit } from '@/composables/useInlineEdit'
import { usePreviewEditing } from '@/composables/usePreviewEditing'
import { useProject } from '@/composables/useProject'
import { usePage } from '@/composables/usePage'
import { useCollections } from '@/composables/useCollections'
import { useMedia } from '@/composables/useMedia'
import { useMediaLibrary } from '@/composables/useMediaLibrary'
import { resolveSitePath } from '@/lib/navigation'
import type { ElementNode } from '@/types/editor'

const props = defineProps<{ node: ElementNode }>()

const { project } = useProject()
const { setActivePage } = usePage()
const { openEntry, activeEntryId } = useCollections()
const {
  entryValue, setNodeContent, setNodeSrc, setEntryValue, setActiveLocale,
} = useLocale()
const { openMenu, editRequest, consumeEditRequest } = usePreviewEditing()

const {
  def,
  listCollection, listEntries, itemCollection, itemEntry, itemTemplateChildren, selfNested,
  boundField, boundEntry, customAttrs, backgroundInfo,
  displayContent, richContent, srcAttr, altAttr, linkRaw, baseClasses,
  hoverHandlers, fireClickInteractions, el,
} = useRenderNode(() => props.node)

const classes = computed(() => [baseClasses.value])

const isMedia = computed(() => props.node.type === 'image' || props.node.type === 'video')

// --- inline text editing (Cmd+Click; Esc saves like blur) ---

const editableText = computed(
  () =>
    def.value?.defaultContent !== undefined &&
    !props.node.children.length &&
    (!boundField.value ||
      (!!boundEntry.value && !['reference', 'multi-reference'].includes(boundField.value.type))),
)

// already-rich content keeps its formatting while inline-editing
const richEditing = computed(() => richContent.value !== null)

const { editing, editEl, startEditing, finishEditing, onEditKeydown } = useInlineEdit({
  editable: editableText,
  rich: richEditing,
  initialText: () => {
    const placeholder =
      !!boundField.value &&
      !!boundEntry.value &&
      !entryValue(boundEntry.value, boundField.value.name).value
    return placeholder ? '' : (displayContent.value ?? '')
  },
  commit: (text) => {
    if (boundField.value && boundEntry.value) {
      setEntryValue(boundEntry.value, boundField.value.name, text)
    } else {
      setNodeContent(props.node, text)
    }
  },
  escBehavior: 'save',
})

// --- media replace (double-click an image/video → media library picker) ---

async function pickMedia() {
  const picked = await useMediaLibrary().openSelect([
    props.node.type === 'video' ? 'video' : 'image',
  ])
  if (!picked) return
  const url = useMedia().mediaUrl(picked)
  // a collection-bound image writes the entry field; a plain image its src
  if (boundField.value?.type === 'image' && boundEntry.value) {
    setEntryValue(boundEntry.value, boundField.value.name, url)
  } else {
    setNodeSrc(props.node, url)
  }
}

/** the edit action for this node's type */
function edit(e?: Event) {
  if (editableText.value) startEditing(e)
  else if (isMedia.value) pickMedia()
}

const editable = computed(() => editableText.value || isMedia.value)

// context-menu "Edit content" targets a node by id — claim it here
watch(editRequest, () => {
  if (consumeEditRequest(props.node.id)) edit()
})

// --- links (state-driven navigation) ---

// '@item' resolution + scheme allowlist live in the render core
const linkTarget = computed(() => {
  const raw = linkRaw.value
  return raw ? { raw, internal: raw.startsWith('/') } : null
})

// hover affordance: a soft accent outline marks anything double-click/click
// can act on; suppressed while editing so it can't fight the solid ring.
// Cursor precedence: linked → pointer (click navigates), editable text →
// text cursor, media → pointer.
const hoverAffordance = computed(() => {
  if (editing.value) return null
  const actionable = editableText.value || isMedia.value || !!linkTarget.value
  if (!actionable) return null
  return [
    'hover:outline hover:outline-2 hover:-outline-offset-2 hover:outline-accent/40',
    linkTarget.value ? 'cursor-pointer' : editableText.value ? 'cursor-text' : 'cursor-pointer',
  ]
})

function navigate(raw: string) {
  const resolved = resolveSitePath(project.value, raw)
  if (resolved.kind === 'notfound') return
  setActiveLocale(resolved.locale)
  if (resolved.kind === 'entry') {
    openEntry(resolved.collection, resolved.entry.id)
  } else {
    activeEntryId.value = null // leaving any loaded entry
    setActivePage(resolved.page.id)
  }
}

const handlers = {
  // single click follows links; double click edits. A dblclick always fires a
  // click first, so link navigation is deferred one beat and cancelled by any
  // double-click (shared timer: clicks bubble, so a dblclick on an image
  // inside a link must cancel the LINK's pending navigation, not its own).
  click(e: MouseEvent) {
    if (editing.value) return
    fireClickInteractions()
    if (linkTarget.value?.internal) {
      e.preventDefault()
      const raw = linkTarget.value.raw
      cancelPendingNav()
      pendingNav = window.setTimeout(() => {
        pendingNav = null
        navigate(raw)
      }, NAV_DELAY_MS)
    }
  },
  dblclick(e: MouseEvent) {
    cancelPendingNav()
    if (!editable.value || editing.value) return
    e.preventDefault()
    e.stopPropagation()
    edit(e)
  },
  contextmenu(e: MouseEvent) {
    if (!editable.value) return
    openMenu(e, props.node.id)
  },
  ...hoverHandlers,
}
</script>

<template>
  <component
    :is="def?.tag ?? 'div'"
    v-if="node.type === 'collection-list'"
    ref="el"
    v-bind="customAttrs"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :class="classes"
    v-on="handlers"
  >
    <template v-if="listCollection && listEntries.length">
      <EntryScope
        v-for="(entry, i) in listEntries"
        :key="entry.id"
        :collection="listCollection"
        :entry="entry"
        :index="i"
        :count="listEntries.length"
      >
        <PreviewRenderer
          v-for="child in node.children"
          :key="`${child.id}:${entry.id}`"
          :node="child"
        />
      </EntryScope>
    </template>
  </component>

  <component
    :is="def?.tag ?? 'div'"
    v-else-if="node.type === 'collection-item'"
    ref="el"
    v-bind="customAttrs"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :class="classes"
    v-on="handlers"
  >
    <template v-if="itemCollection && itemEntry && !selfNested">
      <EntryScope :collection="itemCollection" :entry="itemEntry">
        <PreviewRenderer v-for="child in itemTemplateChildren" :key="child.id" :node="child" />
      </EntryScope>
    </template>
  </component>

  <component
    :is="def?.tag ?? 'div'"
    v-else-if="def?.void"
    ref="el"
    v-bind="customAttrs"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :src="srcAttr"
    :alt="altAttr"
    :class="[classes, hoverAffordance]"
    v-on="handlers"
  />
  <component
    :is="def?.tag ?? 'div'"
    v-else
    ref="el"
    v-bind="customAttrs"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :src="srcAttr"
    :alt="altAttr"
    :class="[
      classes,
      hoverAffordance,
      editing && 'cursor-text outline outline-2 -outline-offset-2 outline-accent bg-accent/5',
    ]"
    :style="backgroundInfo?.style || undefined"
    v-on="handlers"
  >
    <video
      v-if="backgroundInfo?.kind === 'video'"
      :src="backgroundInfo.url"
      autoplay
      muted
      loop
      playsinline
      :class="backgroundInfo.layerClass"
    />
    <template v-if="!node.children.length && !editing">
      <span v-if="richContent !== null" v-html="richContent"></span>
      <template v-else>{{ displayContent }}</template>
    </template>
    <span
      v-if="editing"
      ref="editEl"
      :contenteditable="richEditing ? 'true' : 'plaintext-only'"
      class="outline-none"
      @blur="finishEditing(false)"
      @keydown="onEditKeydown"
    ></span>
    <PreviewRenderer v-for="child in node.children" :key="child.id" :node="child" />
  </component>
</template>
