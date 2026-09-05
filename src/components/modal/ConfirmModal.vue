<script setup lang="ts">
import ModalDialog from '@/components/modal/ModalDialog.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'

// Reusable destructive-confirm dialog, opened via useModal().confirm() —
// closes with `true` when confirmed, no payload when dismissed.
withDefaults(defineProps<{ title: string; message: string; confirmLabel?: string }>(), {
  confirmLabel: 'Delete',
})
const emit = defineEmits<{ close: [result?: boolean] }>()
</script>

<template>
  <ModalDialog :title="title" size="sm" @close="emit('close')">
    <p class="text-xs text-muted-foreground">{{ message }}</p>
    <template #actions>
      <ButtonUI variant="outline" size="sm" @click="emit('close')">Cancel</ButtonUI>
      <ButtonUI
        variant="default"
        size="sm"
        class="bg-danger text-white hover:bg-danger"
        @click="emit('close', true)"
      >
        {{ confirmLabel }}
      </ButtonUI>
    </template>
  </ModalDialog>
</template>
