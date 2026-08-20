<script setup lang="ts">
import { computed, ref } from 'vue'

type Size = 'default' | 'lg'

const props = withDefaults(
  defineProps<{
    placeholder?: string
    type?: string
    size?: Size
  }>(),
  { type: 'text', size: 'default' },
)

const model = defineModel<string>({ default: '' })

const base =
  'w-full placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-accent'

const sizes: Record<Size, string> = {
  default: 'h-7 px-2 text-xs rounded-lg bg-input outline-none ',
  lg: 'h-12 px-3 text-xs rounded-xl border border-input outline-none',
}

const classes = computed(() => [base, sizes[props.size]])

const el = ref<HTMLInputElement>()
defineExpose({ focus: () => el.value?.focus() })
</script>

<template>
  <input
    ref="el"
    v-model="model"
    :type="type"
    spellcheck="false"
    :placeholder="placeholder"
    :class="classes"
  />
</template>
