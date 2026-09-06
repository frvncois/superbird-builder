<script setup lang="ts">
import { Code2, Loader2, Sparkles } from 'lucide-vue-next'
import EditorLayout from '@/layouts/EditorLayout.vue'
import AppHeader from '@/components/shared/AppHeader.vue'
import CanvasEditor from '@/components/editor/canvas/CanvasEditor.vue'
import CodeEditor from '@/components/editor/code/CodeEditor.vue'
import AgentChat from '@/components/editor/agent/AgentChat.vue'
import SettingsEditor from '@/components/editor/sidebar/SettingsEditor.vue'
import ContextMenu from '@/components/editor/canvas/ContextMenu.vue'
import InsertDragChip from '@/components/editor/canvas/InsertDragChip.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { useEditorShortcuts } from '@/composables/useEditorShortcuts'
import { useEditorBoot } from '@/composables/useEditorBoot'
import { useAgent } from '@/composables/useAgent'

// editor-zone globals: keymaps live here (NOT in App.vue) so the public
// site never boots them
useEditorShortcuts()

const { ready, bootError, reloadPage } = useEditorBoot()

// the left pane toggles between the code editor and the AI assistant chat;
// both stay mounted (v-show) so code-editor state survives a switch
const { leftPane, busy: agentBusy } = useAgent()
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
      <div class="flex h-full flex-col">
        <div class="flex shrink-0 gap-1 p-2 pb-0">
          <button
            type="button"
            class="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg text-[10px] font-medium transition-colors"
            :class="leftPane === 'code' ? 'bg-accent/50 text-foreground' : 'text-muted-foreground hover:bg-accent/30'"
            @click="leftPane = 'code'"
          >
            <Code2 class="size-3" /> Code
          </button>
          <button
            type="button"
            class="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg text-[10px] font-medium transition-colors"
            :class="leftPane === 'assistant' ? 'bg-accent/50 text-foreground' : 'text-muted-foreground hover:bg-accent/30'"
            @click="leftPane = 'assistant'"
          >
            <Sparkles class="size-3" /> Assistant
          </button>
        </div>
        <div class="min-h-0 flex-1">
          <CodeEditor v-show="leftPane === 'code'" />
          <AgentChat v-show="leftPane === 'assistant'" />
        </div>
      </div>
    </template>

    <div class="relative h-full">
      <CanvasEditor />
      <!-- lock+refresh: while the assistant edits the store, the canvas shows
           the pre-run state — block edits so autosave-suspended work can't be
           lost when the refreshed project is swapped in -->
      <div
        v-if="agentBusy"
        class="absolute inset-0 z-40 flex cursor-progress items-start justify-center bg-background/20 backdrop-blur-[1px]"
      >
        <p
          class="mt-6 flex items-center gap-2 rounded-full border border-accent/40 bg-background px-4 py-2 text-xs font-medium shadow-sm"
        >
          <Loader2 class="size-3.5 animate-spin" /> Assistant is editing…
        </p>
      </div>
    </div>
    <ContextMenu />

    <template #right>
      <SettingsEditor />
    </template>
  </EditorLayout>

  <div v-else class="flex min-h-screen items-center justify-center bg-background">
    <p class="text-xs text-muted-foreground">Loading…</p>
  </div>
</template>
