<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, type Component } from 'vue'
import { ChevronDown } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    label: string
    icon?: Component
    /** tailwind width class for the trigger + panel */
    width?: string
    /** 'default' = bordered card; 'filled' = borderless bg-input/50 */
    variant?: 'default' | 'filled'
  }>(),
  { width: 'w-48', variant: 'default' },
)

const open = ref(false)
const root = ref<HTMLElement>()

function close() {
  open.value = false
}

function onClickOutside(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) close()
}

onMounted(() => document.addEventListener('click', onClickOutside))
onBeforeUnmount(() => document.removeEventListener('click', onClickOutside))
</script>

<template>
  <div ref="root" class="relative h-9" :class="width">
    <!-- Overlays so the expanding border never pushes the surrounding layout -->
    <div
      class="absolute inset-x-0 top-0 z-50 rounded-xl"
      :class="variant === 'filled' ? 'bg-secondary' : 'border border-input bg-background'"
    >
      <div
        class="flex h-9 cursor-pointer items-center gap-2 px-3 text-xs font-medium select-none"
        @click="open = !open"
      >
        <component :is="icon" v-if="icon" class="size-3.5 shrink-0 text-muted-foreground" />
        <span class="flex-1 truncate">{{ label }}</span>
        <ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
      </div>

      <!-- Options render inside the wrapper so its border stretches with them -->
      <div v-if="open" class="border-t border-input p-1">
        <slot :close="close" />
      </div>
    </div>
  </div>
</template>
