<script setup lang="ts">
import {
  Component, Feather, Files, Image, Layers, Settings, UserRound, LogOut,
} from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import MainLogo from '@/assets/MainLogo.vue'
import SettingsPanel from '@/components/shared/SettingsPanel.vue'
import { useMediaLibrary } from '@/composables/useMediaLibrary'
import { useModal } from '@/composables/useModal'
import { useAuth } from '@/composables/useAuth'
import { useViewMode } from '@/composables/useViewMode'

const { openLibrary } = useMediaLibrary()
const { openModal } = useModal()
const { canBuild, logout } = useAuth()
const {
  isPreview, isBuild, canvas, column, showLayers, showComponents, pagesOpen,
  setMode, toggleLayers, togglePages, toggleComponents, showApp,
} = useViewMode()
</script>

<template>
  <aside class="relative z-[60] flex h-full w-12 flex-col items-center gap-1 py-2 bg-background">
    <!-- App: the default surface — Build canvas, no code column. Contributors
         are pinned to Preview, so for them it stays a plain mark. -->
    <ButtonUI
      v-if="canBuild"
      variant="ghost"
      aria-label="App"
      tooltip="App"
      tooltip-side="right"
      class="w-7"
      :class="isBuild && canvas === 'page' && !column ? 'text-accent-foreground' : 'text-foreground'"
      @click="showApp"
    >
      <MainLogo class="size-4" />
    </ButtonUI>
    <div v-else class="flex py-2 w-7 items-center justify-center text-foreground">
      <MainLogo class="size-4" />
    </div>
    <div class="my-1 h-px w-full bg-input" />

    <ButtonUI
      variant="ghost"
      :icon="Files"
      tooltip="Pages"
      tooltip-side="right"
      class="w-7"
      :class="pagesOpen ? 'text-accent-foreground' : 'text-muted-foreground'"
      @click="togglePages"
    />

    <!-- Building tools: both are Build-surface columns, so contributors —
         content-only, pinned to Preview — don't get either -->
    <ButtonUI
      v-if="canBuild"
      variant="ghost"
      :icon="Component"
      tooltip="Components"
      tooltip-side="right"
      class="w-7"
      :class="showComponents ? 'text-accent-foreground' : 'text-muted-foreground'"
      @click="toggleComponents"
    />
    <ButtonUI
      v-if="canBuild"
      variant="ghost"
      :icon="Layers"
      tooltip="Layers"
      tooltip-side="right"
      class="w-7"
      :class="showLayers ? 'text-accent-foreground' : 'text-muted-foreground'"
      @click="toggleLayers"
    />
    <ButtonUI
      variant="ghost"
      :icon="Feather"
      tooltip="Preview"
      tooltip-side="right"
      class="w-7"
      :class="isPreview ? 'text-accent-foreground' : 'text-muted-foreground'"
      @click="setMode('preview')"
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
