import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { ELEMENTS } from '@/lib/elements'
import { usePage } from './usePage'
import { useCollections } from './useCollections'
import { useInteraction } from './useInteraction'
import { useComponents } from './useComponents'
import { entryKey } from '@/components/shared/EntryScope.vue'
import { resolveBinding, resolveListScope } from '@/lib/shared/fields.js'
import { backgroundRender } from '@/lib/shared/background.js'
import { useMedia, kindOfMime } from './useMedia'
import { evaluateConditions } from '@/lib/shared/conditions.js'
import { useLocale } from './useLocale'
import type { CollectionEntry, ElementNode } from '@/types/editor'

export interface ConditionResult {
  visible: boolean
  /** set while an active 'swap' effect overrides content/media */
  content?: string
  src?: string
}

/** browser state runtime condition rules test against */
export interface RuntimeEnv {
  viewport: number
  now: number
  query: (param: string) => string | null
}

/**
 * The rendering core shared VERBATIM by the editor's ElementRenderer and
 * the published site's PublicRenderer: element/tag resolution, component
 * master mapping, collection/entry-scope resolution, interaction firing,
 * and the scroll-into-view observer. Each renderer keeps its own content
 * precedence, class composition, links and event handlers on top.
 */
export function useRenderNode(
  getNode: () => ElementNode,
  opts?: {
    /** when set, runtime condition rules (viewport/date/query) evaluate
     * against it — the published-site preview passes the real browser env;
     * the editor omits it so those rules read as matching */
    runtimeEnv?: () => RuntimeEnv
  },
) {
  const node = computed(getNode)

  const { fire, unfire, toggle, fireScoped, unfireScoped, toggleScoped, classesFor, scopedClassesFor } =
    useInteraction()
  const { masterFor } = useComponents()
  const { pages, activePage } = usePage()
  const { collections, collectionByName, activeCollection, activeEntry } = useCollections()
  const { activeLocale, defaultLocale } = useLocale()
  const { assetForSrc } = useMedia()

  const def = computed(() => ELEMENTS[node.value.type])

  // inside a component instance block, style/interactions come from the
  // shared master node; content stays this node's own
  const mapping = computed(() => masterFor(node.value.id))

  // --- collections / entry scope ---

  const scope = inject(entryKey, null)

  // a list arg names a collection (all entries) or a multi-reference field
  // of the surrounding scope entry (the referenced entries)
  const listScope = computed(() =>
    node.value.type === 'collection-list'
      ? resolveListScope(
          collections.value,
          scope?.collection ?? activeCollection.value,
          scope?.entry ?? activeEntry.value,
          node.value.arg,
        )
      : null,
  )
  const listCollection = computed(() => listScope.value?.collection ?? null)
  const listEntries = computed<CollectionEntry[]>(() => listScope.value?.entries ?? [])
  const itemCollection = computed(() =>
    node.value.type === 'collection-item' && node.value.arg ? collectionByName(node.value.arg) : null,
  )
  const itemEntry = computed(
    () => itemCollection.value?.entries.find((e) => e.id === node.value.entryId) ?? null,
  )
  const itemTemplateChildren = computed(() => {
    const col = itemCollection.value
    const page = col ? pages.value.find((p) => p.id === col.templatePageId) : null
    return page?.elements.find((n) => n.type === 'body')?.children ?? []
  })
  /** a template embedding its own collection would recurse forever */
  const selfNested = computed(
    () => !!scope && !!itemCollection.value && scope.collection.id === itemCollection.value.id,
  )

  // a node bound to a field (:h1[title]:) shows the entry's value — from the
  // surrounding list/item scope, or the template's active entry. The binding
  // may hop one reference ('author.name'): boundField/boundEntry are the
  // RESOLVED field + entry the value actually lives on.
  const boundCollection = computed(() => scope?.collection ?? activeCollection.value)
  const binding = computed(() =>
    resolveBinding(
      collections.value,
      boundCollection.value,
      scope ? scope.entry : activeEntry.value,
      node.value.arg,
    ),
  )
  const boundField = computed(() => binding.value?.field ?? null)
  const boundEntry = computed(() => binding.value?.entry ?? null)

  // --- conditions ---

  // inside a component instance the master's conditions apply (like
  // style/interactions); rules evaluate against the surrounding scope
  const condition = computed<ConditionResult>(() =>
    evaluateConditions((mapping.value ? mapping.value.master.conditions : node.value.conditions) ?? null, {
      collections: collections.value,
      collection: scope?.collection ?? activeCollection.value,
      entry: scope ? scope.entry : activeEntry.value,
      locale: activeLocale.value,
      defaultLocale: defaultLocale.value,
      pagePath: activePage.value.path,
      index: scope?.index,
      count: scope?.count,
      runtimeEnv: opts?.runtimeEnv?.(),
    }),
  )

  // --- background media (image → CSS bg, video → layer); master-aware like style ---
  const backgroundInfo = computed(() => {
    const styleNode = mapping.value ? mapping.value.master : node.value
    const bg = styleNode.background || undefined
    if (!bg) return null
    const asset = assetForSrc(bg)
    const mediaKind = asset ? kindOfMime(asset.mime) : null
    const kind = mediaKind === 'image' || mediaKind === 'video' ? mediaKind : null
    const tokens = (styleNode.classes ?? '').split(/\s+/).filter(Boolean)
    return backgroundRender(kind, bg, tokens)
  })

  // --- interactions ---

  const ofTrigger = (trigger: 'hover' | 'click' | 'appear') =>
    ((mapping.value ? mapping.value.master.interactions : node.value.interactions) ?? []).filter(
      (i) => i.trigger === trigger,
    )

  // mapped nodes fire in their instance's scope so siblings stay still
  function fireIn(id: string) {
    if (mapping.value) fireScoped(id, mapping.value.instanceId)
    else fire(id)
  }
  function unfireIn(id: string) {
    if (mapping.value) unfireScoped(id, mapping.value.instanceId)
    else unfire(id)
  }
  function toggleIn(id: string) {
    if (mapping.value) toggleScoped(id, mapping.value.instanceId)
    else toggle(id)
  }

  // fire 'appear' interactions the first time the element scrolls into view
  const el = ref<HTMLElement>()
  let observer: IntersectionObserver | null = null
  onMounted(() => {
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        for (const interaction of ofTrigger('appear')) fireIn(interaction.id)
      }
    })
    if (el.value) observer.observe(el.value)
  })
  onBeforeUnmount(() => observer?.disconnect())

  return {
    def,
    mapping,
    scope,
    classesFor,
    scopedClassesFor,
    listCollection,
    listEntries,
    itemCollection,
    itemEntry,
    itemTemplateChildren,
    selfNested,
    boundCollection,
    boundField,
    boundEntry,
    condition,
    backgroundInfo,
    ofTrigger,
    fireIn,
    unfireIn,
    toggleIn,
    el,
  }
}
