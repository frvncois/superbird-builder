<script setup lang="ts">
import { computed } from 'vue'
import { useElement } from '@/composables/useElement'
import { useReorderAnimation } from '@/composables/useReorderAnimation'
import EntryScope from '@/components/shared/EntryScope.vue'
import { useInteraction } from '@/composables/useInteraction'
import { useContextMenu } from '@/composables/useContextMenu'
import { useLocale } from '@/composables/useLocale'
import { useRenderNode } from '@/composables/useRenderNode'
import { useInlineEdit } from '@/composables/useInlineEdit'
import { useMedia } from '@/composables/useMedia'
import { useCollections } from '@/composables/useCollections'
import { useConditions } from '@/composables/useConditions'
import { refDisplay } from '@/lib/shared/fields.js'
import { isRich, sanitizeRich } from '@/lib/shared/richtext.js'
import type { ElementNode } from '@/types/editor'

const props = defineProps<{ node: ElementNode }>()

const { selectedElement, selectedElementIds, selectElement, draggingId, dropTarget, highlightedElement, requestEditorFocus } = useElement()
const { canvasReorder } = useReorderAnimation()
const { pickingFor, pickTarget } = useInteraction()
const { openMenu } = useContextMenu()
const { nodeContent, nodeSrc, entryValue, setNodeContent, setEntryValue } = useLocale()

// shared rendering core (also used by the public site's PublicRenderer):
// def/mapping, collection + entry-scope resolution, interaction firing,
// and the scroll-into-view observer (bound via ref="el")
const {
  def,
  mapping,
  classesFor,
  scopedClassesFor,
  listCollection,
  listEntries,
  itemCollection,
  itemEntry,
  itemTemplateChildren,
  selfNested,
  boundField,
  boundEntry,
  condition,
  backgroundInfo,
  ofTrigger,
  fireIn,
  unfireIn,
  toggleIn,
  el,
} = useRenderNode(() => props.node)

// locale-aware reads: same precedence as before, but each source is
// resolved through the active locale; `untranslated` marks a real
// default-locale value shown as fallback under a non-default locale
const { collections } = useCollections()
const { previewConditions } = useConditions()

// hidden-by-condition elements stay on the canvas dimmed (still editable);
// the Data panel's preview toggle fully hides them like the published site
const conditionHidden = computed(() => !condition.value.visible)
const suppressed = computed(() => conditionHidden.value && previewConditions.value)

const contentInfo = computed<{ value: string | undefined; untranslated: boolean }>(() => {
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
      return { value: `{${boundField.value.name}}`, untranslated: false }
    }
    const info = boundEntry.value ? entryValue(boundEntry.value, boundField.value.name) : null
    if (info?.value) return { value: info.value, untranslated: !info.translated }
    return { value: `{${boundField.value.name}}`, untranslated: false }
  }
  const own = nodeContent(props.node)
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

const srcInfo = computed<{ value: string | undefined; untranslated: boolean }>(() => {
  if (condition.value.src) return { value: condition.value.src, untranslated: false }
  if (boundField.value?.type === 'image') {
    const info = boundEntry.value ? entryValue(boundEntry.value, boundField.value.name) : null
    if (info?.value) return { value: info.value, untranslated: !info.translated }
  }
  const own = nodeSrc(props.node)
  return { value: own.value || undefined, untranslated: !!own.value && !own.translated }
})
const srcAttr = computed(() => srcInfo.value.value)
// images carry the library asset's default alt (no per-node alt field yet)
const altAttr = computed(() =>
  def.value?.tag === 'img' ? (useMedia().assetForSrc(srcAttr.value)?.alt ?? '') : undefined,
)

const untranslated = computed(
  () =>
    (!props.node.children.length && contentInfo.value.untranslated) || srcInfo.value.untranslated,
)

const titleAttr = computed(() =>
  conditionHidden.value ? 'Hidden by condition' : untranslated.value ? 'Not translated' : undefined,
)

const selected = computed(() =>
  selectedElementIds.value.length
    ? selectedElementIds.value.includes(props.node.id)
    : selectedElement.value?.id === props.node.id,
)
// a transient preview highlight (e.g. an interaction's Target hover), shown in a
// distinct colour and only when this node isn't already the live selection
const highlighted = computed(
  () => highlightedElement.value?.id === props.node.id && !selected.value,
)

