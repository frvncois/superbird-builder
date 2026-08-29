<script setup lang="ts">
import { ref, computed } from 'vue'
import { textToTail } from '@/lib/valueClass'

// A compact text field for a style value (e.g. `4`, `4em`, `-4px`). Edits are
// local until blur / Enter, then validated: valid text commits, invalid text
// reverts to the last committed value. Empty commits as '' (unset).

const props = withDefaults(
  defineProps<{
    /** the committed value text shown when not editing */
    modelValue: string
    allowNegative?: boolean
    placeholder?: string
    /** override the default units guard (e.g. size values accept keywords) */
    validate?: (text: string) => boolean
  }>(),
  { allowNegative: false, placeholder: '–' },
)

const emit = defineEmits<{ commit: [string] }>()

const editing = ref<string | null>(null)
const shown = computed(() => editing.value ?? props.modelValue)

function onFocus() {
  editing.value = props.modelValue
}

function onInput(e: Event) {
  editing.value = (e.target as HTMLInputElement).value
}

function commit() {
  const raw = editing.value
  editing.value = null
  if (raw === null) return
  const text = raw.trim()
  // empty is a valid "unset"; otherwise must pass the guard
  if (text !== '') {
    const ok = props.validate
      ? props.validate(text)
      : textToTail(text, { allowNegative: props.allowNegative }) !== false
    if (!ok) return
  }
  if (text !== props.modelValue) emit('commit', text)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
  else if (e.key === 'Escape') {
    editing.value = null
    ;(e.target as HTMLInputElement).blur()
  }
}
</script>

<template>
  <input
    :value="shown"
    :placeholder="placeholder"
    spellcheck="false"
    class="h-7 w-14 shrink-0 rounded-md bg-input px-2 text-right font-mono text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-accent"
    :class="modelValue === '' && editing === null ? 'text-muted-foreground' : 'text-foreground'"
    @focus="onFocus"
    @input="onInput"
    @blur="commit"
    @keydown="onKeydown"
  />
</template>
