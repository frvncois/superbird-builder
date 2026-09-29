<script setup lang="ts">
import { computed, inject } from 'vue'
import { useElement } from '@/composables/useElement'
import { useProject } from '@/composables/useProject'
import { resolveClassesForWidth } from '@/lib/responsive'
import { FRAME_BREAKPOINT } from '@/components/editor/canvas/frameScope'
import { useStructure } from '@/composables/useStructure'
import EntryScope from '@/components/shared/EntryScope.vue'
import { useInteraction } from '@/composables/useInteraction'
import { useContextMenu } from '@/composables/useContextMenu'
import { useRenderNode } from '@/composables/useRenderNode'
import { useInlineEdit } from '@/composables/useInlineEdit'
import {
  perViewForWidth,
  sliderHostExtraClass,
  SLIDER_SLIDE_CLASSES,
  SLIDER_ARROW_CLASSES,
  SLIDER_PREV_CLASS,
  SLIDER_NEXT_CLASS,
  SLIDER_PREV_SVG,
  SLIDER_NEXT_SVG,
  SLIDER_DOTS_CLASSES,
  SLIDER_DOT_CLASSES,
  SLIDER_DOT_ACTIVE_CLASSES,
} from '@/lib/shared/slider.js'
import type { ElementNode } from '@/types/editor'

const props = defineProps<{ node: ElementNode }>()

const { selectedElement, selectedElementIds, selectElement, draggingId, dropTarget, highlightedElement, requestReveal } = useElement()
const { backend } = useStructure()
const { pickingFor, pickTarget } = useInteraction()
const { openMenu } = useContextMenu()

// shared rendering core (also used by Preview's PreviewRenderer):
// def/mapping, collection + entry-scope resolution, interaction firing,
// and the scroll-into-view observer (bound via ref="el")
const {
  def,
  mapping,
  listCollection,
  listEntries,
  itemCollection,
  itemEntry,
  itemTemplateChildren,
  selfNested,
  customAttrs,
  backgroundInfo,
  contentInfo,
  displayContent,
  richContent,
  srcInfo,
  srcAttr,
  altAttr,
  iconInfo,
  editableText,
  richEditing,
  inlineInitialText,
  commitInlineText,
  baseClasses,
  hoverHandlers,
  fireClickInteractions,
  fireChangeInteractions,
  el,
  motionStyle,
  sliderBound,
  sliderResolved,
  sliderTrackClass,
} = useRenderNode(() => props.node, { fieldPlaceholders: true })

const untranslated = computed(
  () =>
    (!props.node.children.length && contentInfo.value.untranslated) || srcInfo.value.untranslated,
)

const titleAttr = computed(() => (untranslated.value ? 'Not translated' : undefined))

// which breakpoint frame this element is rendered in (null outside the canvas)
const frameBreakpointId = inject(FRAME_BREAKPOINT, null)
const { breakpoints, activeBreakpointId, baseBreakpoint } = useProject()

// each frame renders the classes resolved for its own width, so per-breakpoint
// overrides (`max-[390px]:bg-black`) actually show in the right frame — the real
// media query can't, since every frame shares the one window width
const frameWidth = computed(
  () => breakpoints.value.find((b) => b.id === frameBreakpointId)?.width ?? null,
)
const framedClasses = computed(() => {
  const joined = baseClasses.value.filter(Boolean).join(' ')
  return frameWidth.value !== null ? resolveClassesForWidth(joined, frameWidth.value) : joined
})

// --- slider chrome (static on the canvas; Preview runs the real runtime) ---

const sliderHostClass = computed(() =>
  props.node.type === 'slider' ? sliderHostExtraClass(props.node.classes) : '',
)
/** the canvas paints the dot rail itself, so it needs its own count: one dot
 * per reachable position at this frame's width */
const canvasDotCount = computed(() => {
  if (props.node.type !== 'slider') return 0
  const slides = sliderBound.value
    ? Math.max(1, listEntries.value.length)
    : props.node.children.length
  const perView = perViewForWidth(
    props.node.slider,
    breakpoints.value,
    frameWidth.value ?? baseBreakpoint.value?.width ?? Number.POSITIVE_INFINITY,
  )
  const count = slides - perView + 1
  return count > 1 ? count : 0
})
// selection/highlight outlines only render in the frame being edited, so one
// selection doesn't light up every breakpoint at once. Always true when the
// element isn't in a multi-frame canvas.
const inActiveFrame = computed(() => {
  if (frameBreakpointId === null) return true
  return frameBreakpointId === (activeBreakpointId.value ?? baseBreakpoint.value?.id ?? null)
})

