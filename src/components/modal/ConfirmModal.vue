<script setup lang="ts">
import ModalDialog from '@/components/modal/ModalDialog.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'

// Reusable destructive-confirm dialog. Parent controls visibility (v-if) and
// handles `confirm` / `close`.
withDefaults(defineProps<{ title: string; message: string; confirmLabel?: string }>(), {
  confirmLabel: 'Delete',
})
const emit = defineEmits<{ confirm: []; close: [] }>()
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
        @click="emit('confirm')"
      >
        {{ confirmLabel }}
      </ButtonUI>
    </template>
  </ModalDialog>
</template>
