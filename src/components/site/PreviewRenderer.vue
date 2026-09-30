<script setup lang="ts">
// Preview-mode renderer: the site rendered like a live preview, navigable by
// clicking links (state-driven — switches the active page/entry, no URL
// change). Built on the shared rendering core (useRenderNode).
//
// Play is READ-ONLY: it shows the site the way a visitor gets it, so nothing
// here edits the document. Interactions, animations, sliders and links all run
// for real; content is changed on the Edit surface (or, for a contributor, in
// the Pages drawer's page/item settings).
import { computed, nextTick, onBeforeUnmount, watch } from 'vue'
import EntryScope from '@/components/shared/EntryScope.vue'
import { useLocale } from '@/composables/useLocale'
import { useRenderNode } from '@/composables/useRenderNode'
import { useProject } from '@/composables/useProject'
import { usePage } from '@/composables/usePage'
import { useCollections } from '@/composables/useCollections'
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
const { setActiveLocale } = useLocale()
const pageTransition = usePageTransition()

const {
  def,
  listCollection, listEntries, itemCollection, itemEntry, itemTemplateChildren, selfNested,
  customAttrs, backgroundInfo,
  displayContent, richContent, srcAttr, altAttr, iconInfo, hidden, linkRaw, baseClasses,
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

// --- links (state-driven navigation) ---

// '@item' resolution + scheme allowlist live in the render core
const linkTarget = computed(() => {
  const raw = linkRaw.value
  return raw ? { raw, internal: raw.startsWith('/') } : null
})

// The only affordance a read-only Play owes the viewer is the one the published
// site gives: a pointer over something a click follows. There is no editor
// outline, because there is nothing here to edit. Any element can carry a link,
// not just an <a>, so the cursor is ours to set.
const linkCursor = computed(() => (linkTarget.value ? 'cursor-pointer' : null))

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
  // a click follows the link immediately — it used to wait 250ms for a possible
  // double-click to cancel it, which only existed so dblclick could edit
  click(e: MouseEvent) {
    fireClickInteractions()
    if (linkTarget.value?.internal) {
      e.preventDefault()
      void followLink(linkTarget.value.raw)
    }
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
    :class="[classes, linkCursor]"
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
    :class="[classes, linkCursor]"
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
    :class="[classes, linkCursor]"
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
    <template v-if="!node.children.length">
      <span v-if="richContent !== null" v-html="richContent"></span>
      <template v-else>{{ displayContent }}</template>
    </template>
    <PreviewRenderer v-for="child in node.children" :key="child.id" :node="child" />
  </component>
</template>
