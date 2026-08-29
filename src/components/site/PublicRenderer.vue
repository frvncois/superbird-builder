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
import EntryScope from '@/components/shared/EntryScope.vue'
import { useLocale } from '@/composables/useLocale'
import { useRenderNode } from '@/composables/useRenderNode'
import { useRuntimeEnv } from '@/composables/useRuntimeEnv'
import type { ElementNode } from '@/types/editor'

const props = defineProps<{ node: ElementNode }>()

const router = useRouter()
const { activeLocale, defaultLocale, locales } = useLocale()

// shared rendering core (also used by the editor's ElementRenderer):
// content/src/rich precedence, link resolution and base classes all live
// there — a value-less field binding renders empty here (the editor passes
// fieldPlaceholders to show {field} instead)
const {
  def,
  listCollection,
  listEntries,
  itemCollection,
  itemEntry,
  itemTemplateChildren,
  selfNested,
  condition,
  backgroundInfo,
  displayContent,
  richContent,
  srcAttr,
  linkRaw,
  baseClasses,
  hoverHandlers,
  fireClickInteractions,
  el,
} = useRenderNode(() => props.node, { runtimeEnv: useRuntimeEnv().env })

const classes = computed(() => [
  // a linked non-anchor element still reads as clickable
  linkTarget.value && def.value?.tag !== 'a' && 'cursor-pointer',
  baseClasses.value,
])

// --- links ---

const linkTarget = computed(() => {
  const raw = linkRaw.value
  if (!raw) return null
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
    fireClickInteractions()
    const target = linkTarget.value
    if (!target) return
    if (target.internal) {
      e.preventDefault()
      router.push(target.href)
    } else if (def.value?.tag !== 'a') {
      // non-anchor elements have no native navigation — do it ourselves
      e.preventDefault()
      window.open(target.href, '_blank', 'noopener')
    }
  },
  ...hoverHandlers,
}
</script>

<!-- branch order: collection-list (repeats children per entry),
     collection-item (one entry through its template), void, default -->
<template>
  <!-- condition-hidden elements are dropped entirely, like the static export -->
  <template v-if="condition.visible">
  <component
    :is="def?.tag ?? 'div'"
    v-if="node.type === 'collection-list'"
    ref="el"
    :id="node.htmlId || undefined"
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
    :href="def?.tag === 'a' ? linkTarget?.href : undefined"
    :class="classes"
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
    <template v-if="!node.children.length">
      <span v-if="richContent !== null" v-html="richContent"></span>
      <template v-else>{{ displayContent }}</template>
    </template>
    <PublicRenderer v-for="child in node.children" :key="child.id" :node="child" />
  </component>
  </template>
</template>
