<script setup lang="ts">
// The project's saved effects, for either half of the Interactions panel —
// the interaction library and the animation library are the same list with
// different data behind it.
//
// Deliberately dumb: it takes items and predicates and emits intent. It must
// never import useInteraction/useAnimation or branch on which half it is
// serving — at that point it would be a worse version of two components.
import { ref } from 'vue'
import { CircleAlert, Trash2 } from 'lucide-vue-next'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'

const props = defineProps<{
  label: string
  items: { id: string; name: string }[]
  /** shown when the library is empty */
  emptyText: string
  /** singular, lowercase — used in the delete tooltip and confirm copy */
  noun: string
  isApplied: (id: string) => boolean
  usageCount: (id: string) => number
  /** false when nothing is selected: the library still reads and edits, but
   * there is nothing to apply to */
  canApply: boolean
  /** validation message for an item, if it has one */
  errorFor?: (id: string) => string | null
}>()

const emit = defineEmits<{
  open: [id: string]
  apply: [id: string]
  remove: [id: string]
}>()

/** two-step inline confirm, local so each library confirms independently */
const pendingDelete = ref<string | null>(null)

function confirmRemove(id: string) {
  emit('remove', id)
  pendingDelete.value = null
}
</script>

<template>
  <GroupPopover :label="label">
    <p v-if="!items.length" class="text-xs text-muted-foreground">{{ emptyText }}</p>
    <!-- a disabled button emits no mouseenter, so an explanatory tooltip on
         Apply would never show — say it once, here, instead -->
    <p v-else-if="!canApply" class="text-[10px] text-muted-foreground">
      Select an element to apply these.
    </p>

    <div v-for="item in items" :key="item.id" class="flex flex-col gap-1">
      <div class="flex items-center gap-1.5">
        <!-- the row name IS the edit affordance; a third icon button per row
             would crowd a 336px panel, but a bare name doesn't look clickable,
             so it gets the hover label -->
        <button
          v-tooltip="`Edit ${noun}`"
          type="button"
          class="min-w-0 flex-1 truncate rounded text-left text-xs outline-none hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-accent"
          @click="emit('open', item.id)"
        >
          {{ item.name }}
        </button>
        <CircleAlert
          v-if="props.errorFor?.(item.id)"
          v-tooltip="props.errorFor(item.id)!"
          class="size-3.5 shrink-0 text-danger"
        />
        <ButtonUI
          variant="outline"
          size="xs"
          :disabled="!canApply || isApplied(item.id)"
          @click="emit('apply', item.id)"
        >
          {{ isApplied(item.id) ? 'Applied' : 'Apply' }}
        </ButtonUI>
        <ButtonUI
          variant="ghost"
          size="xs"
          :icon="Trash2"
          :tooltip="`Delete ${noun}`"
          class="text-muted-foreground"
          @click="pendingDelete = item.id"
        />
      </div>

      <div
        v-if="pendingDelete === item.id"
        class="flex items-center gap-1.5 pl-1 text-[10px] text-muted-foreground"
      >
        <span class="flex-1">
          Delete from {{ usageCount(item.id) }} element{{ usageCount(item.id) === 1 ? '' : 's' }}?
        </span>
        <ButtonUI variant="ghost" size="xs" @click="pendingDelete = null">Cancel</ButtonUI>
        <ButtonUI variant="outline" size="xs" class="text-danger" @click="confirmRemove(item.id)">
          Delete
        </ButtonUI>
      </div>
    </div>

    <div class="pt-1">
      <slot name="actions" />
    </div>
  </GroupPopover>
</template>
