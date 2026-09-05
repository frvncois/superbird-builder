<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useModal } from '@/composables/useModal'

const { stack, closeTop } = useModal()

// the ONE Escape listener for modals: pops only the top of the stack
// (per-instance listeners in ModalHost used to close every stacked modal at once)
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && stack.value.length) {
    e.stopPropagation()
    closeTop()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <component
    :is="entry.component"
    v-for="entry in stack"
    :key="entry.id"
    v-bind="entry.props"
    @close="closeTop($event)"
  />
</template>
