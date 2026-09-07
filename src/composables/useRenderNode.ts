import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { ELEMENTS } from '@/lib/elements'
import { usePage } from './usePage'
import { useCollections } from './useCollections'
import { useInteraction } from './useInteraction'
import { useComponents } from './useComponents'
import { useProject } from './useProject'
import { FRAME_BREAKPOINT } from '@/components/editor/canvas/frameScope'
import { entryKey } from '@/components/shared/EntryScope.vue'
import { refDisplay, resolveBinding, resolveListScope, applyListQuery } from '@/lib/shared/fields.js'
import { isRich, sanitizeRich } from '@/lib/shared/richtext.js'
import { backgroundRender, backgroundKindFromUrl } from '@/lib/shared/background.js'
import { conflictingBaseClasses } from '@/lib/shared/interactionClasses.js'
import { useMedia, kindOfMime } from './useMedia'
import { evaluateConditions } from '@/lib/shared/conditions.js'
import { useLocale } from './useLocale'
import { SAFE_SRC } from '@/lib/shared/urls.js'
import type { CollectionEntry, ElementNode } from '@/types/editor'

export interface ConditionResult {
  visible: boolean
  /** set while an active 'swap' effect overrides content/media */
  content?: string
  src?: string
}

/** a resolved content/src value; `untranslated` marks a default-locale
 * fallback rendered under a non-default locale (the editor dims these) */
export interface LocalizedDisplay {
  value: string | undefined
  untranslated: boolean
}

/**
 * The rendering core shared VERBATIM by the editor's ElementRenderer and
 * Preview's PreviewRenderer (the published site is static HTML from
 * server/export.mjs, which mirrors this logic): element/tag resolution,
 * component master mapping, collection/entry-scope resolution, interaction
 * firing, the scroll-into-view observer, and the content/src/rich/link
 * resolution (condition swap → bound field → own → mapped master → element
 * default). Each renderer keeps its own selection chrome, extra classes and
 * event handlers on top.
 */
