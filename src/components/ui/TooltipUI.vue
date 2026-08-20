<script setup lang="ts">
import { ref } from 'vue'

type Side = 'top' | 'right' | 'bottom' | 'left'

withDefaults(
  defineProps<{
    text: string
    side?: Side
  }>(),
  { side: 'top' },
)

const positions: Record<Side, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
  right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
}

// clicking usually opens something — hide the tooltip until the
// pointer leaves and hovers again
const suppressed = ref(false)
</script>

<template>
  <div
    class="group/tooltip relative inline-flex"
    @click="suppressed = true"
    @mouseleave="suppressed = false"
  >
    <slot />
    <span
      class="pointer-events-none absolute z-100 rounded-xl border border-input font-mono uppercase bg-background px-4 py-2 text-[10px] tracking-wider whitespace-nowrap opacity-0 shadow-md transition-opacity delay-100"
      :class="[positions[side], !suppressed && 'group-hover/tooltip:opacity-100']"
    >
      {{ text }}
    </span>
  </div>
</template>
