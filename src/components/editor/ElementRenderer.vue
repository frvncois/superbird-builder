<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useElement } from '@/composables/useElement'
import EntryScope from './EntryScope.vue'
import { useInteraction } from '@/composables/useInteraction'
import { useContextMenu } from '@/composables/useContextMenu'
import { useLocale } from '@/composables/useLocale'
import { useRenderNode } from '@/composables/useRenderNode'
import type { ElementNode } from '@/types/editor'

const props = defineProps<{ node: ElementNode }>()

const { selectedElement, selectElement, draggingId, dropTarget, reorderElement } = useElement()
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

// locale-aware reads: same precedence as before, but each source is
// resolved through the active locale; `untranslated` marks a real
// default-locale value shown as fallback under a non-default locale
const contentInfo = computed<{ value: string | undefined; untranslated: boolean }>(() => {
  if (boundField.value) {
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

const srcInfo = computed<{ value: string | undefined; untranslated: boolean }>(() => {
  if (boundField.value?.type === 'image') {
    const info = boundEntry.value ? entryValue(boundEntry.value, boundField.value.name) : null
    if (info?.value) return { value: info.value, untranslated: !info.translated }
  }
  const own = nodeSrc(props.node)
  return { value: own.value || undefined, untranslated: !!own.value && !own.translated }
})
const srcAttr = computed(() => srcInfo.value.value)

const untranslated = computed(
  () =>
    (!props.node.children.length && contentInfo.value.untranslated) || srcInfo.value.untranslated,
)

const selected = computed(() => selectedElement.value?.id === props.node.id)

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
  // untranslated fallback content renders dimmed under a non-default locale
  untranslated.value && 'opacity-60',
  selected.value && 'outline outline-2 -outline-offset-2 outline-sky-500',
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

const editing = ref(false)
let editStart = ''

// text-content elements only; bound elements need an entry to write to
const editableText = computed(
  () =>
    def.value?.defaultContent !== undefined &&
    !props.node.children.length &&
    (!boundField.value || !!boundEntry.value),
)

// while editing, a dedicated <span> is mounted that Vue renders EMPTY —
// its text is managed only by the browser/us, so Vue's fragment anchors
// for the interpolation and child renderers are never destroyed
const editEl = ref<HTMLElement>()

function startEditing(e: Event) {
  if (!editableText.value || editing.value) return
  e.stopPropagation()
  e.preventDefault()
  editing.value = true
  // a {field} placeholder starts empty; everything else starts from the
  // displayed text, so translating edits begin from the fallback
  const placeholder =
    !!boundField.value &&
    !!boundEntry.value &&
    !entryValue(boundEntry.value, boundField.value.name).value
  const initial = placeholder ? '' : (displayContent.value ?? '')
  nextTick(() => {
    const target = editEl.value
    if (!target) return
    target.textContent = initial
    editStart = initial
    target.focus()
    const range = document.createRange()
    range.selectNodeContents(target)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  })
}

function finishEditing(cancel: boolean) {
  if (!editing.value) return
  const text = editEl.value?.textContent ?? ''
  editing.value = false // unmounts the span (and our manual text with it)
  if (cancel || text === editStart) return
  if (boundField.value && boundEntry.value) {
    setEntryValue(boundEntry.value, boundField.value.name, text)
  } else {
    setNodeContent(props.node, text)
  }
}

function onEditKeydown(e: KeyboardEvent) {
  // keep editor-wide shortcuts (undo, panels, Esc handlers) out of the session
  e.stopPropagation()
  if (e.key === 'Enter') {
    e.preventDefault()
    finishEditing(false)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    finishEditing(true)
  }
}

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
      reorderElement(draggingId.value, props.node.id, dropTarget.value.position)
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
    :id="node.htmlId || undefined"
    :data-node-id="node.id"
    :class="classes"
    draggable="true"
    v-on="handlers"
  >
    <template v-if="listCollection">
      <template v-if="listCollection.entries.length">
        <EntryScope
          v-for="entry in listCollection.entries"
          :key="entry.id"
          :collection="listCollection"
          :entry="entry"
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
    :title="untranslated ? 'Not translated' : undefined"
    :src="srcAttr"
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
    :title="untranslated ? 'Not translated' : undefined"
    :src="srcAttr"
    :class="[classes, editing && 'cursor-text']"
    :draggable="!editing"
    v-on="handlers"
  >
    <template v-if="!node.children.length && !editing">
      {{ displayContent }}
    </template>
    <span
      v-if="editing"
      ref="editEl"
      contenteditable="plaintext-only"
      class="outline-none"
      @blur="finishEditing(false)"
      @keydown="onEditKeydown"
    ></span>
    <ElementRenderer v-for="child in node.children" :key="child.id" :node="child" />
  </component>
</template>
