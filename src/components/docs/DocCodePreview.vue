<script setup lang="ts">
import DocPreviewNodeView from './DocPreviewNodeView.vue'
import type { DocPreviewNode } from '@/lib/docs'

defineProps<{
  lines: string[]
  preview: DocPreviewNode[]
  caption?: string
  component?: boolean
}>()
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <div class="grid grid-cols-1 overflow-hidden rounded-xl border border-input sm:grid-cols-2">
      <!-- code pane -->
      <div class="flex flex-col border-b border-input bg-muted/40 sm:border-r sm:border-b-0">
        <span class="px-4 pt-2.5 text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
          Code
        </span>
        <pre
          class="px-4 py-2.5 font-mono text-xs leading-5 whitespace-pre tab-2"
          :class="component ? 'text-success' : 'text-foreground'"
          >{{ lines.join('\n') }}</pre
        >
      </div>

      <!-- preview pane -->
      <div class="flex flex-col">
        <span class="px-4 pt-2.5 text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
          Preview
        </span>
        <div class="flex flex-1 flex-col justify-center gap-2 px-4 py-3">
          <DocPreviewNodeView v-for="(node, i) in preview" :key="i" :node="node" />
        </div>
      </div>
    </div>
    <p v-if="caption" class="px-1 text-xs text-muted-foreground">{{ caption }}</p>
  </div>
</template>
