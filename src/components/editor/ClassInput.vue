<script setup lang="ts">
import { computed, ref } from 'vue'
import BadgeUI from '@/components/ui/BadgeUI.vue'
import { suggestClasses } from '@/lib/styles'

const props = defineProps<{
  tokens: string[]
}>()

const emit = defineEmits<{
  add: [cls: string]
  remove: [cls: string]
}>()

const query = ref('')
const active = ref(0)

const inputEl = ref<HTMLInputElement>()
defineExpose({ focus: () => inputEl.value?.focus() })

const suggestions = computed(() => suggestClasses(query.value))
const open = computed(() => query.value.trim().length > 0 && suggestions.value.length > 0)

function commit(cls: string) {
  const value = cls.trim()
  if (!value) return
  // picking a bare variant prefix ("hover:") continues the query
  if (value.endsWith(':')) {
    query.value = value
    active.value = 0
    return
  }
  if (!props.tokens.includes(value)) emit('add', value)
  query.value = ''
  active.value = 0
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown' && open.value) {
    e.preventDefault()
    active.value = (active.value + 1) % suggestions.value.length
  } else if (e.key === 'ArrowUp' && open.value) {
    e.preventDefault()
    active.value = (active.value - 1 + suggestions.value.length) % suggestions.value.length
  } else if (e.key === 'Enter') {
    e.preventDefault()
    commit(open.value ? (suggestions.value[active.value] ?? query.value) : query.value)
  } else if (e.key === 'Escape') {
    // with a query, Escape only clears it; empty, it bubbles up and
    // closes the panel (returning focus to the code editor)
    if (query.value) {
      e.stopPropagation()
      query.value = ''
      active.value = 0
    }
  } else if (e.key === 'Backspace' && !query.value && props.tokens.length) {
    emit('remove', props.tokens[props.tokens.length - 1]!)
  } else {
    active.value = 0
  }
}
</script>

<template>
  <div class="relative">
    <div class="flex flex-wrap items-center gap-1">
      <BadgeUI v-for="token in tokens" :key="token" removable @remove="$emit('remove', token)">
        {{ token }}
      </BadgeUI>
      <input
        ref="inputEl"
        v-model="query"
        type="text"
        spellcheck="false"
        placeholder="Add class"
        class="h-6 min-w-20 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground"
        @keydown="onKeydown"
      />
    </div>

    <div
      v-if="open"
      class="absolute top-full left-0 z-20 mt-1 max-h-44 w-full overflow-y-auto rounded-md border border-input bg-background p-1 shadow-md"
    >
      <button
        v-for="(suggestion, i) in suggestions"
        :key="suggestion"
        class="block w-full cursor-pointer rounded px-2 py-1 text-left font-mono text-xs transition-colors hover:bg-accent"
        :class="i === active && 'bg-accent'"
        @mousedown.prevent="commit(suggestion)"
      >
        {{ suggestion }}
      </button>
    </div>
  </div>
</template>
