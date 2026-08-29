<script setup lang="ts">
import type { DocStep } from '@/lib/docs'

defineProps<{
  steps: DocStep[]
}>()
</script>

<template>
  <ol class="flex flex-col">
    <li v-for="(step, i) in steps" :key="step.title" class="relative flex gap-4 pb-6 last:pb-0">
      <!-- rail -->
      <div class="flex flex-col items-center">
        <span
          class="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-[11px] font-medium text-secondary-foreground"
        >
          {{ i + 1 }}
        </span>
        <span v-if="i < steps.length - 1" class="mt-1 w-px flex-1 bg-input" />
      </div>

      <div class="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
        <p class="text-sm font-medium text-foreground">{{ step.title }}</p>
        <p class="text-sm leading-6 text-muted-foreground">{{ step.text }}</p>
        <pre
          v-if="step.code"
          class="mt-1 rounded-lg border border-input bg-muted/40 px-3 py-2 font-mono text-xs leading-5 whitespace-pre text-foreground tab-2"
          >{{ step.code.join('\n') }}</pre
        >
      </div>
    </li>
  </ol>
</template>
