<script setup lang="ts">
import { computed } from 'vue'
import { House } from 'lucide-vue-next'
import { DOC_GROUPS, DOC_SECTIONS, docSectionMatches } from '@/lib/docs'

const props = defineProps<{
  /** null = hub (home) */
  active: string | null
  /** lowercase filter; groups with no match collapse away */
  filter?: string
}>()

const emit = defineEmits<{ navigate: [id: string | null] }>()

const visibleSections = computed(() => {
  const q = props.filter?.trim()
  if (!q) return DOC_SECTIONS
  return DOC_SECTIONS.filter((s) => docSectionMatches(s, q))
})

const sectionsIn = (group: string) => visibleSections.value.filter((s) => s.group === group)

const itemClass = (isActive: boolean) => [
  'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors',
  isActive
    ? 'bg-secondary font-medium text-foreground'
    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
]
</script>

<template>
  <nav class="flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-input p-3">
    <button :class="itemClass(active === null)" @click="emit('navigate', null)">
      <House class="size-3.5 shrink-0" />
      Home
    </button>

    <template v-for="group in DOC_GROUPS" :key="group">
      <template v-if="sectionsIn(group).length">
        <p class="mt-4 mb-1 px-2.5 text-[10px] font-medium tracking-wide text-muted-foreground/70 uppercase">
          {{ group }}
        </p>
        <button
          v-for="section in sectionsIn(group)"
          :key="section.id"
          :class="itemClass(active === section.id)"
          @click="emit('navigate', section.id)"
        >
          <component :is="section.icon" class="size-3.5 shrink-0" />
          {{ section.title }}
        </button>
      </template>
    </template>
  </nav>
</template>
