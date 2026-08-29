<script setup lang="ts">
import { ref, watch } from 'vue'
import ModalHost from '@/components/modal/ModalHost.vue'
import ModalHeader from '@/components/modal/ModalHeader.vue'
import ModalGroup from '@/components/modal/ModalGroup.vue'
import ModalActions from '@/components/modal/ModalActions.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import RowUI from '@/components/ui/RowUI.vue'
import { useAuth } from '@/composables/useAuth'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { name, email, updateAccount } = useAuth()

const nameField = ref('')
const emailField = ref('')
const password = ref('')
const currentPassword = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

// seed the fields from the current profile each time the modal opens
watch(
  () => props.open,
  (open) => {
    if (!open) return
    nameField.value = name.value
    emailField.value = email.value ?? ''
    password.value = ''
    currentPassword.value = ''
    error.value = null
  },
)

async function save() {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    await updateAccount({
      name: nameField.value.trim(),
      email: emailField.value.trim(),
      password: password.value || undefined,
      currentPassword: currentPassword.value || undefined,
    })
    emit('close')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Update failed'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <ModalHost v-if="open" size="sm" @close="emit('close')">
    <ModalHeader title="My account" @close="emit('close')" />
    <ModalGroup label="Profile">
      <RowUI label="Name">
        <InputUI v-model="nameField" placeholder="Your name" />
      </RowUI>
      <RowUI label="Email">
        <InputUI v-model="emailField" type="email" placeholder="you@example.com" />
      </RowUI>
    </ModalGroup>
    <ModalGroup label="Change password">
      <RowUI label="New">
        <InputUI v-model="password" type="password" placeholder="Leave blank to keep" />
      </RowUI>
      <RowUI v-if="password" label="Current">
        <InputUI v-model="currentPassword" type="password" placeholder="Current password" />
      </RowUI>
    </ModalGroup>
    <p v-if="error" class="px-4 pb-1 text-[10px] text-danger">{{ error }}</p>
    <ModalActions>
      <ButtonUI variant="outline" size="sm" @click="emit('close')">Cancel</ButtonUI>
      <ButtonUI variant="default" size="sm" :disabled="busy" @click="save">
        {{ busy ? 'Saving…' : 'Save' }}
      </ButtonUI>
    </ModalActions>
  </ModalHost>
</template>
