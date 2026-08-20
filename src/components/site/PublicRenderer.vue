<script setup lang="ts">
// Read-only renderer for the published site: the pure rendering core of
// ElementRenderer (tags, classes, interactions, collections, locales)
// with none of the editor chrome (selection, drag, inline edit, menus).
// This is the DEV PREVIEW; real visitors get the static export, whose
// serializer (server/export.mjs) mirrors these semantics — keep in sync.
//
// Note: useComponents starts its structural-sync watcher on first call,
// but it only reacts to page-code CHANGES — the public zone never edits
// code and has no autosave watcher, so it is inert here.
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import EntryScope from '@/components/editor/EntryScope.vue'
import { useLocale } from '@/composables/useLocale'
import { useRenderNode } from '@/composables/useRenderNode'
import type { ElementNode } from '@/types/editor'

const props = defineProps<{ node: ElementNode }>()

const router = useRouter()
const { nodeContent, nodeSrc, entryValue, activeLocale, defaultLocale, locales } = useLocale()

// shared rendering core (also used by the editor's ElementRenderer)
const {
  def,
  mapping,
  classesFor,
  scopedClassesFor,
  listCollection,
  itemCollection,
  itemEntry,
  itemTemplateChildren,
  selfNested,
  boundField,
  boundEntry,
  ofTrigger,
  fireIn,
  unfireIn,
  toggleIn,
  el,
} = useRenderNode(() => props.node)

// locale-aware content: a bound field with no value renders empty on the
// public site (the editor shows a {field} placeholder instead)
const displayContent = computed(() => {
  if (boundField.value) {
    return boundEntry.value ? (entryValue(boundEntry.value, boundField.value.name).value ?? '') : ''
  }
  return (
    nodeContent(props.node).value ||
    (mapping.value ? nodeContent(mapping.value.master).value : undefined) ||
    def.value?.defaultContent
  )
})

const srcAttr = computed(() => {
  if (boundField.value?.type === 'image') {
    const bound = boundEntry.value
      ? entryValue(boundEntry.value, boundField.value.name).value
      : undefined
    if (bound) return bound
  }
  return nodeSrc(props.node).value || undefined
})

const classes = computed(() => [
  // the body fills the viewport column like it fills the canvas frame
  props.node.type === 'body' && 'flex-1',
  mapping.value ? mapping.value.master.classes : props.node.classes,
  mapping.value
    ? scopedClassesFor(mapping.value.master.id, mapping.value.root, mapping.value.instanceId)
    : classesFor(props.node.id),
])

// --- links ---

const linkTarget = computed(() => {
  if (def.value?.tag !== 'a') return null
  const raw = props.node.link ?? mapping.value?.master.link
  if (!raw) return null
  // same scheme allowlist the static export enforces — drops javascript:,
  // data:, etc. so a link can't execute in this preview
  if (!/^(\/|#|https?:|mailto:|tel:)/i.test(raw)) return null
  const internal = raw.startsWith('/')
  let href = raw
  if (internal) {
    // locale-explicit links (/fr, /en/about) are absolute: never re-prefixed,
    // and the default locale's prefix normalizes away — this is how a locale
    // switcher is authored
    const first = raw.split('/')[1] ?? ''
    if (locales.value.includes(first)) {
      if (first === defaultLocale.value) href = raw.slice(first.length + 1) || '/'
    } else if (activeLocale.value !== defaultLocale.value) {
      href = `/${activeLocale.value}${raw === '/' ? '' : raw}`
    }
  }
  return { href, internal }
})

const handlers = {
  click(e: MouseEvent) {
    for (const interaction of ofTrigger('click')) toggleIn(interaction.id)
    if (linkTarget.value?.internal) {
      e.preventDefault()
      router.push(linkTarget.value.href)
    }
  },
  mouseenter() {
    for (const interaction of ofTrigger('hover')) fireIn(interaction.id)
  },
  mouseleave() {
    for (const interaction of ofTrigger('hover')) unfireIn(interaction.id)
  },
}
</script>

<!-- branch order: collection-list (repeats children per entry),
     collection-item (one entry through its template), void, default -->
<template>
  <component
    :is="def?.tag ?? 'div'"
    v-if="node.type === 'collection-list'"
    ref="el"
    :id="node.htmlId || undefined"
    :class="classes"
    v-on="handlers"
  >
    <template v-if="listCollection && listCollection.entries.length">
      <EntryScope
        v-for="entry in listCollection.entries"
        :key="entry.id"
        :collection="listCollection"
        :entry="entry"
      >
        <PublicRenderer
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
    :id="node.htmlId || undefined"
    :class="classes"
    v-on="handlers"
  >
    <template v-if="itemCollection && itemEntry && !selfNested">
      <EntryScope :collection="itemCollection" :entry="itemEntry">
        <PublicRenderer v-for="child in itemTemplateChildren" :key="child.id" :node="child" />
      </EntryScope>
    </template>
  </component>

  <component
    :is="def?.tag ?? 'div'"
    v-else-if="def?.void"
    ref="el"
    :id="node.htmlId || undefined"
    :src="srcAttr"
    :class="classes"
    v-on="handlers"
  />
  <component
    :is="def?.tag ?? 'div'"
    v-else
    ref="el"
    :id="node.htmlId || undefined"
    :src="srcAttr"
    :href="linkTarget?.href"
    :class="classes"
    v-on="handlers"
  >
    <template v-if="!node.children.length">
      {{ displayContent }}
    </template>
    <PublicRenderer v-for="child in node.children" :key="child.id" :node="child" />
  </component>
</template>
