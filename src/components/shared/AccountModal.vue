<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Check, Copy, Trash2 } from 'lucide-vue-next'
import ModalHost from '@/components/modal/ModalHost.vue'
import ModalHeader from '@/components/modal/ModalHeader.vue'
import ModalGroup from '@/components/modal/ModalGroup.vue'
import ModalActions from '@/components/modal/ModalActions.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import RowUI from '@/components/ui/RowUI.vue'
import { useAuth } from '@/composables/useAuth'
import { useApiTokens } from '@/composables/useApiTokens'
import { useModal } from '@/composables/useModal'
import { timeAgo } from '@/lib/time'

// opened via useModal — mounted means open, so seed at setup time
const emit = defineEmits<{ close: [] }>()

const { name, email, canBuild, updateAccount } = useAuth()

const nameField = ref(name.value)
const emailField = ref(email.value ?? '')
const password = ref('')
const currentPassword = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

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

// --- API tokens (admin/editor only; the server 403s contributors) ---
const { tokens, load, create, revoke } = useApiTokens()
const { confirm } = useModal()

const tokenName = ref('')
const tokenBusy = ref(false)
const tokenError = ref<string | null>(null)
// the raw token, shown exactly once right after creation, then unrecoverable
const freshToken = ref<string | null>(null)
const freshName = ref('')
const copied = ref(false)

onMounted(() => {
  if (canBuild.value) load().catch(() => {})
})

async function createToken() {
  if (tokenBusy.value) return
  tokenError.value = null
  const label = tokenName.value.trim()
  if (!label) {
    tokenError.value = 'Give the token a name first'
    return
  }
  tokenBusy.value = true
  try {
    freshToken.value = await create(label)
    freshName.value = label
    tokenName.value = ''
    copied.value = false
  } catch (e) {
    tokenError.value = e instanceof Error ? e.message : 'Could not create the token'
  } finally {
    tokenBusy.value = false
  }
}

async function copyToken() {
  if (!freshToken.value) return
  await navigator.clipboard.writeText(freshToken.value).catch(() => {})
  copied.value = true
  setTimeout(() => (copied.value = false), 1600)
}

async function revokeToken(id: string, label: string) {
  const ok = await confirm({
    title: 'Revoke token',
    message: `Any MCP server or script using “${label}” will stop working immediately.`,
    confirmLabel: 'Revoke',
  })
  if (ok) await revoke(id).catch((e) => (tokenError.value = e instanceof Error ? e.message : 'Failed'))
}
</script>

<template>
  <ModalHost size="sm" @close="emit('close')">
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

    <ModalGroup v-if="canBuild" label="API tokens">
      <p class="px-1 text-[10px] leading-relaxed text-muted-foreground">
        Bearer credentials for the Guano MCP server and scripts. Treat each like a password.
      </p>

      <!-- show-once: the freshly created raw token -->
      <div v-if="freshToken" class="flex flex-col gap-2 rounded-xl border border-accent/40 bg-accent/10 p-3">
        <p class="flex items-center gap-1.5 text-[11px] font-medium">
          <Check class="size-3.5 text-success" /> Token “{{ freshName }}” created
        </p>
        <code class="block break-all rounded-lg bg-background px-2 py-1.5 font-mono text-[10px] select-all">
          {{ freshToken }}
        </code>
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] text-muted-foreground">Copy it now — it won't be shown again.</span>
          <ButtonUI size="xs" :icon="copied ? Check : Copy" @click="copyToken">
            {{ copied ? 'Copied' : 'Copy' }}
          </ButtonUI>
        </div>
        <ButtonUI variant="ghost" size="xs" class="self-end" @click="freshToken = null">Done</ButtonUI>
      </div>

      <!-- create row -->
      <div v-else class="flex items-end gap-2">
        <div class="flex-1">
          <InputUI v-model="tokenName" placeholder="Token name (e.g. mcp-laptop)" @keydown.enter="createToken" />
        </div>
        <ButtonUI variant="outline" size="sm" :disabled="tokenBusy" @click="createToken">
          {{ tokenBusy ? 'Creating…' : 'Create' }}
        </ButtonUI>
      </div>

      <p v-if="tokenError" class="px-1 text-[10px] text-danger">{{ tokenError }}</p>

      <!-- existing tokens -->
      <ul v-if="tokens.length" class="flex flex-col divide-y divide-accent/20">
        <li v-for="t in tokens" :key="t.id" class="flex items-center justify-between gap-2 py-1.5">
          <div class="min-w-0">
            <p class="truncate text-xs font-medium">{{ t.name }}</p>
            <p class="text-[10px] text-muted-foreground">
              Created {{ timeAgo(t.createdAt) }} ·
              {{ t.lastUsedAt ? `last used ${timeAgo(t.lastUsedAt)}` : 'never used' }}
            </p>
          </div>
          <ButtonUI
            variant="icon"
            size="sm"
            :icon="Trash2"
            tooltip="Revoke token"
            @click="revokeToken(t.id, t.name)"
          />
        </li>
      </ul>
    </ModalGroup>

    <ModalActions>
      <ButtonUI variant="outline" size="sm" @click="emit('close')">Cancel</ButtonUI>
      <ButtonUI variant="default" size="sm" :disabled="busy" @click="save">
        {{ busy ? 'Saving…' : 'Save' }}
      </ButtonUI>
    </ModalActions>
  </ModalHost>
</template>
