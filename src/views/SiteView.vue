<script setup lang="ts">
// The published site. Boots in its own zone (full page load from /admin —
// see the router guard): hydrates the shared project ref from the
// published snapshot and NEVER starts usePersistence, so nothing here can
// write back to editor storage.

import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { migrateStoredProject } from '@/lib/storage'
import { useProject } from '@/composables/useProject'
import { usePage } from '@/composables/usePage'
import { useLocale } from '@/composables/useLocale'
import { useCollections } from '@/composables/useCollections'
import { useInteraction } from '@/composables/useInteraction'
import { useThemeTokens } from '@/composables/useThemeTokens'
import { applyTitleTemplate } from '@/lib/settings'
import EntryScope from '@/components/editor/EntryScope.vue'
import PublicRenderer from '@/components/site/PublicRenderer.vue'

// runtime Tailwind so user-typed class strings in the snapshot compile —
// parallel dynamic chunk, off the blocking render path
void import('@tailwindcss/browser')
import type { Collection, CollectionEntry, Page, Project } from '@/types/editor'

const { project } = useProject()
const { setActivePage } = usePage()
const { setActiveLocale } = useLocale()
const { entrySlug } = useCollections()
const { fired } = useInteraction()
const route = useRoute()

const snapshot = ref<Project | null>(null)
const loading = ref(true)

// design tokens + Google Fonts for the SPA preview (reads the hydrated
// project ref). Custom head code and meta tags are export-only — an
// accepted preview/export parity gap.
useThemeTokens()

fetch('/api/published')
  .then(async (res) => {
    if (!res.ok) return
    const migrated = migrateStoredProject((await res.json()) as Project)
    if (!migrated) return
    snapshot.value = migrated
    project.value = migrated
  })
  .catch(() => {})
  .finally(() => (loading.value = false))

type Resolved =
  | { kind: 'page'; page: Page }
  | { kind: 'entry'; page: Page; collection: Collection; entry: CollectionEntry }
  | { kind: 'notfound' }

const resolved = computed<Resolved>(() => {
  const site = snapshot.value
  if (!site) return { kind: 'notfound' }

  // locale strip: /fr/... → 'fr' when registered and non-default
  let segments = route.path.split('/').filter(Boolean)
  if (
    segments.length &&
    site.locales.includes(segments[0]!) &&
    segments[0] !== site.defaultLocale
  ) {
    segments = segments.slice(1)
  }

  const path = '/' + segments.join('/')
  const published = (p?: Page | null) => (p && p.status === 'published' ? p : null)

  // page by exact path ('/' home, plain pages, bare collection templates)
  const page = published(site.pages.find((p) => p.path === path))
  if (page) return { kind: 'page', page }

  // collection entry: /<collection>/<slug>
  if (segments.length === 2) {
    const collection = site.collections.find((c) => c.name === segments[0]) ?? null
    const template = collection
      ? published(site.pages.find((p) => p.id === collection.templatePageId))
      : null
    const entry = collection?.entries.find((e) => entrySlug(e) === segments[1]) ?? null
    if (collection && template && entry) return { kind: 'entry', page: template, collection, entry }
  }

  // drafts and unknown paths
  return { kind: 'notfound' }
})

// point the shared singletons at the rendered page + locale, and clear
// click-toggled interaction state so it never leaks across navigations
watch(
  [resolved, () => route.path],
  () => {
    const site = snapshot.value
    if (site) {
      const first = route.path.split('/').filter(Boolean)[0]
      setActiveLocale(
        first && site.locales.includes(first) && first !== site.defaultLocale
          ? first
          : site.defaultLocale,
      )
    }
    const r = resolved.value
    if (r.kind !== 'notfound') setActivePage(r.page.id)
    fired.value = new Set()
    document.title =
      r.kind === 'notfound'
        ? '404'
        : (r.page.seo?.title ??
          applyTitleTemplate(site?.settings.seo.titleTemplate ?? '%s', r.page.name))
  },
  { immediate: true },
)

/** a bare collection-template path renders with an empty entry scope */
const templateCollection = computed(() => {
  const r = resolved.value
  return r.kind === 'page' && r.page.collectionId
    ? (snapshot.value?.collections.find((c) => c.id === r.page.collectionId) ?? null)
    : null
})
</script>

<!-- published pages render fluid on white, with text selection back on -->
<template>
  <div
    class="flex min-h-screen flex-col bg-white font-sans text-black select-text"
    :style="{ fontFamily: snapshot?.settings.fonts.family || undefined }"
  >
    <template v-if="loading"></template>

    <template v-else-if="resolved.kind === 'entry'">
      <EntryScope :collection="resolved.collection" :entry="resolved.entry">
        <PublicRenderer v-for="node in resolved.page.elements" :key="node.id" :node="node" />
      </EntryScope>
    </template>

    <template v-else-if="resolved.kind === 'page'">
      <EntryScope v-if="templateCollection" :collection="templateCollection" :entry="null">
        <PublicRenderer v-for="node in resolved.page.elements" :key="node.id" :node="node" />
      </EntryScope>
      <template v-else>
        <PublicRenderer v-for="node in resolved.page.elements" :key="node.id" :node="node" />
      </template>
    </template>

    <div v-else class="flex flex-1 flex-col items-center justify-center gap-2">
      <p class="text-4xl font-semibold">{{ snapshot ? '404' : 'Nothing published yet' }}</p>
      <p class="text-sm text-neutral-500">
        {{
          snapshot
            ? 'This page could not be found.'
            : 'Publish your project from the editor to see it here.'
        }}
      </p>
    </div>
  </div>
</template>
