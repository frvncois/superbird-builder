import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { ELEMENTS } from '@/lib/elements'
import { usePage } from './usePage'
import { useCollections } from './useCollections'
import { useInteraction } from './useInteraction'
import { useComponents } from './useComponents'
import { useAnimation, animBindingActiveAt, scopedAnimBindings } from './useAnimation'
import { useMotion } from './useMotion'
import { appearRootMargin, composeMotionStyle, effectiveAppearMode } from '@/lib/motion'
import { useProject } from './useProject'
import { FRAME_BREAKPOINT } from '@/components/editor/canvas/frameScope'
import { entryKey } from '@/components/shared/EntryScope.vue'
import { refDisplay, resolveBinding, resolveListScope, applyListQuery, mediaUrls } from '@/lib/shared/fields.js'
import { isRich, sanitizeRich } from '@/lib/shared/richtext.js'
import { backgroundRender, backgroundKindFromUrl } from '@/lib/shared/background.js'
import { conflictingBaseClasses } from '@/lib/shared/interactionClasses.js'
import { resolveSliderConfig, sliderTrackClasses, sliderWireData } from '@/lib/shared/slider.js'
import { useMedia, kindOfMime } from './useMedia'
import { sanitizeAttributes, withSafeRel } from '@/lib/shared/attributes.js'
import { DEFAULT_SCROLL_AT } from '@/lib/shared/interactionKeys.js'
import { useLocale } from './useLocale'
import { SAFE_SRC } from '@/lib/shared/urls.js'
import type {
  CollectionEntry,
  ElementNode,
  InteractionBinding,
  InteractionTrigger,
} from '@/types/editor'

/** a resolved content/src value; `untranslated` marks a default-locale
 * fallback rendered under a non-default locale (the editor dims these) */
export interface LocalizedDisplay {
  value: string | undefined
  untranslated: boolean
}

/** child id → parent node for the active page — one shared O(tree) index per
 * structural change, instead of every rendered node running its own
 * findParent walk (that made motion ticks O(nodes²) across the canvas) */
const parentIndex = computed(() => {
  const map = new Map<string, ElementNode>()
  const visit = (nodes: ElementNode[], parent: ElementNode | null) => {
    for (const n of nodes) {
      if (parent) map.set(n.id, parent)
      visit(n.children, n)
    }
  }
  visit(usePage().activePage.value.elements, null)
  return map
})

