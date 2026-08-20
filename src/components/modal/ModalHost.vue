<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

type Size = 'sm' | 'default' | 'lg'

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
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    class="fixed inset-0 z-100 flex items-center justify-center bg-black/50"
    @click.self="$emit('close')"
  >
    <div
      class="max-h-[85vh] overflow-y-auto rounded-xl border border-input bg-background shadow-lg"
      :class="sizes[size]"
    >
      <slot />
    </div>
  </div>
</template>
