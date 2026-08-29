<script setup lang="ts">
import { Image } from 'lucide-vue-next'
import type { DocPreviewNode } from '@/lib/docs'

defineProps<{
  node: DocPreviewNode
}>()
</script>

<template>
  <p v-if="node.el === 'heading'" class="text-sm font-semibold text-foreground">{{ node.text }}</p>
  <p v-else-if="node.el === 'text'" class="text-xs leading-5 text-muted-foreground">{{ node.text }}</p>
  <span
    v-else-if="node.el === 'button'"
    class="inline-flex w-fit items-center rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background"
  >
    {{ node.text }}
  </span>
  <div
    v-else-if="node.el === 'media'"
    class="flex aspect-video w-full max-w-40 items-center justify-center rounded-lg bg-muted text-muted-foreground"
  >
    <Image class="size-4" />
  </div>
  <div v-else-if="node.el === 'row'" class="flex items-center gap-2">
    <DocPreviewNodeView v-for="(child, i) in node.children" :key="i" :node="child" />
  </div>
  <!-- stack -->
  <div v-else class="flex flex-col gap-1.5 rounded-lg border border-dashed border-input p-2.5">
    <DocPreviewNodeView v-for="(child, i) in node.children" :key="i" :node="child" />
  </div>
</template>
