import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { ELEMENTS } from '@/lib/elements'
import { usePage } from './usePage'
import { useCollections } from './useCollections'
import { useInteraction } from './useInteraction'
import { useComponents } from './useComponents'
import { entryKey } from '@/components/editor/EntryScope.vue'
import type { ElementNode } from '@/types/editor'

/**
 * The rendering core shared VERBATIM by the editor's ElementRenderer and
 * the published site's PublicRenderer: element/tag resolution, component
 * master mapping, collection/entry-scope resolution, interaction firing,
 * and the scroll-into-view observer. Each renderer keeps its own content
 * precedence, class composition, links and event handlers on top.
 */
export function useRenderNode(getNode: () => ElementNode) {
  const node = computed(getNode)

  const { fire, unfire, toggle, fireScoped, unfireScoped, toggleScoped, classesFor, scopedClassesFor } =
    useInteraction()
  const { masterFor } = useComponents()
  const { pages } = usePage()
  const { collectionByName, activeCollection, activeEntry, fieldFor } = useCollections()

  const def = computed(() => ELEMENTS[node.value.type])

  // inside a component instance block, style/interactions come from the
  // shared master node; content stays this node's own
  const mapping = computed(() => masterFor(node.value.id))

  // --- collections / entry scope ---

  const scope = inject(entryKey, null)

  const listCollection = computed(() =>
    node.value.type === 'collection-list' && node.value.arg ? collectionByName(node.value.arg) : null,
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

  // a node bound to a field (:h1(title):) shows the entry's value —
  // from the surrounding list/item scope, or the template's active entry
  const boundCollection = computed(() => scope?.collection ?? activeCollection.value)
  const boundField = computed(() => fieldFor(boundCollection.value, node.value.arg))
  const boundEntry = computed(() => (scope ? scope.entry : activeEntry.value))

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
    itemCollection,
    itemEntry,
    itemTemplateChildren,
    selfNested,
    boundCollection,
    boundField,
    boundEntry,
    ofTrigger,
    fireIn,
    unfireIn,
    toggleIn,
    el,
  }
}
