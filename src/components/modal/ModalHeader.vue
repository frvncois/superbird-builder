<script setup lang="ts">
import { X } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'

defineProps<{
  title: string
}>()

defineEmits<{
  close: []
}>()
</script>

<template>
  <header class="flex h-10 items-center justify-between border-b border-input pr-1.5 pl-4">
    <p class="text-xs font-medium">{{ title }}</p>
    <ButtonUI
      variant="icon"
      size="sm"
      :icon="X"
      class="w-7 text-muted-foreground"
      @click="$emit('close')"
    />
  </header>
</template>
