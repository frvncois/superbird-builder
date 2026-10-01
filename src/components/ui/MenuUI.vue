<script setup lang="ts">
import { type Component } from 'vue'
import { MoreHorizontal } from 'lucide-vue-next'
import { useDropdown } from '@/composables/useDropdown'

const props = withDefaults(
  defineProps<{
    icon?: Component
    align?: 'left' | 'right'
    side?: 'top' | 'bottom'
    width?: string
    triggerClass?: string
    disabled?: boolean
  }>(),
  {
    align: 'right',
    side: 'bottom',
    width: 'w-44',
    triggerClass:
      'flex size-7 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-accent',
    disabled: false,
  },
)

const triggerIcon = props.icon ?? MoreHorizontal

const { open, root, toggle, close } = useDropdown({ escape: true })
</script>

<template>
  <div ref="root" :data-open="open || undefined" class="relative shrink-0">
    <button type="button" :class="triggerClass" :disabled="disabled" @click="toggle">
      <slot name="trigger">
        <component :is="triggerIcon" class="size-3.5" />
      </slot>
    </button>
    <div
      v-if="open"
      class="absolute z-50 flex flex-col rounded-xl border border-input bg-background p-1 shadow-lg"
      :class="[
        align === 'right' ? 'right-0' : 'left-0',
        side === 'top' ? 'bottom-full mb-1' : 'top-full mt-1',
        width,
      ]"
    >
      <slot :close="close" />
    </div>
  </div>
</template>
