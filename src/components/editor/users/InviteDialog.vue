<script setup lang="ts">
import { ref } from 'vue'
import { Check, Link2 } from 'lucide-vue-next'
import ModalDialog from '@/components/modal/ModalDialog.vue'
import RowUI from '@/components/ui/RowUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import RolePicker from '@/components/editor/users/RolePicker.vue'
import { useUsers } from '@/composables/useUsers'
import { roleLabel } from '@/lib/roles'
import type { Role } from '@/composables/useAuth'

defineEmits<{ close: [] }>()

const { invite } = useUsers()

const name = ref('')
const email = ref('')
const role = ref<Role>('editor')
const busy = ref(false)
const error = ref<string | null>(null)

// step 2 state
const createdLink = ref<string | null>(null)
const createdEmail = ref('')
const createdRole = ref<Role>('editor')
const copied = ref(false)

const isEmail = (v: string) => /.+@.+\..+/.test(v)

async function submit() {
  if (busy.value) return
  error.value = null
  if (!isEmail(email.value.trim())) {
    error.value = 'Enter a valid email address'
    return
  }
  busy.value = true
  try {
    const { link } = await invite({ name: name.value.trim(), email: email.value.trim(), role: role.value })
    createdLink.value = link
    createdEmail.value = email.value.trim()
    createdRole.value = role.value
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not create the invite'
  } finally {
    busy.value = false
  }
}

async function copy() {
  if (!createdLink.value) return
  await navigator.clipboard.writeText(createdLink.value).catch(() => {})
  copied.value = true
  setTimeout(() => (copied.value = false), 1600)
}

function another() {
  createdLink.value = null
  name.value = ''
  email.value = ''
  copied.value = false
}
</script>

<template>
  <!-- step 1: form -->
  <ModalDialog v-if="!createdLink" title="Invite someone" @close="$emit('close')">
    <div class="flex flex-col gap-2">
      <RowUI label="Name"><InputUI v-model="name" placeholder="Their name" /></RowUI>
      <RowUI label="Email"><InputUI v-model="email" type="email" placeholder="them@example.com" /></RowUI>
      <RowUI label="Role">
        <RolePicker :role="role" @change="(r) => (role = r)" />
      </RowUI>
      <p v-if="error" class="text-[10px] text-danger">{{ error }}</p>
    </div>
    <template #actions>
      <ButtonUI variant="outline" size="sm" @click="$emit('close')">Cancel</ButtonUI>
      <ButtonUI size="sm" :disabled="busy" @click="submit">
        {{ busy ? 'Creating…' : 'Create invite link' }}
      </ButtonUI>
    </template>
  </ModalDialog>

  <!-- step 2: success -->
  <ModalDialog v-else title="Invite created" @close="$emit('close')">
    <div class="flex flex-col items-center gap-4 py-2 text-center">
      <p class="flex items-center gap-2 text-sm">
        <Check class="size-4 text-success" />
        <span class="font-medium">{{ createdEmail }}</span>
        <span class="text-muted-foreground">· {{ roleLabel(createdRole) }}</span>
      </p>
      <button
        type="button"
        class="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground outline-none transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
        @click="copy"
      >
        <component :is="copied ? Check : Link2" class="size-4" />
        {{ copied ? 'Copied to clipboard' : 'Copy invite link' }}
      </button>
      <p class="text-[10px] text-muted-foreground">
        Works once · expires in 7 days.<br />
        You can copy it again from the members list any time.
      </p>
    </div>
    <template #actions>
      <ButtonUI variant="outline" size="sm" @click="another">Invite another</ButtonUI>
      <ButtonUI size="sm" @click="$emit('close')">Done</ButtonUI>
    </template>
  </ModalDialog>
</template>