const selected = computed(
  () =>
    inActiveFrame.value &&
    (selectedElementIds.value.length
      ? selectedElementIds.value.includes(props.node.id)
      : selectedElement.value?.id === props.node.id),
)
// a transient preview highlight (e.g. an interaction's Target hover), shown in a
// distinct colour and only when this node isn't already the live selection
const highlighted = computed(
  () => inActiveFrame.value && highlightedElement.value?.id === props.node.id && !selected.value,
)

const classes = computed(() => [
  // core: body flex-1, master/own classes, interaction classes, bg host —
  // resolved for this frame's breakpoint width
  framedClasses.value,
  // text-selection guard: only elements actually showing text content
  // are selectable; containers and chrome stay select-none
  !def.value?.void &&
    !props.node.children.length &&
    !['body', 'collection-list', 'collection-item', 'slider'].includes(props.node.type) &&
    'select-text',
  // untranslated fallback content renders dimmed under a non-default locale
  untranslated.value && 'opacity-60',
  // while inline-editing, the accent editing ring (bound in the template)
  // replaces the selection/highlight outlines instead of fighting them
  selected.value && !editing.value && 'outline outline-2 -outline-offset-2 outline-sky-500',
  highlighted.value && !editing.value && 'outline outline-2 -outline-offset-2 outline-emerald-500',
  dropTarget.value?.id === props.node.id &&
    (dropTarget.value.position === 'before'
      ? 'shadow-[0_-2px_0_0_#0ea5e9]'
      : dropTarget.value.position === 'after'
        ? 'shadow-[0_2px_0_0_#0ea5e9]'
        : // 'inside' (palette drop as last child): dashed to distinguish
          // from the solid selection outline
          'outline outline-2 -outline-offset-2 outline-dashed outline-sky-500 bg-sky-500/5'),
])

// --- inline text editing (double-click) ---
// what's editable, what it opens with and where it commits all come from the
// render core; Build differs only in the gesture and in Esc discarding

const { editing, editEl, startEditing, finishEditing, onEditKeydown } = useInlineEdit({
  editable: editableText,
  rich: richEditing,
  initialText: inlineInitialText,
  commit: commitInlineText,
  escBehavior: 'cancel',
  onExit: () => requestReveal(), // Esc/Enter hands focus back to the Layers tree
})

const handlers = {
  dblclick: startEditing,
  click(e: Event) {
    e.stopPropagation()
    if (editing.value) return
    // a pending "Pick target" claims the click instead of selecting;
    // inside an instance the shared master id is what gets targeted
    if (pickingFor.value) {
      pickTarget(mapping.value ? mapping.value.master.id : props.node.id)
      return
    }
    fireClickInteractions()
    selectElement(props.node.id)
    requestReveal() // bring this element's row into view in the Layers tree
  },
  contextmenu(e: MouseEvent) {
    e.stopPropagation()
    openMenu(e, props.node.id)
  },
  ...hoverHandlers,
  // both events, mirroring the published runtime: 'input' makes text fields
  // update live rather than only on blur (server/site-runtime.js)
  change: fireChangeInteractions,
  input: fireChangeInteractions,
  dragstart(e: DragEvent) {
    if (props.node.type === 'body') return
    if (!backend.value.can(props.node, 'move')) return
    e.stopPropagation()
    draggingId.value = props.node.id
    e.dataTransfer?.setData('text/plain', props.node.id)
  },
  dragover(e: DragEvent) {
    if (!draggingId.value || draggingId.value === props.node.id) return
    if (props.node.type === 'body') return
    e.preventDefault()
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    dropTarget.value = {
      id: props.node.id,
      position: e.clientY < rect.top + rect.height / 2 ? 'before' : 'after',
    }
  },
  drop(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (
      draggingId.value &&
      dropTarget.value?.id === props.node.id &&
      dropTarget.value.position !== 'inside'
    ) {
      backend.value.move([draggingId.value], props.node.id, dropTarget.value.position)
    }
    draggingId.value = null
    dropTarget.value = null
  },
  dragend() {
    draggingId.value = null
    dropTarget.value = null
  },
}
</script>