export function useRenderNode(
  getNode: () => ElementNode,
  opts?: {
    /** editor only: a value-less field binding renders a {field}
     * placeholder instead of the site's empty string */
    fieldPlaceholders?: boolean
  },
) {
  const node = computed(getNode)

  const { fire, unfire, toggle, fireScoped, unfireScoped, toggleScoped, classesFor, scopedClassesFor } =
    useInteraction()
  const { masterFor } = useComponents()
  const { pages, activePage } = usePage()
  const { liveBreakpointId } = useProject()

  // the breakpoint this node is rendered for — the frame's id in the multi-frame
  // canvas, else the live viewport (Preview / published site). Drives which
  // breakpoint-scoped interactions contribute their classes.
  const frameBreakpointId = inject(FRAME_BREAKPOINT, null)
  const renderBreakpointId = computed(() => frameBreakpointId ?? liveBreakpointId.value)
  const { collections, collectionByName, activeCollection, activeEntry, entryPath } = useCollections()
  const { activeLocale, defaultLocale, nodeContent, nodeSrc, entryValue } = useLocale()
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
  const listEntries = computed<CollectionEntry[]>(() =>
    applyListQuery(listScope.value?.entries ?? [], node.value.listQuery),
  )
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
    }),
  )

  // --- background media (image → CSS bg, video → layer); master-aware like style ---
  const backgroundInfo = computed(() => {
    const styleNode = mapping.value ? mapping.value.master : node.value
    const bg = styleNode.background || undefined
    if (!bg || !SAFE_SRC.test(bg)) return null
    const asset = assetForSrc(bg)
    const mediaKind = asset ? kindOfMime(asset.mime) : null
    // library assets resolve kind from their mime; external/data URLs infer it
    // (without the fallback, an https background silently rendered as nothing)
    const kind =
      mediaKind === 'image' || mediaKind === 'video' ? mediaKind : backgroundKindFromUrl(bg)
    const tokens = (styleNode.classes ?? '').split(/\s+/).filter(Boolean)
    return backgroundRender(kind, bg, tokens)
  })

  // --- content / src / rich / alt (shared precedence) ---

  const contentInfo = computed<LocalizedDisplay>(() => {
    // an active condition swap wins over every other content source
    if (condition.value.content != null && condition.value.content !== '') {
      return { value: condition.value.content, untranslated: false }
    }
    if (boundField.value) {
      // a reference field bound directly (no `.field` hop) reads as the
      // referenced entry name(s)
      if (['reference', 'multi-reference'].includes(boundField.value.type)) {
        const names = boundEntry.value
          ? refDisplay(collections.value, boundField.value, boundEntry.value)
          : ''
        if (names) return { value: names, untranslated: false }
        return { value: opts?.fieldPlaceholders ? `{${boundField.value.name}}` : '', untranslated: false }
      }
      const info = boundEntry.value ? entryValue(boundEntry.value, boundField.value.name) : null
      if (info?.value) return { value: info.value, untranslated: !info.translated }
      return { value: opts?.fieldPlaceholders ? `{${boundField.value.name}}` : '', untranslated: false }
    }
    const own = nodeContent(node.value)
    if (own.value) return { value: own.value, untranslated: !own.translated }
    const master = mapping.value ? nodeContent(mapping.value.master) : null
    if (master?.value) return { value: master.value, untranslated: !master.translated }
    return { value: def.value?.defaultContent, untranslated: false }
  })
  const displayContent = computed(() => contentInfo.value.value)

  // rich content renders through the shared sanitizer via v-html
  const richContent = computed(() =>
    isRich(displayContent.value) ? sanitizeRich(displayContent.value) : null,
  )

  const srcInfo = computed<LocalizedDisplay>(() => {
    if (condition.value.src) return { value: condition.value.src, untranslated: false }
    if (boundField.value?.type === 'image') {
      const info = boundEntry.value ? entryValue(boundEntry.value, boundField.value.name) : null
      if (info?.value) return { value: info.value, untranslated: !info.translated }
    }
    const own = nodeSrc(node.value)
    return { value: own.value || undefined, untranslated: !!own.value && !own.translated }
  })
  const srcAttr = computed(() => {
    const v = srcInfo.value.value
    return v && SAFE_SRC.test(v) ? v : undefined
  })

  // images carry the library asset's default alt (no per-node alt field yet)
  const altAttr = computed(() =>
    def.value?.tag === 'img' ? (assetForSrc(srcAttr.value)?.alt ?? '') : undefined,
  )

  // --- links ---

  // any element with a link navigates — not just <a>. '@item' resolves to
  // the current entry's page and is inert outside an entry scope. Same
  // scheme allowlist the static export enforces — drops javascript:,
  // data:, etc. Renderers turn the raw value into their own href/nav.
  const linkRaw = computed(() => {
    let raw = node.value.link ?? mapping.value?.master.link
    if (raw === '@item') {
      if (!scope?.entry) return null
      raw = entryPath(scope.collection, scope.entry)
    }
    if (!raw) return null
    if (!/^(\/|#|https?:|mailto:|tel:)/i.test(raw)) return null
    return raw
  })

  // --- classes (shared core; renderers append their own chrome) ---

  const baseClasses = computed(() => {
    const own = (mapping.value ? mapping.value.master.classes : node.value.classes) ?? ''
    const interactionCls = mapping.value
      ? scopedClassesFor(
          mapping.value.master.id,
          mapping.value.root,
          mapping.value.instanceId,
          renderBreakpointId.value,
        )
      : classesFor(node.value.id, renderBreakpointId.value)
    // parity with the published runtime (int-fxrm): own classes styling the
    // same property as an active interaction's classes are REMOVED, not
    // outweighed — the cascade would pick an arbitrary winner (hidden+flex)
    const removed = interactionCls
      ? new Set(conflictingBaseClasses(own.split(/\s+/).filter(Boolean), interactionCls))
      : null
    const kept = removed
      ? own.split(/\s+/).filter(Boolean).filter((t) => !removed.has(t)).join(' ')
      : own
    return [
      // the body fills its frame/viewport column
      node.value.type === 'body' && 'flex-1',
      kept,
      interactionCls,
      // background media makes the host relative (video layer) / applies bg image
      backgroundInfo.value?.hostClass,
    ]
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

  // ready-made hover handlers — renderers spread these into their own
  // handlers object; click stays per-renderer (selection/nav differ)
  const hoverHandlers = {
    mouseenter() {
      for (const interaction of ofTrigger('hover')) fireIn(interaction.id)
    },
    mouseleave() {
      for (const interaction of ofTrigger('hover')) unfireIn(interaction.id)
    },
  }
  function fireClickInteractions() {
    for (const interaction of ofTrigger('click')) toggleIn(interaction.id)
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
    contentInfo,
    displayContent,
    richContent,
    srcInfo,
    srcAttr,
    altAttr,
    linkRaw,
    baseClasses,
    ofTrigger,
    fireIn,
    unfireIn,
    toggleIn,
    hoverHandlers,
    fireClickInteractions,
    el,
  }
}
