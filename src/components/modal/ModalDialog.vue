<script setup lang="ts">
import ModalHost from './ModalHost.vue'
import ModalHeader from './ModalHeader.vue'
import ModalContent from './ModalContent.vue'
import ModalActions from './ModalActions.vue'

type Size = 'sm' | 'default' | 'lg'

withDefaults(
  defineProps<{
    title?: string
    size?: Size
  }>(),
  { size: 'default' },
)

defineEmits<{
  close: []
}>()

defineSlots<{
  default(): unknown
  actions?(): unknown
}>()
</script>

<template>
  <ModalHost :size="size" @close="$emit('close')">
    <ModalHeader v-if="title" :title="title" @close="$emit('close')" />
    <ModalContent>
      <slot />
    </ModalContent>
    <ModalActions v-if="$slots.actions">
      <slot name="actions" />
    </ModalActions>
  </ModalHost>
</template>