<template>
  <!-- repeats its children (the inline item template) once per entry -->
  <component
    :is="def?.tag ?? 'div'"
    v-if="node.type === 'collection-list'"
    ref="el"
    v-bind="customAttrs"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :class="classes"
    :style="motionStyle"
    draggable="true"
    v-on="handlers"
  >
    <template v-if="listCollection">
      <template v-if="listEntries.length">
        <EntryScope
          v-for="(entry, i) in listEntries"
          :key="entry.id"
          :collection="listCollection"
          :entry="entry"
          :index="i"
          :count="listEntries.length"
        >
          <ElementRenderer
            v-for="child in node.children"
            :key="`${child.id}:${entry.id}`"
            :node="child"
          />
        </EntryScope>
      </template>
      <!-- no entries yet: show the item template once with placeholders -->
      <EntryScope v-else :collection="listCollection" :entry="null">
        <ElementRenderer v-for="child in node.children" :key="child.id" :node="child" />
      </EntryScope>
    </template>
    <div v-else class="border border-dashed border-input p-2 text-xs text-muted-foreground">
      Unknown collection ({{ node.arg || '?' }})
    </div>
  </component>

  <!-- carousel: a scroll-snap track of slides, one per entry when the arg binds
       a collection, else one per direct child. The chrome is static here —
       autoplay and drag only run in Preview and on the published site -->
  <component
    :is="def?.tag ?? 'div'"
    v-else-if="node.type === 'slider'"
    ref="el"
    v-bind="customAttrs"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :class="[classes, sliderHostClass]"
    :style="motionStyle"
    draggable="true"
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
            <ElementRenderer
              v-for="child in node.children"
              :key="`${child.id}:${entry.id}`"
              :node="child"
            />
          </EntryScope>
        </div>
        <!-- no entries yet: show the slide template once with placeholders -->
        <div v-if="!listEntries.length" data-sl-slide :class="SLIDER_SLIDE_CLASSES">
          <EntryScope :collection="listCollection" :entry="null">
            <ElementRenderer v-for="child in node.children" :key="child.id" :node="child" />
          </EntryScope>
        </div>
      </template>
      <!-- an arg that names nothing is a mistake worth surfacing; no arg at all
           is manual mode, where each child is its own slide -->
      <div
        v-else-if="node.arg"
        data-sl-slide
        :class="[SLIDER_SLIDE_CLASSES, 'border border-dashed border-input p-2 text-xs text-muted-foreground']"
      >
        Unknown collection ({{ node.arg }})
      </div>
      <template v-else>
        <div
          v-for="child in node.children"
          :key="child.id"
          data-sl-slide
          :class="SLIDER_SLIDE_CLASSES"
        >
          <ElementRenderer :node="child" />
        </div>
      </template>
    </div>
    <template v-if="sliderResolved.arrows">
      <button
        type="button"
        data-sl-prev
        tabindex="-1"
        aria-label="Previous slide"
        :class="[SLIDER_ARROW_CLASSES, SLIDER_PREV_CLASS]"
        v-html="SLIDER_PREV_SVG"
      />
      <button
        type="button"
        data-sl-next
        tabindex="-1"
        aria-label="Next slide"
        :class="[SLIDER_ARROW_CLASSES, SLIDER_NEXT_CLASS]"
        v-html="SLIDER_NEXT_SVG"
      />
    </template>
    <div v-if="sliderResolved.dots" data-sl-dots :class="SLIDER_DOTS_CLASSES">
      <span
        v-for="i in canvasDotCount"
        :key="i"
        :class="i === 1 ? SLIDER_DOT_ACTIVE_CLASSES : SLIDER_DOT_CLASSES"
      />
    </div>
  </component>

  <!-- one picked entry rendered through its collection's template -->
  <component
    :is="def?.tag ?? 'div'"
    v-else-if="node.type === 'collection-item'"
    ref="el"
    v-bind="customAttrs"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :class="classes"
    :style="motionStyle"
    draggable="true"
    v-on="handlers"
  >
    <template v-if="itemCollection && !selfNested">
      <EntryScope :collection="itemCollection" :entry="itemEntry">
        <ElementRenderer v-for="child in itemTemplateChildren" :key="child.id" :node="child" />
      </EntryScope>
    </template>
    <div v-else class="border border-dashed border-input p-2 text-xs text-muted-foreground">
      {{ selfNested ? 'A template can’t embed its own collection' : `Unknown collection (${node.arg || '?'})` }}
    </div>
  </component>

  <!-- an icon: the <svg> is the element itself, so classes, id and listeners
       land on it like on any other; only its shapes come from the markup -->
  <svg
    v-else-if="iconInfo"
    ref="el"
    v-bind="{ ...iconInfo.attrs, ...customAttrs }"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :class="classes"
    :style="motionStyle"
    draggable="true"
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
    :title="titleAttr"
    :src="srcAttr"
    :alt="altAttr"
    :class="classes"
    :style="motionStyle"
    draggable="true"
    v-on="handlers"
  />
  <component
    :is="def?.tag ?? 'div'"
    v-else
    ref="el"
    v-bind="customAttrs"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :title="titleAttr"
    :src="srcAttr"
    :alt="altAttr"
    :class="[
      classes,
      editing && 'cursor-text outline outline-2 -outline-offset-2 outline-accent bg-accent/5',
    ]"
    :style="[backgroundInfo?.style, motionStyle]"
    :draggable="!editing"
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
    <ElementRenderer v-for="child in node.children" :key="child.id" :node="child" />
  </component>
</template>
