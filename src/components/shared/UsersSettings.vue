<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Check, Copy, Link2, Plus, RefreshCw, Trash2, Clock } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import MenuUI from '@/components/ui/MenuUI.vue'
import RolePicker from '@/components/editor/users/RolePicker.vue'
import InviteDialog from '@/components/editor/users/InviteDialog.vue'
import { useUsers, inviteLink, type InviteRow, type UserRow } from '@/composables/useUsers'
import { useAuth, type Role } from '@/composables/useAuth'
import { useModal } from '@/composables/useModal'
import { roleLabel } from '@/lib/roles'

const { users, invites, isAdmin, load, updateInvite, revokeInvite, setRole, remove } = useUsers()
const { email: myEmail } = useAuth()
const { openModal, confirm } = useModal()

const error = ref<string | null>(null)
const notice = ref<string | null>(null)
onMounted(() => load().catch((e) => (error.value = e.message)))

const admin = computed(() => isAdmin())

// pending invites shown after members; "(you)" first among members
const sortedUsers = computed(() =>
  [...users.value].sort((a, b) => (a.email === myEmail.value ? -1 : b.email === myEmail.value ? 1 : 0)),
)

function daysLeft(expiresAt: number): string {
  const ms = expiresAt - Date.now()
  if (ms <= 0) return 'expired'
  const days = Math.ceil(ms / 86_400_000)
  return days <= 1 ? 'expires today' : `${days}d left`
}

async function run(fn: () => Promise<unknown>, ok?: string) {
  error.value = null
  notice.value = null
  try {
    await fn()
    if (ok) flashNotice(ok)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Action failed'
  }
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined
function flashNotice(msg: string) {
  notice.value = msg
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = null), 2500)
}

// --- confirm dialog (remove / demote / regenerate) ---
async function ask(title: string, message: string, label: string, action: () => Promise<void>) {
  if (await confirm({ title, message, confirmLabel: label })) await run(action)
}

// --- member role change (confirm self-demotion) ---
function changeUserRole(u: UserRow, role: Role) {
  if (!u.id) return
  const demotingSelf = u.email === myEmail.value && u.role === 'admin' && role !== 'admin'
  if (demotingSelf) {
    void ask(
      'Give up admin access?',
      "You're changing your own role away from Admin. You'll lose access to member management.",
      'Change role',
      () => setRole(u.id!, role),
    )
  } else {
    void run(() => setRole(u.id!, role))
  }
}

function removeMember(u: UserRow) {
  if (!u.id) return
  void ask(
    'Remove member',
    `Remove ${u.name || u.email}? They lose access immediately and are signed out everywhere.`,
    'Remove',
    () => remove(u.id!),
  )
}

// --- invite actions ---
async function copyInvite(i: InviteRow) {
  if (!i.token) return
  await navigator.clipboard.writeText(inviteLink(i.token)).catch(() => {})
  flashNotice(`Invite link for ${i.email} copied`)
}

function regenerate(i: InviteRow) {
  if (!i.id) return
  void ask(
    'Regenerate link',
    `Create a fresh link for ${i.email}? The current link will stop working immediately.`,
    'Regenerate',
    async () => {
      // the raw token is no longer stored server-side, so the fresh link is
      // surfaced once here (copied straight to the clipboard) — there is no
      // re-copy from the list afterward
      const updated = await updateInvite(i.id!, { regenerate: true })
      if (updated?.token) {
        await navigator.clipboard.writeText(inviteLink(updated.token)).catch(() => {})
        flashNotice(`New link for ${i.email} copied to clipboard`)
      } else {
        flashNotice(`New link created for ${i.email}`)
      }
    },
  )
}

function revoke(i: InviteRow) {
  if (!i.id) return
  void ask('Revoke invite', `Revoke the invite for ${i.email}? The link will stop working.`, 'Revoke', () =>
    revokeInvite(i.id!),
  )
}
</script>

<template>
  <div class="flex flex-col gap-2 p-1">
    <div class="flex items-center justify-between">
      <p class="text-xs font-medium">Users</p>
      <ButtonUI v-if="admin" size="xs" :icon="Plus" @click="openModal(InviteDialog)">Invite</ButtonUI>
    </div>

    <div class="flex flex-col rounded-xl border border-input">
      <!-- members -->
      <div
        v-for="u in sortedUsers"
        :key="u.email"
        class="flex items-center gap-2 border-b border-input px-3 py-2 last:border-b-0"
      >
        <span class="size-1.5 shrink-0 rounded-full bg-success" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs font-medium">
            {{ u.name || u.email }}
            <span v-if="u.email === myEmail" class="font-normal text-muted-foreground">(you)</span>
          </p>
          <p class="truncate text-[10px] text-muted-foreground">{{ u.email }}</p>
        </div>
        <RolePicker v-if="admin" :role="u.role" @change="(r) => changeUserRole(u, r)" />
        <span v-else class="shrink-0 text-xs text-muted-foreground">{{ roleLabel(u.role) }}</span>
        <MenuUI v-if="admin">
          <template #default="{ close }">
            <button
              type="button"
              class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-danger outline-none hover:bg-accent/30"
              @click="(removeMember(u), close())"
            >
              <Trash2 class="size-3.5" /> Remove
            </button>
          </template>
        </MenuUI>
      </div>

      <!-- pending invites -->
      <div
        v-for="i in invites"
        :key="i.email"
        class="flex items-center gap-2 border-b border-input px-3 py-2 opacity-70 last:border-b-0"
      >
        <span class="size-1.5 shrink-0 rounded-full border border-muted-foreground/50" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs">{{ i.email }}</p>
          <p class="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock class="size-2.5" /> invited · {{ daysLeft(i.expiresAt) }}
          </p>
        </div>
        <RolePicker
          v-if="admin && i.id"
          :role="i.role"
          @change="(r) => run(() => updateInvite(i.id!, { role: r }))"
        />
        <span v-else class="shrink-0 text-xs text-muted-foreground">{{ roleLabel(i.role) }}</span>
        <ButtonUI
          v-if="admin && i.token"
          variant="ghost"
          size="xs"
          :icon="Link2"
          tooltip="Copy invite link"
          class="text-muted-foreground"
          @click="copyInvite(i)"
        />
        <MenuUI v-if="admin && i.id">
          <template #default="{ close }">
            <button
              v-if="i.token"
              type="button"
              class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30"
              @click="(copyInvite(i), close())"
            >
              <Copy class="size-3.5" /> Copy link
            </button>
            <button
              type="button"
              class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30"
              @click="(run(() => updateInvite(i.id!, { extend: true }), 'Expiry extended'), close())"
            >
              <Clock class="size-3.5" /> Extend 7 days
            </button>
            <button
              type="button"
              class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30"
              @click="(regenerate(i), close())"
            >
              <RefreshCw class="size-3.5" /> Regenerate link
            </button>
            <button
              type="button"
              class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-danger outline-none hover:bg-accent/30"
              @click="(revoke(i), close())"
            >
              <Trash2 class="size-3.5" /> Revoke
            </button>
          </template>
        </MenuUI>
      </div>
    </div>

    <p v-if="notice" class="flex items-center gap-1 px-1 text-[10px] text-success">
      <Check class="size-3" /> {{ notice }}
    </p>
    <p v-if="error" class="px-1 text-[10px] text-danger">{{ error }}</p>

  </div>
</template>
