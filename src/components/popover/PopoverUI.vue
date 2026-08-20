<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, type Component } from 'vue'
import { useInsertDrag } from '@/composables/useInsertDrag'

withDefaults(
  defineProps<{
    icon: Component
    title?: string
    /** tailwind width class for the floating panel */
    width?: string
  }>(),
  { width: 'w-56' },
)

const open = ref(false)
const root = ref<HTMLElement>()

// a palette drag must not close the popover: not on the release click
// outside, and not when Esc cancels the drag
const { payload: insertDrag, suppressNextClick } = useInsertDrag()

function close() {
  open.value = false
}

function onClickOutside(e: MouseEvent) {
  if (suppressNextClick.value) return
  if (root.value && !root.value.contains(e.target as Node)) close()
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && !insertDrag.value) close()
}

onMounted(() => {
  document.addEventListener('click', onClickOutside)
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onClickOutside)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="root" class="relative inline-flex">
    <button
      type="button"
      :title="title"
      class="flex size-9 items-center justify-center rounded-xl border border-input transition-colors hover:bg-accent/30 hover:text-accent-foreground"
      :class="open ? 'bg-accent/30 text-accent-foreground' : 'text-muted-foreground'"
      @click="open = !open"
    >
      <component :is="icon" class="size-4" />
    </button>

    <div
      v-if="open"
      class="absolute top-full left-0 z-50 mt-1 rounded-xl border border-input bg-background p-1 shadow-md"
      :class="width"
    >
      <slot :close="close" />
    </div>
  </div>
</template>
