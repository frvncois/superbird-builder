<script setup lang="ts">
type Size = 'sm' | 'default' | 'lg' | 'xl' | 'full'

withDefaults(
  defineProps<{
    size?: Size
  }>(),
  { size: 'default' },
)

const emit = defineEmits<{
  close: []
}>()

const sizes: Record<Size, string> = {
  sm: 'w-80',
  default: 'w-[28rem]',
  lg: 'w-[40rem]',
  // xl is a fixed-size, two-pane dialog that manages its own inner scrolling
  xl: 'w-[840px] h-[560px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)]',
  // full is a near-viewport surface (media library) that manages its own inner scrolling
  full: 'w-[min(92vw,1200px)] h-[88vh]',
}

// Escape is handled centrally by ModalStackHost (top-of-stack only)
</script>

<template>
  <div
    class="fixed inset-0 z-100 flex items-center justify-center bg-black/50 backdrop-blur-xs"
    @click.self="$emit('close')"
  >
    <div
      class="rounded-2xl border border-input bg-background shadow-lg"
      :class="[
        sizes[size],
        size === 'xl' || size === 'full' ? 'overflow-auto' : 'max-h-[85vh] overflow-y-auto',
      ]"
    >
      <slot />
    </div>
  </div>
</template>
