<script setup lang="ts">
import { Upload, X } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    accept?: string
  }>(),
  { accept: 'image/*' },
)

/** model is the file's data URL (or a remote URL set elsewhere) */
const model = defineModel<string>({ default: '' })

function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => (model.value = String(reader.result ?? ''))
  reader.readAsDataURL(file)
  input.value = ''
}
</script>

<template>
  <div class="flex w-full flex-col gap-1.5">
    <label
      class="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-input text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <Upload class="size-3.5" />
      {{ model ? 'Replace file' : 'Upload file' }}
      <input type="file" :accept="accept" class="hidden" @change="onFile" />
    </label>

    <div v-if="model" class="relative">
      <img :src="model" class="max-h-24 w-full rounded-md border border-input object-cover" />
      <button
        class="absolute top-1 right-1 flex size-5 cursor-pointer items-center justify-center rounded-md bg-background/80 text-muted-foreground transition-colors hover:text-foreground"
        title="Remove file"
        @click="model = ''"
      >
        <X class="size-3.5" />
      </button>
    </div>
  </div>
</template>
