<script setup lang="ts">
import { computed } from 'vue'
import { Lightbulb, Info, TriangleAlert } from 'lucide-vue-next'
import type { DocCalloutTone } from '@/lib/docs'

const props = defineProps<{
  tone: DocCalloutTone
  text: string
}>()

const tones = {
  tip: { icon: Lightbulb, label: 'Tip', accent: 'text-success', border: 'border-l-success/60' },
  note: { icon: Info, label: 'Note', accent: 'text-accent-foreground', border: 'border-l-accent' },
  warning: { icon: TriangleAlert, label: 'Warning', accent: 'text-pending', border: 'border-l-pending/60' },
} as const

const tone = computed(() => tones[props.tone])
</script>

<template>
  <div
    class="flex gap-3 rounded-xl border border-input border-l-2 bg-muted/30 px-4 py-3"
    :class="tone.border"
  >
    <component :is="tone.icon" class="mt-0.5 size-4 shrink-0" :class="tone.accent" />
    <div class="flex flex-col gap-0.5">
      <span class="text-xs font-medium" :class="tone.accent">{{ tone.label }}</span>
      <span class="text-sm leading-6 text-muted-foreground">{{ text }}</span>
    </div>
  </div>
</template>