/**
 * The rendering core shared VERBATIM by the editor's ElementRenderer and
 * Preview's PreviewRenderer (the published site is static HTML from
 * server/export.mjs, which mirrors this logic): element/tag resolution,
 * component master mapping, collection/entry-scope resolution, interaction
 * firing, the scroll-into-view observer, and the content/src/rich/link
 * resolution (bound field → own → mapped master → element
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

  const {
    applyBinding,
    bindingStateKey,
    classesFor,
    scopedClassesFor,
    targetStateKeys,
    scopedTargetStateKeys,
    registerInteractionEl,
    unregisterInteractionEl,
  } = useInteraction()
  const { masterFor } = useComponents()
  const { pages, activePage } = usePage()
  const { project, liveBreakpointId } = useProject()
  /** site-wide default for appear bindings that don't set their own mode */
  const siteAppearMode = computed(() => project.value.settings?.motion?.appearMode)

  // the breakpoint this node is rendered for — the frame's id in the multi-frame
  // canvas, else the live viewport (Preview / published site). Drives which
  // breakpoint-scoped interactions contribute their classes.
  const frameBreakpointId = inject(FRAME_BREAKPOINT, null)
  const renderBreakpointId = computed(() => frameBreakpointId ?? liveBreakpointId.value)
  /** the fixed width of the canvas frame this node renders in, null outside the
   * multi-frame canvas (Preview and the published site have a real viewport) */
  const frameWidth = computed(
    () => project.value.breakpoints.find((b) => b.id === frameBreakpointId)?.width ?? null,
  )
  const { collections, collectionByName, activeCollection, activeEntry, entryPath } = useCollections()
  const { nodeContent, nodeSrc, entryValue, setNodeContent, setEntryValue } = useLocale()
  const { assetForSrc } = useMedia()

  const def = computed(() => ELEMENTS[node.value.type])

  // inside a component instance block, style/interactions come from the
  // shared master node; content stays this node's own
  const mapping = computed(() => masterFor(node.value.id))

  // --- collections / entry scope ---

  const scope = inject(entryKey, null)

  // a list arg names a collection (all entries), a multi-reference field of
  // the surrounding scope entry (the referenced entries), or a multi-image
  // field (one synthetic entry per stored image url).
  // A :slider repeats the same way, but its arg is optional — without one it
  // resolves to null and each direct child is a slide instead.
  const listScope = computed(() =>
    node.value.type === 'collection-list' || node.value.type === 'slider'
      ? resolveListScope(
          collections.value,
          scope?.collection ?? activeCollection.value,
          scope?.entry ?? activeEntry.value,
          node.value.arg,
          pages.value,
        )
      : null,
  )
  const listCollection = computed(() => listScope.value?.collection ?? null)
  const listEntries = computed<CollectionEntry[]>(() =>
    applyListQuery(listScope.value?.entries ?? [], node.value.listQuery, {
      // for the @pages source the synthetic entry ids ARE page ids, so
      // excludeCurrent means "every page except this one" for free
      currentEntryId:
        listScope.value?.collection.id === '@pages'
          ? activePage.value.id
          : (scope?.entry ?? activeEntry.value)?.id,
    }),
  )
  // --- slider (carousel) ---

  const isSlider = computed(() => node.value.type === 'slider')
  /** the slider's own config — per-instance node state, like listQuery, so it
   * is read off the node itself and never redirected to a component master */
  const sliderConfig = computed(() => (isSlider.value ? node.value.slider : undefined))
  /** true when the arg binds a real source, so slides come from entries */
  const sliderBound = computed(() => isSlider.value && !!listCollection.value)
  const sliderTrackClass = computed(() =>
    sliderTrackClasses(sliderConfig.value, project.value.breakpoints, {
      // canvas frames are fixed-width elements, so real max-width media
      // queries can't fire in them — resolve the cascade to a flat value
      ...(frameWidth.value !== null ? { width: frameWidth.value } : {}),
    }),
  )
  const sliderResolved = computed(() =>
    resolveSliderConfig(sliderConfig.value, project.value.breakpoints),
  )
  const sliderWire = computed(() => sliderWireData(sliderConfig.value))

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

  // --- custom attributes (allowlisted; master-aware like style/classes) ---
  // withSafeRel mirrors the exporter: target="_blank" always carries a rel, so
  // the Data panel shows the same attribute set the published page will have
  const customAttrs = computed(() => {
    const own = withSafeRel(
      sanitizeAttributes((mapping.value ? mapping.value.master : node.value).attributes ?? {}),
    )
    // attributes the element TYPE implies (:checkbox → type="checkbox"); the
    // author's own value always wins
    const attrs: Record<string, string> = { ...(def.value?.attrs ?? {}), ...own }
    // aria-current marks the link pointing at the page being rendered — the
    // hook the `current:` variant styles. It has to come from the rendered
    // route, since a shared component's master cannot know which page its
    // instance is on. Mirrors ariaCurrentFor in server/export.mjs.
    if (isCurrentLink.value && !attrs['aria-current']) attrs['aria-current'] = 'page'
    return attrs
  })

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
      // a multi-image field holds an array of urls — never text. Bound to a
      // text element it shows the placeholder, not a stringified array.
      if (boundField.value.type === 'multi-image') {
        return { value: opts?.fieldPlaceholders ? `{${boundField.value.name}}` : '', untranslated: false }
      }
      const info = boundEntry.value ? entryValue(boundEntry.value, boundField.value) : null
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
    // a multi-image field bound straight to one :image (outside a
    // :collection-list) renders its FIRST url — the cover-image case
    if (boundField.value?.type === 'multi-image') {
      const first = boundEntry.value ? mediaUrls(boundEntry.value, boundField.value.name)[0] : undefined
      if (first) return { value: first, untranslated: false }
    }
    if (boundField.value?.type === 'image') {
      const info = boundEntry.value ? entryValue(boundEntry.value, boundField.value) : null
      if (info?.value) return { value: info.value, untranslated: !info.translated }
    }
    const own = nodeSrc(node.value)
    if (own.value) return { value: own.value, untranslated: !own.translated }
    // inside a component instance, fall back to the mapped master's src —
    // same own-then-master precedence as content, so shared chrome (a logo)
    // is set once on the master and renders in every instance
    const master = mapping.value ? nodeSrc(mapping.value.master) : null
    if (master?.value) return { value: master.value, untranslated: !master.translated }
    return { value: undefined, untranslated: false }
  })
  const srcAttr = computed(() => {
    const v = srcInfo.value.value
    return v && SAFE_SRC.test(v) ? v : undefined
  })

  // images carry alt: the author's attributes.alt wins over the library
  // asset's default (mirrors the static exporter)
  const altAttr = computed(() =>
    def.value?.tag === 'img'
      ? (customAttrs.value.alt ?? assetForSrc(srcAttr.value)?.alt ?? '')
      : undefined,
  )

  // --- inline text editing (shared by both renderers) ---
  //
  // Which elements can be text-edited, and what an edit reads from and writes
  // to, is the same question in Build and Preview — only the gesture and the
  // Esc behaviour differ, and those stay in the renderers. Duplicating this
  // meant the field-type rules had to be kept in step by hand.

  /** text-content elements only; a bound element needs an entry to write to —
   * and a reference bind isn't text, it's picked in the Data panel */
  const editableText = computed(
    () =>
      def.value?.defaultContent !== undefined &&
      !node.value.children.length &&
      (!boundField.value ||
        (!!boundEntry.value && !['reference', 'multi-reference'].includes(boundField.value.type))),
  )

  /** already-rich content keeps its formatting while inline-editing */
  const richEditing = computed(() => richContent.value !== null)

  /** a {field} placeholder starts empty; everything else starts from the
   * displayed text, so translating edits begin from the fallback */
  function inlineInitialText() {
    const placeholder =
      !!boundField.value &&
      !!boundEntry.value &&
      !entryValue(boundEntry.value, boundField.value).value
    return placeholder ? '' : (displayContent.value ?? '')
  }

  /** a bound element writes the entry field; everything else its own content */
  function commitInlineText(text: string) {
    if (boundField.value && boundEntry.value) {
      setEntryValue(boundEntry.value, boundField.value.name, text)
    } else {
      setNodeContent(node.value, text)
    }
  }

  // --- links ---

  // any element with a link navigates — not just <a>. '@item' resolves to
  // the current entry's page and is inert outside an entry scope. Same
  // scheme allowlist the static export enforces — drops javascript:,
  // data:, etc. Renderers turn the raw value into their own href/nav.
  const linkRaw = computed(() => {
    let raw = node.value.link ?? mapping.value?.master.link
    if (raw === '@item') {
      if (!scope?.entry) return null
      // null for a data-only collection (no detail routes) — render unlinked
      // rather than pointing at a route that was never exported
      raw = entryPath(scope.collection, scope.entry) ?? undefined
    }
    if (!raw) return null
    if (!/^(\/|#|https?:|mailto:|tel:)/i.test(raw)) return null
    return raw
  })

  /** does this element's link point at the page currently being rendered? */
  const isCurrentLink = computed(() => {
    const raw = linkRaw.value
    if (!raw || !raw.startsWith('/')) return false
    const entry = scope?.entry ?? activeEntry.value
    const collection = scope?.collection ?? activeCollection.value
    const here = entry && collection ? entryPath(collection, entry) : activePage.value.path
    return !!here && raw === here
  })

  // --- classes (shared core; renderers append their own chrome) ---

  const baseClasses = computed(() => {
    const own = (mapping.value ? mapping.value.master.classes : node.value.classes) ?? ''
    const interactionCls = mapping.value
      ? scopedClassesFor(
          mapping.value.master.id,
          mapping.value.root,
          motionScope.value ?? mapping.value.instanceId,
          renderBreakpointId.value,
        )
      : classesFor(node.value.id, renderBreakpointId.value, motionScope.value)
    // parity with the published runtime (int-fxrm): own classes styling the
    // same property as an active interaction's classes are REMOVED, not
    // outweighed — the cascade would pick an arbitrary winner (hidden+flex)
    const removed = interactionCls
      ? new Set(conflictingBaseClasses(own.split(/\s+/).filter(Boolean), interactionCls))
      : null
    const kept = removed
      ? own.split(/\s+/).filter(Boolean).filter((t) => !removed.has(t)).join(' ')
      : own
    // a bare component :Name wrapper is a logical grouping — render it
    // layout-transparent (display:contents) so it adds no box, matching the
    // static export which emits no wrapper element at all. A styled/interactive
    // wrapper stays a real box.
    const bareComponentRoot =
      /^[A-Z]/.test(node.value.type) &&
      !own.trim() &&
      !interactionCls &&
      !(mapping.value ? mapping.value.master.animations : node.value.animations)?.length &&
      !backgroundInfo.value
    return [
      // the body fills its frame/viewport column
      node.value.type === 'body' && 'flex-1',
      bareComponentRoot && 'contents',
      kept,
      interactionCls,
      // background media makes the host relative (video layer) / applies bg image
      backgroundInfo.value?.hostClass,
    ]
  })

  // --- animations (tween engine) ---

  const { animationFor, animTargetIndex } = useAnimation()
  const motion = useMotion()

  /** The scope that isolates one rendering of this node from its siblings:
   * the component instance AND the collection-list repeat. Without the entry
   * part, hovering one card fires every repeat and an "appear once" animation
   * plays for the whole list at once. Mirrors the export's key scope. */
  const motionScope = computed(() =>
    [mapping.value?.instanceId, scope?.entry ? `e${scope.entry.id}` : null]
      .filter(Boolean)
      .join('~') || undefined,
  )

  /** animation bindings this node TRIGGERS (master-aware, like ofTrigger) */
  const animTriggers = computed(
    () => (mapping.value ? mapping.value.master.animations : node.value.animations) ?? [],
  )

  /** animation bindings whose animation MOVES this node */
  const animTargets = computed(() =>
    mapping.value
      ? scopedAnimBindings(mapping.value.master.id, mapping.value.root)
      : (animTargetIndex.value.get(node.value.id) ?? []),
  )

  /** the node's own animated values (element-moving tracks only) */
  const ownMotionValues = computed(() =>
    animTargets.value.length ? motion.valuesForNode(node.value.id, motionScope.value) : undefined,
  )

  /** values this node inherits as the Nth child of a STAGGERED parent —
   * only staggered tracks cascade, so one timeline can move the container
   * and stagger its children at the same time */
  const inheritedMotionValues = computed(() => {
    const parent = parentIndex.value.get(node.value.id)
    if (!parent) return undefined
    // inside a component instance the play is keyed on the MASTER's parent
    const parentTargetId = masterFor(parent.id)?.master.id ?? parent.id
    // gate BEFORE staggerValuesFor: only children of an actually-staggering
    // parent subscribe to the frame clock — otherwise every node on the page
    // recomputes (and walked the tree) on every animation frame
    if (!motion.staggeredTargets.value.has(parentTargetId)) return undefined
    const index = parent.children.indexOf(node.value)
    if (index === -1) return undefined
    return motion.staggerValuesFor(parentTargetId, index, motionScope.value)
  })

  /** inline style for the frame currently being rendered */
  const motionStyle = computed(() => {
    const own = ownMotionValues.value
    const inherited = inheritedMotionValues.value
    if (!own && !inherited) return undefined
    return composeMotionStyle({ ...(inherited ?? {}), ...(own ?? {}) })
  })

  // Build's breakpoint frames are an EDITING surface: animation bindings never
  // auto-fire there (no load/appear entrances, no hover/click tweens, no
  // marquees looping under the editor). They play in Preview and on the
  // published site; the Animations panel's explicit ▶ preview still works in
  // Build because it bypasses the triggers (motion.preview renders through
  // motionStyle regardless).
  const isCanvasFrame = frameBreakpointId !== null

  const animOf = (trigger: string) =>
    isCanvasFrame
      ? []
      : animTriggers.value.filter(
          (b) => b.trigger === trigger && animBindingActiveAt(b, renderBreakpointId.value),
        )

  /** resolves a binding's target node id — null means the trigger itself */
  const animTargetId = (binding: { targetId: string | null }) =>
    binding.targetId ?? (mapping.value ? mapping.value.master.id : node.value.id)

  function playAnim(binding: (typeof animTriggers.value)[number], reverse = false) {
    const animation = animationFor(binding.animationId)
    if (!animation) return
    motion.play(binding, animation, animTargetId(binding), {
      scope: motionScope.value,
      reverse,
    })
  }
  function toggleAnim(binding: (typeof animTriggers.value)[number]) {
    const animation = animationFor(binding.animationId)
    if (!animation) return
    motion.toggle(binding, animation, animTargetId(binding), motionScope.value)
  }

  // --- interactions ---

  const ofTrigger = (trigger: InteractionTrigger) =>
    ((mapping.value ? mapping.value.master.interactions : node.value.interactions) ?? []).filter(
      (i) => i.trigger === trigger,
    )

  /** bindings live on the master inside a component instance, so the state key's
   * "self target" is the master's id, not this instance node's */
  const interactionOwnerId = computed(() =>
    mapping.value ? mapping.value.master.id : node.value.id,
  )

  /** the component-instance part of the scope only. Exclusive groups key on this
   * and NOT on the collection-list repeat, so one accordion open at a time holds
   * across a list's items while two component instances stay independent. */
  const instanceScope = computed(() => mapping.value?.instanceId)

  /** apply a binding in this node's scope. `on` forces a direction; omitting it
   * honours the binding's action (toggle / on / off). */
  function applyIn(binding: InteractionBinding, on?: boolean) {
    applyBinding(binding, interactionOwnerId.value, motionScope.value, instanceScope.value, on)
  }

  // ready-made hover handlers — renderers spread these into their own
  // handlers object; click stays per-renderer (selection/nav differ)
  const hoverHandlers = {
    mouseenter() {
      for (const binding of ofTrigger('hover')) applyIn(binding, true)
      for (const binding of animOf('hover')) playAnim(binding)
    },
    mouseleave() {
      for (const binding of ofTrigger('hover')) applyIn(binding, false)
      // hover-out rewinds rather than cutting, so the element eases back
      for (const binding of animOf('hover')) motion.reverse(binding, motionScope.value)
    },
  }
  function fireClickInteractions() {
    for (const binding of ofTrigger('click')) applyIn(binding)
    for (const binding of animOf('click')) toggleAnim(binding)
  }

  /** a form control's 'change' trigger: on while checked / non-empty, so an
   * "Other" radio can reveal its text field */
  function fireChangeInteractions(event: Event) {
    const target = event.target as HTMLInputElement | HTMLSelectElement | null
    if (!target) return
    const on =
      'checked' in target && (target.type === 'checkbox' || target.type === 'radio')
        ? target.checked
        : !!target.value
    for (const binding of ofTrigger('change')) applyIn(binding, on)
  }

  // fire 'appear' interactions the first time the element scrolls into view
  const el = ref<HTMLElement>()
  let observer: IntersectionObserver | null = null
  /** appear animations that already played, so 'once' really means once */
  const appeared = new Set<string>()

  /** every state key this node participates in — the ones it triggers and the
   * ones whose effect lands on it. Registered so an outside-click dismissal can
   * tell a pointerdown inside an open menu from one outside it. */
  const involvedStateKeys = computed(() => {
    const triggered = (
      (mapping.value ? mapping.value.master.interactions : node.value.interactions) ?? []
    ).map((b) => bindingStateKey(b, interactionOwnerId.value, motionScope.value))
    const targeted = mapping.value
      ? scopedTargetStateKeys(
          mapping.value.master.id,
          mapping.value.root,
          motionScope.value ?? mapping.value.instanceId,
        )
      : targetStateKeys(node.value.id, motionScope.value)
    return [...new Set([...triggered, ...targeted])]
  })

  /** 'scrolled' bindings: on while the page is scrolled past their threshold.
   * A window listener, so it reflects real page scroll in Preview and on the
   * published site; the Build canvas pans instead of scrolling, where this is
   * inert by nature. */
  let scrollListener: (() => void) | null = null
  let registeredKeys: string[] = []

  onMounted(() => {
    // an appearAt threshold delays firing until the element's top has travelled
    // that far down the viewport (0.8 ≈ ScrollTrigger's 'top 80%'); the
    // published runtime uses the same rootMargin
    const at = animOf('appear').find((b) => b.appearAt)?.appearAt
    observer = new IntersectionObserver((entries) => {
      const inView = entries.some((entry) => entry.isIntersecting)
      if (inView) {
        // appear fires once and never unfires
        for (const binding of ofTrigger('appear')) applyIn(binding, true)
      }
      for (const binding of animOf('appear')) {
        // a binding without its own mode inherits the site default
        // (settings.motion.appearMode); the exporter resolves the same way
        const mode = effectiveAppearMode(binding.appearMode, siteAppearMode.value)
        if (inView) {
          // once: first entry only. replay: every entry.
          // reverse: plays in, rewinds out.
          if (mode === 'once' && appeared.has(binding.id)) continue
          appeared.add(binding.id)
          playAnim(binding)
        } else if (mode === 'reverse') {
          motion.reverse(binding, motionScope.value)
        }
      }
    }, at ? { rootMargin: appearRootMargin(at) } : undefined)
    if (el.value) observer.observe(el.value)
    // 'load' plays as soon as the element exists
    for (const binding of animOf('load')) playAnim(binding)

    if (el.value && involvedStateKeys.value.length) {
      registeredKeys = involvedStateKeys.value
      registerInteractionEl(registeredKeys, el.value)
    }

    const scrolled = ofTrigger('scrolled')
    if (scrolled.length) {
      scrollListener = () => {
        const y = window.scrollY
        for (const binding of scrolled) applyIn(binding, y > (binding.scrollAt ?? DEFAULT_SCROLL_AT))
      }
      window.addEventListener('scroll', scrollListener, { passive: true })
      scrollListener()
    }
  })
  onBeforeUnmount(() => {
    observer?.disconnect()
    if (scrollListener) window.removeEventListener('scroll', scrollListener)
    if (registeredKeys.length && el.value) unregisterInteractionEl(registeredKeys, el.value)
  })

  return {
    def,
    mapping,
    motionStyle,
    listCollection,
    listEntries,
    isSlider,
    sliderBound,
    sliderConfig,
    sliderResolved,
    sliderTrackClass,
    sliderWire,
    itemCollection,
    itemEntry,
    itemTemplateChildren,
    selfNested,
    boundField,
    boundEntry,
    customAttrs,
    backgroundInfo,
    contentInfo,
    displayContent,
    richContent,
    srcInfo,
    srcAttr,
    altAttr,
    editableText,
    richEditing,
    inlineInitialText,
    commitInlineText,
    linkRaw,
    baseClasses,
    hoverHandlers,
    fireClickInteractions,
    fireChangeInteractions,
    el,
  }
}
