<script setup lang="ts">
import { Code, Feather, Files, Image, Settings, UserRound, LogOut } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import MainLogo from '@/assets/MainLogo.vue'
import SettingsPanel from '@/components/shared/SettingsPanel.vue'
import { useMediaLibrary } from '@/composables/useMediaLibrary'
import { useModal } from '@/composables/useModal'
import { useAuth } from '@/composables/useAuth'
import { useViewMode } from '@/composables/useViewMode'

defineProps<{ drawerOpen: boolean }>()
const emit = defineEmits<{ 'toggle-drawer': []; 'close-drawer': [] }>()

const { openLibrary } = useMediaLibrary()
const { openModal } = useModal()
const { canBuild, logout } = useAuth()
const { isPreview, setMode } = useViewMode()

// switching surface closes the pages drawer so it doesn't linger over the mode
function showBuild() {
  setMode('build')
  emit('close-drawer')
}
function showPreview() {
  setMode('preview')
  emit('close-drawer')
}
</script>

<template>
  <aside class="relative z-[60] flex h-full w-12 flex-col items-center gap-1 py-2 border-r border-input bg-background">
    <div class="flex py-2 w-7 items-center justify-center text-foreground">
      <MainLogo class="size-4" />
    </div>
    <div class="my-1 h-px w-full bg-input" />

    <!-- Build (code) — contributors are content-only, so they don't get it -->
    <ButtonUI
      v-if="canBuild"
      variant="ghost"
      :icon="Code"
      tooltip="Code editor"
      tooltip-side="right"
      class="w-7"
      :class="isPreview ? 'text-muted-foreground' : 'text-accent-foreground'"
      @click="showBuild"
    />
    <ButtonUI
      variant="ghost"
      :icon="Feather"
      tooltip="Preview"
      tooltip-side="right"
      class="w-7"
      :class="isPreview ? 'text-accent-foreground' : 'text-muted-foreground'"
      @click="showPreview"
    />
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
      :icon="Image"
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
      @click="openModal(SettingsPanel, { initialSection: 'account' })"
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
