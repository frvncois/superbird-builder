<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import ModalHost from '@/components/modal/ModalHost.vue'
import ModalHeader from '@/components/modal/ModalHeader.vue'
import ModalContent from '@/components/modal/ModalContent.vue'
import ModalActions from '@/components/modal/ModalActions.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import { useComponents } from '@/composables/useComponents'

const { namingFor, createComponent } = useComponents()

const name = ref('')
const nameInput = ref<InstanceType<typeof InputUI>>()

watch(namingFor, (id) => {
  if (!id) return
  name.value = ''
  nextTick(() => nameInput.value?.focus())
})

function close() {
  namingFor.value = null
}

function submit() {
  if (!namingFor.value || !name.value.trim()) return
  createComponent(name.value, namingFor.value)
  close()
}
</script>

<template>
  <ModalHost v-if="namingFor" size="sm" @close="close">
    <ModalHeader title="Create component" @close="close" />
    <ModalContent>
      <p class="text-xs text-muted-foreground">
        The element becomes a shared component you can reuse anywhere as
        <span class="font-mono">:Name:</span>.
      </p>
      <InputUI ref="nameInput" v-model="name" placeholder="e.g. Hero" @keydown.enter="submit" />
    </ModalContent>
    <ModalActions>
      <ButtonUI variant="outline" size="sm" @click="close">Cancel</ButtonUI>
      <ButtonUI variant="default" size="sm" :disabled="!name.trim()" @click="submit">
        Create
      </ButtonUI>
    </ModalActions>
  </ModalHost>
</template>
