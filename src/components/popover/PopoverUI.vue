<script setup lang="ts">
import { type Component } from 'vue'
import { useInsertDrag } from '@/composables/useInsertDrag'
import { useDropdown } from '@/composables/useDropdown'
import ButtonUI from '@/components/ui/ButtonUI.vue'

withDefaults(
  defineProps<{
    /** trigger icon for the default button; omit when providing a #trigger slot */
    icon?: Component
    title?: string
    /** tailwind width class for the floating panel */
    width?: string
  }>(),
  { width: 'w-56' },
)

// a palette drag must not close the popover: not on the release click
// outside, and not when Esc cancels the drag
const { payload: insertDrag, suppressNextClick } = useInsertDrag()

const { open, root, toggle, close } = useDropdown({
  escape: true,
  suppressClick: suppressNextClick,
  blockEscape: insertDrag,
})
</script>

<template>
  <div ref="root" class="relative inline-flex">
    <slot name="trigger" :open="open" :toggle="toggle">
      <ButtonUI
        :icon="icon"
        variant="outline"
        :title="title"
        @click="toggle"
      />
    </slot>

    <div
      v-if="open"
      class="absolute top-full left-0 z-50 mt-1 rounded-xl border border-input bg-background p-1 shadow-md"
      :class="width"
    >
      <slot :close="close" />
    </div>
  </div>
</template>
