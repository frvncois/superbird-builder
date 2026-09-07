<script setup lang="ts">
import { ref } from 'vue'
import { GitBranch, Rocket } from 'lucide-vue-next'
import EditorLayout from '@/layouts/EditorLayout.vue'
import AppRail from '@/components/editor/sidebar/AppRail.vue'
import PagesDrawer from '@/components/editor/sidebar/PagesDrawer.vue'
import CanvasEditor from '@/components/editor/canvas/CanvasEditor.vue'
import CodeEditor from '@/components/editor/code/CodeEditor.vue'
import SettingsEditor from '@/components/editor/sidebar/SettingsEditor.vue'
import ContextMenu from '@/components/editor/canvas/ContextMenu.vue'
import InsertDragChip from '@/components/editor/canvas/InsertDragChip.vue'
import PublishDialog from '@/components/shared/PublishDialog.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { useEditorShortcuts } from '@/composables/useEditorShortcuts'
import { useEditorBoot } from '@/composables/useEditorBoot'
import { useBranches } from '@/composables/useBranches'
import { usePanel } from '@/composables/usePanel'
import { useModal } from '@/composables/useModal'

// editor-zone globals: keymaps live here (NOT in App.vue) so the public
// site never boots them
useEditorShortcuts()

const { ready, bootError, reloadPage } = useEditorBoot()

// pages drawer overlays the code pane; opened from the left rail
const pagesDrawerOpen = ref(false)

const { activeBranch, onMain } = useBranches()
const { openPanel } = usePanel()
const { openModal } = useModal()
</script>

<template>
  <div
    v-if="bootError"
    class="flex min-h-screen flex-col items-center justify-center gap-3 bg-background"
  >
    <p class="text-sm font-medium">{{ bootError }}</p>
    <ButtonUI variant="outline" size="sm" @click="reloadPage">Retry</ButtonUI>
  </div>

  <EditorLayout v-else-if="ready">
    <template #rail>
      <AppRail :drawer-open="pagesDrawerOpen" @toggle-drawer="pagesDrawerOpen = !pagesDrawerOpen" />
    </template>

    <template #left>
      <PagesDrawer v-if="pagesDrawerOpen" @close="pagesDrawerOpen = false" />
      <div class="h-full">
        <CodeEditor />
      </div>
    </template>

    <div class="relative h-full">
      <CanvasEditor />

      <!-- floating branch + publish, top right of the canvas -->
      <div class="absolute right-2 top-2 z-30 flex items-center">
        <ButtonUI variant="default" size="sm" :icon="Rocket" @click="openModal(PublishDialog)">
          Publish
        </ButtonUI>
      </div>
    </div>
    <ContextMenu />
    <InsertDragChip />

    <template #right>
      <SettingsEditor />
    </template>
  </EditorLayout>

  <div v-else class="flex min-h-screen items-center justify-center bg-background">
    <p class="text-xs text-muted-foreground">Loading…</p>
  </div>
</template>
