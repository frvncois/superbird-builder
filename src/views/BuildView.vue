<script setup lang="ts">
// The single editing shell. The bottom-right Edit / Play toggle (`ModeToggle`)
// switches the surface between Build (breakpoint canvas + full inspector) and
// Preview (full-site render, restricted sidebar) — shown as Edit and Play, the
// only names the user sees.
// The centre is either the open page or the components board (`canvas`), and
// the 16rem track beside the rail holds Pages or Components (`column`). Layers
// are edited inside those columns: a page's from its Edit icon in Pages, a
// component's by expanding its row in Components.
// Contributors are pinned to Play.
import EditorLayout from '@/layouts/EditorLayout.vue'
import AppRail from '@/components/editor/sidebar/AppRail.vue'
import PagesDrawer from '@/components/editor/sidebar/PagesDrawer.vue'
import ComponentsDrawer from '@/components/editor/sidebar/ComponentsDrawer.vue'
import CanvasEditor from '@/components/editor/canvas/CanvasEditor.vue'
import ComponentsBoard from '@/components/editor/canvas/ComponentsBoard.vue'
import SettingsEditor from '@/components/editor/sidebar/SettingsEditor.vue'
import ContextMenu from '@/components/editor/canvas/ContextMenu.vue'
import InsertDragChip from '@/components/editor/canvas/InsertDragChip.vue'
import ModeToggle from '@/components/editor/canvas/ModeToggle.vue'
import SitePreview from '@/components/site/SitePreview.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { useEditorShortcuts } from '@/composables/useEditorShortcuts'
import { useEditorBoot } from '@/composables/useEditorBoot'
import { useAuth } from '@/composables/useAuth'
import { useViewMode } from '@/composables/useViewMode'

// editor-zone globals: keymaps live here (NOT in App.vue) so the public
// site never boots them. Structural shortcuts self-gate to Build mode.
useEditorShortcuts()

const { ready, bootError, reloadPage } = useEditorBoot()
const { canBuild } = useAuth()
const { isBuild, visibleColumn, showComponents } = useViewMode()
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

      <!-- center: Build canvas or full-site preview, with the Edit / Play
           toggle floating over whichever is up -->
      <div class="relative h-full">
        <template v-if="isBuild">
          <ComponentsBoard v-if="showComponents" />
          <CanvasEditor v-else />
        </template>
        <SitePreview v-else />

        <!-- Bottom RIGHT: the bottom-left corner is the InsertDock's, and the
             two must not share it — Insert belongs to the canvas, the mode
             belongs to the whole surface. A page's mode, so the board (nothing
             to play) doesn't get it, and neither does a contributor, who is
             pinned to Play with no switch to offer. Switching must not move
             it, or it slides out from under the pointer that just clicked it:
             Play's extra 9px pays back the framed pane's my-2 + border, which
             the unframed one doesn't have. -->
        <ModeToggle
          v-if="canBuild && !showComponents"
          class="absolute right-1 z-40"
          :class="isBuild ? 'bottom-1' : 'bottom-[13px]'"
        />
      </div>
      <template v-if="isBuild">
        <ContextMenu />
        <InsertDragChip />
      </template>

      <template #right>
        <SettingsEditor />
      </template>
    </EditorLayout>
  </template>

  <div v-else class="flex min-h-screen items-center justify-center bg-background">
    <p class="text-xs text-muted-foreground">Loading…</p>
  </div>
</template>