const classes = computed(() => [
  // the body covers its whole breakpoint frame by default
  props.node.type === 'body' && 'flex-1',
  // text-selection guard: only elements actually showing text content
  // are selectable; containers and chrome stay select-none
  !def.value?.void &&
    !props.node.children.length &&
    !['body', 'collection-list', 'collection-item'].includes(props.node.type) &&
    'select-text',
  mapping.value ? mapping.value.master.classes : props.node.classes,
  mapping.value
    ? scopedClassesFor(mapping.value.master.id, mapping.value.root, mapping.value.instanceId)
    : classesFor(props.node.id),
  // background media makes the host relative (video layer) / applies bg image
  backgroundInfo.value?.hostClass,
  // untranslated fallback content renders dimmed under a non-default locale
  untranslated.value && 'opacity-60',
  // hidden-by-condition elements dim harder but stay editable
  conditionHidden.value && 'opacity-30',
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

// text-content elements only; bound elements need an entry to write to —
// and a reference bind isn't text, it's picked in the Data panel
const editableText = computed(
  () =>
    def.value?.defaultContent !== undefined &&
    !props.node.children.length &&
    (!boundField.value ||
      (!!boundEntry.value && !['reference', 'multi-reference'].includes(boundField.value.type))),
)

// already-rich content keeps its formatting while inline-editing
const richEditing = computed(() => richContent.value !== null)

const { editing, editEl, startEditing, finishEditing, onEditKeydown } = useInlineEdit({
  editable: editableText,
  rich: richEditing,
  // a {field} placeholder starts empty; everything else starts from the
  // displayed text, so translating edits begin from the fallback
  initialText: () => {
    const placeholder =
      !!boundField.value &&
      !!boundEntry.value &&
      !entryValue(boundEntry.value, boundField.value.name).value
    return placeholder ? '' : (displayContent.value ?? '')
  },
  commit: (text) => {
    if (boundField.value && boundEntry.value) {
      setEntryValue(boundEntry.value, boundField.value.name, text)
    } else {
      setNodeContent(props.node, text)
    }
  },
  escBehavior: 'cancel',
  onExit: () => requestEditorFocus(), // Esc/Enter returns the caret to the code editor line
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
    for (const interaction of ofTrigger('click')) toggleIn(interaction.id)
    selectElement(props.node.id)
    requestEditorFocus() // land the caret on this element's line in the code editor
  },
  contextmenu(e: MouseEvent) {
    e.stopPropagation()
    openMenu(e, props.node.id)
  },
  mouseenter() {
    for (const interaction of ofTrigger('hover')) fireIn(interaction.id)
  },
  mouseleave() {
    for (const interaction of ofTrigger('hover')) unfireIn(interaction.id)
  },
  dragstart(e: DragEvent) {
    if (props.node.type === 'body') return
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
      canvasReorder(draggingId.value, props.node.id, dropTarget.value.position)
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
  <template v-if="!suppressed">
  <!-- repeats its children (the inline item template) once per entry -->
  <component
    :is="def?.tag ?? 'div'"
    v-if="node.type === 'collection-list'"
    ref="el"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :class="classes"
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

  <!-- one picked entry rendered through its collection's template -->
  <component
    :is="def?.tag ?? 'div'"
    v-else-if="node.type === 'collection-item'"
    ref="el"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :class="classes"
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

  <component
    :is="def?.tag ?? 'div'"
    v-else-if="def?.void"
    ref="el"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :title="titleAttr"
    :src="srcAttr"
    :alt="altAttr"
    :class="classes"
    draggable="true"
    v-on="handlers"
  />
  <component
    :is="def?.tag ?? 'div'"
    v-else
    ref="el"
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :title="titleAttr"
    :src="srcAttr"
    :alt="altAttr"
    :class="[
      classes,
      editing && 'cursor-text outline outline-2 -outline-offset-2 outline-accent bg-accent/5',
    ]"
    :style="backgroundInfo?.style || undefined"
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
</template>
