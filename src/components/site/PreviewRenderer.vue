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
import { computed, nextTick, onBeforeUnmount, watch } from 'vue'
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
import { usePageTransition } from '@/composables/usePageTransition'
import { resolveSitePath } from '@/lib/navigation'
import { reducedMotion } from '@/lib/motion'
import {
  initSlider,
  sliderHostExtraClass,
  SLIDER_SLIDE_CLASSES,
  SLIDER_ARROW_CLASSES,
  SLIDER_PREV_CLASS,
  SLIDER_NEXT_CLASS,
  SLIDER_PREV_SVG,
  SLIDER_NEXT_SVG,
  SLIDER_DOTS_CLASSES,
} from '@/lib/shared/slider.js'
import type { ElementNode } from '@/types/editor'

const props = defineProps<{ node: ElementNode }>()

const { project } = useProject()
const { setActivePage } = usePage()
const { openEntry, activeEntryId } = useCollections()
const { setNodeSrc, setEntryValue, setActiveLocale } = useLocale()
const { openMenu, editRequest, consumeEditRequest } = usePreviewEditing()
const pageTransition = usePageTransition()

const {
  def,
  listCollection, listEntries, itemCollection, itemEntry, itemTemplateChildren, selfNested,
  boundField, boundEntry, customAttrs, backgroundInfo,
  displayContent, richContent, srcAttr, altAttr, iconInfo, hidden, linkRaw, baseClasses,
  editableText, richEditing, inlineInitialText, commitInlineText,
  hoverHandlers, fireClickInteractions, fireChangeInteractions, el,
  motionStyle,
  sliderBound, sliderResolved, sliderTrackClass, sliderWire,
} = useRenderNode(() => props.node)

const classes = computed(() => [baseClasses.value])

// --- slider: the published runtime, running live in Preview ---

const sliderHostClass = computed(() =>
  props.node.type === 'slider' ? sliderHostExtraClass(props.node.classes) : '',
)

let destroySlider: (() => void) | null = null
// two runs of the watcher can straddle the `await` below (the template ref
// lands mid-flush, re-queueing it). Without a generation token the second run
// would find `destroySlider` still null, destroy nothing, and leave the first
// instance alive forever — its autoplay interval would keep advancing the
// track at double rate, even after the node unmounts.
let sliderGeneration = 0

if (props.node.type === 'slider') {
  watch(
    // re-init when the element mounts, when anything the runtime MEASURES
    // changes (the track classes carry gap and slides-per-view), or when the
    // number of slides does. `listEntries` itself is a fresh array on every
    // recompute, so only its length is a source — otherwise editing any entry
    // in Preview would tear down every slider on the page.
    [
      el,
      () => JSON.stringify(sliderWire.value),
      sliderTrackClass,
      () => (sliderBound.value ? listEntries.value.length : props.node.children.length),
    ],
    async () => {
      const generation = ++sliderGeneration
      destroySlider?.()
      destroySlider = null
      await nextTick()
      // a newer run started while we awaited — it owns the instance now
      if (generation !== sliderGeneration) return
      const host = el.value
      if (!host) return
      destroySlider = initSlider(host, sliderWire.value, { still: reducedMotion() })
    },
    { immediate: true },
  )
  onBeforeUnmount(() => {
    sliderGeneration++
    destroySlider?.()
    destroySlider = null
  })
}

const isMedia = computed(() => props.node.type === 'image' || props.node.type === 'video')

// --- inline text editing (Cmd+Click; Esc saves like blur) ---
// what's editable, what it opens with and where it commits all come from the
// render core; Preview differs only in Esc committing instead of discarding

const { editing, editEl, startEditing, finishEditing, onEditKeydown } = useInlineEdit({
  editable: editableText,
  rich: richEditing,
  initialText: inlineInitialText,
  commit: commitInlineText,
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

/** navigate with the site's page transition around it, when one is configured.
 * `enter` runs synchronously after the switch — the new tree hasn't rendered
 * yet, so its first frame is in place before it paints. */
async function followLink(raw: string) {
  await pageTransition.leave()
  navigate(raw)
  pageTransition.enter()
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
        void followLink(raw)
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
  // both events, mirroring the published runtime: 'input' makes text fields
  // update live rather than only on blur (server/site-runtime.js)
  change: fireChangeInteractions,
  input: fireChangeInteractions,
}
</script>

<template>
  <!-- a hidden node renders nothing; it lives on in the Layers tree -->
  <template v-if="hidden" />
  <component
    :is="def?.tag ?? 'div'"
    v-else-if="node.type === 'collection-list'"
    ref="el"
    v-bind="customAttrs"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :class="classes"
    :style="motionStyle"
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

  <!-- carousel — the same DOM the published site gets, driven by the same
       initSlider from shared/slider.js, so Preview and the live site match -->
  <component
    :is="def?.tag ?? 'div'"
    v-else-if="node.type === 'slider'"
    ref="el"
    v-bind="customAttrs"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :class="[classes, sliderHostClass]"
    :style="motionStyle"
    v-on="handlers"
  >
    <div data-sl-track :class="sliderTrackClass">
      <template v-if="sliderBound && listCollection">
        <div
          v-for="(entry, i) in listEntries"
          :key="entry.id"
          data-sl-slide
          :class="SLIDER_SLIDE_CLASSES"
        >
          <EntryScope
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
        </div>
      </template>
      <template v-else-if="!node.arg">
        <div
          v-for="child in node.children"
          :key="child.id"
          data-sl-slide
          :class="SLIDER_SLIDE_CLASSES"
        >
          <PreviewRenderer :node="child" />
        </div>
      </template>
    </div>
    <template v-if="sliderResolved.arrows">
      <button
        type="button"
        data-sl-prev
        aria-label="Previous slide"
        :class="[SLIDER_ARROW_CLASSES, SLIDER_PREV_CLASS]"
        v-html="SLIDER_PREV_SVG"
      />
      <button
        type="button"
        data-sl-next
        aria-label="Next slide"
        :class="[SLIDER_ARROW_CLASSES, SLIDER_NEXT_CLASS]"
        v-html="SLIDER_NEXT_SVG"
      />
    </template>
    <!-- the runtime fills the dot rail, so it knows the real reachable count -->
    <div
      v-if="sliderResolved.dots"
      data-sl-dots
      role="tablist"
      aria-label="Slides"
      :class="SLIDER_DOTS_CLASSES"
    />
  </component>

  <component
    :is="def?.tag ?? 'div'"
    v-else-if="node.type === 'collection-item'"
    ref="el"
    v-bind="customAttrs"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :class="classes"
    :style="motionStyle"
    v-on="handlers"
  >
    <template v-if="itemCollection && itemEntry && !selfNested">
      <EntryScope :collection="itemCollection" :entry="itemEntry">
        <PreviewRenderer v-for="child in itemTemplateChildren" :key="child.id" :node="child" />
      </EntryScope>
    </template>
  </component>

  <!-- an icon: the <svg> is the element itself (see ElementRenderer) -->
  <svg
    v-else-if="iconInfo"
    ref="el"
    v-bind="{ ...iconInfo.attrs, ...customAttrs }"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :class="[classes, hoverAffordance]"
    :style="motionStyle"
    v-on="handlers"
    v-html="iconInfo.inner"
  />
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
    :style="motionStyle"
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
    :style="[backgroundInfo?.style, motionStyle]"
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
