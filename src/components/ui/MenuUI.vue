<script setup lang="ts">
import { type Component } from 'vue'
import { MoreHorizontal } from 'lucide-vue-next'
import { useDropdown } from '@/composables/useDropdown'

// Compact floating menu: a trigger (default = ⋯ icon button) opens a small
// panel of slotted items. Reused for row overflow menus and pickers. Items get
// { close } so an action can dismiss the menu.
// NOTE: never pass a component (e.g. a lucide icon) as a withDefaults default —
// Vue invokes an object/function default as a factory, calling the icon's render
// fn with no context ("Cannot destructure property 'slots' of undefined"). Keep
// `icon` undefined-by-default and fall back to MoreHorizontal in the template.
const props = withDefaults(
  defineProps<{
    icon?: Component
    /** align the panel's right edge to the trigger (default) or left */
    align?: 'left' | 'right'
    /** open the panel below the trigger (default) or above it — `top` is for
     * triggers pinned to the bottom of their container */
    side?: 'top' | 'bottom'
    width?: string
    /** override the trigger button styling (e.g. a labelled picker) */
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
  <!-- data-open lets a hover-revealed trigger stay visible while its menu is
       open (`data-[open]:opacity-100` alongside `group-hover/row:opacity-100`) -->
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
