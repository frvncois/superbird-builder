<script setup lang="ts">
// The single editing shell. A rail toggle switches the surface between Build
// (breakpoint canvas + full inspector) and Preview (full-site render,
// restricted sidebar). The code editor is a separate column Build opens
// beside the canvas — off by default, toggled by the rail's Code button. The
// pages and components drawers are columns of the same kind; all three share
// one slot, so opening any closes the others.
// Contributors are pinned to Preview.
import EditorLayout from '@/layouts/EditorLayout.vue'
import AppRail from '@/components/editor/sidebar/AppRail.vue'
import PagesDrawer from '@/components/editor/sidebar/PagesDrawer.vue'
import ComponentsDrawer from '@/components/editor/sidebar/ComponentsDrawer.vue'
import CanvasEditor from '@/components/editor/canvas/CanvasEditor.vue'
import CodeEditor from '@/components/editor/code/CodeEditor.vue'
import SettingsEditor from '@/components/editor/sidebar/SettingsEditor.vue'
import ContextMenu from '@/components/editor/canvas/ContextMenu.vue'
import InsertDragChip from '@/components/editor/canvas/InsertDragChip.vue'
import SitePreview from '@/components/site/SitePreview.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { useEditorShortcuts } from '@/composables/useEditorShortcuts'
import { useEditorBoot } from '@/composables/useEditorBoot'
import { useViewMode } from '@/composables/useViewMode'

// editor-zone globals: keymaps live here (NOT in App.vue) so the public
// site never boots them. Structural shortcuts self-gate to Build mode.
useEditorShortcuts()

const { ready, bootError, reloadPage } = useEditorBoot()
const { isBuild, visibleColumn } = useViewMode()
</script>

<template>
  <div
    v-if="bootError"
    class="flex min-h-screen flex-col items-center justify-center gap-3 bg-background"
  >
    <p class="text-sm font-medium">{{ bootError }}</p>
    <ButtonUI variant="outline" size="sm" @click="reloadPage">Retry</ButtonUI>
  </div>

  <template v-else-if="ready">
    <EditorLayout :column="visibleColumn" :framed="isBuild">
      <template #rail>
        <AppRail />
      </template>

      <template v-if="visibleColumn === 'pages'" #pages>
        <PagesDrawer />
      </template>

      <template v-if="visibleColumn === 'components'" #components>
        <ComponentsDrawer />
      </template>

      <template v-if="visibleColumn === 'code'" #code>
        <div class="h-full">
          <CodeEditor />
        </div>
      </template>

      <!-- center: Build canvas or full-site preview -->
      <template v-if="isBuild">
        <div class="relative h-full">
          <CanvasEditor />
        </div>
        <ContextMenu />
        <InsertDragChip />
      </template>
      <SitePreview v-else />

      <template #right>
        <SettingsEditor />
      </template>
    </EditorLayout>
  </template>

  <div v-else class="flex min-h-screen items-center justify-center bg-background">
    <p class="text-xs text-muted-foreground">Loading…</p>
  </div>
</template>
