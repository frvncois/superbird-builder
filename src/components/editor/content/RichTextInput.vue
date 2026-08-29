<script setup lang="ts">
// Minimal rich-text field for the Content panel: a contenteditable div
// with a bold/italic/link/list toolbar. The model value is always the
// sanitized HTML subset (lib/shared/richtext.js).
import { onMounted, ref, watch } from 'vue'
import { Bold, Italic, Link2, List } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { sanitizeRich } from '@/lib/shared/richtext.js'

const props = defineProps<{ modelValue: string; placeholder?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const editor = ref<HTMLElement>()
const focused = ref(false)

function syncIn() {
  const el = editor.value
  if (!el || focused.value) return
  const html = sanitizeRich(props.modelValue)
  if (el.innerHTML !== html) el.innerHTML = html
}
onMounted(syncIn)
watch(() => props.modelValue, syncIn)

function emitOut() {
  emit('update:modelValue', sanitizeRich(editor.value?.innerHTML ?? ''))
}

// execCommand is deprecated but universally supported — fine for this subset
function exec(command: string, value?: string) {
  editor.value?.focus()
  document.execCommand(command, false, value)
  emitOut()
}

function makeLink() {
  const url = window.prompt('Link URL (https://… or /page)')
  if (url) exec('createLink', url)
}

// keystrokes stay local to the contenteditable (editor shortcuts must not
// fire while writing) — except Escape, which bubbles so the panel's
// window-level handler can close the popover and return to the code editor
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') e.stopPropagation()
}

defineExpose({ focus: () => editor.value?.focus() })
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex gap-1">
      <ButtonUI variant="ghost" size="xs" :icon="Bold" title="Bold (⌘B)" @click="exec('bold')" />
      <ButtonUI variant="ghost" size="xs" :icon="Italic" title="Italic (⌘I)" @click="exec('italic')" />
      <ButtonUI variant="ghost" size="xs" :icon="Link2" title="Link" @click="makeLink" />
      <ButtonUI variant="ghost" size="xs" :icon="List" title="Bullet list" @click="exec('insertUnorderedList')" />
    </div>
    <div
      ref="editor"
      contenteditable="true"
      class="min-h-96 w-full rounded-lg border border-accent bg-transparent px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-accent/25 [&_a]:underline [&_li]:ml-4 [&_ul]:list-disc [&_ol]:list-decimal"
      :data-placeholder="placeholder"
      @focus="focused = true"
      @blur="((focused = false), emitOut())"
      @input="emitOut"
      @keydown="onKeydown"
    ></div>
  </div>
</template>
