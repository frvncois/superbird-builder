<script setup lang="ts">
import EditorLayout from '@/layouts/EditorLayout.vue'
import AppHeader from '@/components/shared/AppHeader.vue'
import CanvasEditor from '@/components/editor/canvas/CanvasEditor.vue'
import CodeEditor from '@/components/editor/code/CodeEditor.vue'
import SettingsEditor from '@/components/editor/sidebar/SettingsEditor.vue'
import ContextMenu from '@/components/editor/canvas/ContextMenu.vue'
import InsertDragChip from '@/components/editor/canvas/InsertDragChip.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { useEditorShortcuts } from '@/composables/useEditorShortcuts'
import { useEditorBoot } from '@/composables/useEditorBoot'

// editor-zone globals: keymaps live here (NOT in App.vue) so the public
// site never boots them
useEditorShortcuts()

const { ready, bootError, reloadPage } = useEditorBoot()
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
    <template #header>
      <AppHeader mode="build" />
      <InsertDragChip />
    </template>

    <template #left>
      <CodeEditor />
    </template>

    <CanvasEditor />
    <ContextMenu />

    <template #right>
      <SettingsEditor />
    </template>
  </EditorLayout>

  <div v-else class="flex min-h-screen items-center justify-center bg-background">
    <p class="text-xs text-muted-foreground">Loading…</p>
  </div>
</template>
