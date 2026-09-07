<script setup lang="ts">
import { Files, Images, Settings, UserRound, LogOut } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import MainLogo from '@/assets/MainLogo.vue'
import SettingsPanel from '@/components/shared/SettingsPanel.vue'
import AccountModal from '@/components/shared/AccountModal.vue'
import { useMediaLibrary } from '@/composables/useMediaLibrary'
import { useModal } from '@/composables/useModal'
import { useAuth } from '@/composables/useAuth'

defineProps<{ drawerOpen: boolean }>()
const emit = defineEmits<{ 'toggle-drawer': [] }>()

const { openLibrary } = useMediaLibrary()
const { openModal } = useModal()
const { logout } = useAuth()
</script>

<template>
  <aside class="flex h-full w-12 flex-col items-center gap-1 py-2 border-r border-input">
    <div class="flex py-2 w-7 items-center justify-center text-foreground">
      <MainLogo class="size-4" />
    </div>
    <div class="my-1 h-px w-full bg-input" />

    <ButtonUI
      variant="ghost"
      :icon="Files"
      tooltip="Pages"
      tooltip-side="right"
      class="w-7"
      :class="drawerOpen ? 'text-accent-foreground' : 'text-muted-foreground'"
      @click="emit('toggle-drawer')"
    />
    <ButtonUI
      variant="ghost"
      :icon="Images"
      tooltip="Media library"
      tooltip-side="right"
      class="w-7 text-muted-foreground"
      @click="openLibrary()"
    />
    <ButtonUI
      variant="ghost"
      :icon="Settings"
      tooltip="Project settings"
      tooltip-side="right"
      class="w-7 text-muted-foreground"
      @click="openModal(SettingsPanel)"
    />

    <ButtonUI
      variant="ghost"
      :icon="UserRound"
      tooltip="My account"
      tooltip-side="right"
      class="mt-auto w-7 text-muted-foreground"
      @click="openModal(AccountModal)"
    />
    <ButtonUI
      variant="ghost"
      :icon="LogOut"
      tooltip="Logout"
      tooltip-side="right"
      class="w-7 text-muted-foreground"
      @click="logout"
    />
  </aside>
</template>
