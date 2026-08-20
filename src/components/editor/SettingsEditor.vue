<script setup lang="ts">
import { computed, ref, type Component } from 'vue'
import { Palette, Zap, MessageSquare, GitBranch, SquarePen, CircleHelp, Sun, Moon } from 'lucide-vue-next'
import { useCheatSheet } from '@/composables/useCheatSheet'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import HostPopover from '@/components/popover/HostPopover.vue'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import StyleEditor from '@/components/editor/StyleEditor.vue'
import CommentsEditor from '@/components/editor/CommentsEditor.vue'
import InteractionsEditor from '@/components/editor/InteractionsEditor.vue'
import BranchesEditor from '@/components/editor/BranchesEditor.vue'
import ContentEditor from '@/components/editor/ContentEditor.vue'
import { useBranches } from '@/composables/useBranches'
import { useElement } from '@/composables/useElement'
import { elementIcon } from '@/lib/elementIcons'
import { usePanel } from '@/composables/usePanel'
import { useInteraction } from '@/composables/useInteraction'
import { useTheme } from '@/composables/useTheme'
import { onBeforeUnmount, onMounted } from 'vue'

interface Panel {
  id: string
  label: string
  icon: Component
  divider?: boolean
}

const panels: Panel[] = [
  { id: 'content', label: 'Content', icon: SquarePen },
  { id: 'style', label: 'Style', icon: Palette },
  { id: 'interactions', label: 'Interactions', icon: Zap },
  { id: 'comments', label: 'Comments', icon: MessageSquare, divider: true },
  { id: 'branches', label: 'Branches', icon: GitBranch },
]

const { activePanelId, onEscape, togglePanel, closePanel } = usePanel()
const activePanel = computed(() => panels.find((p) => p.id === activePanelId.value))
const { pickingFor } = useInteraction()

// Escape closes the open panel and returns the user to wherever they
// came from (e.g. their caret in the code editor)
function onWindowKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !activePanelId.value) return
  if (pickingFor.value) return // target picking cancels first, panel stays
  const returnTo = onEscape.value
  closePanel()
  returnTo?.()
}
onMounted(() => window.addEventListener('keydown', onWindowKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown))

const { selectedElement } = useElement()
const { onMain } = useBranches()
const { open: openCheatSheet } = useCheatSheet()
const { theme, toggleTheme } = useTheme()

// element-editing panels show the selected element's icon in the header
const ELEMENT_PANELS = ['content', 'style', 'interactions']
const headerIcon = computed(() => {
  if (activePanel.value && ELEMENT_PANELS.includes(activePanel.value.id) && selectedElement.value) {
    return elementIcon(selectedElement.value.type)
  }
  return activePanel.value?.icon
})
</script>

<template>
  <aside class="relative flex h-full w-10 flex-col items-center gap-1 py-2">
    <template v-for="panel in panels" :key="panel.id">
      <div v-if="panel.divider" class="my-1 h-px w-5 bg-input" />
      <ButtonUI
        variant="ghost"
        size="sm"
        :icon="panel.icon"
        class="w-7"
        :class="
          panel.id === 'branches' && !onMain
            ? 'text-pending'
            : activePanelId === panel.id
              ? 'text-accent-foreground'
              : 'text-muted-foreground text-muted-foreground'
        "
        @click="togglePanel(panel.id)"
      />
    </template>

    <ButtonUI
      variant="ghost"
      :icon="theme === 'light' ? Sun : Moon"
      :title="theme === 'light' ? 'Switch to dark' : 'Switch to light'"
      class="mt-auto w-7 text-muted-foreground"
      @click="toggleTheme"
    />

    <ButtonUI
      variant="ghost"
      :icon="CircleHelp"
      title="Shortcuts & syntax"
      class="w-7 text-muted-foreground"
      @click="openCheatSheet"
    />

    <HostPopover
      v-if="activePanel"
      :title="activePanel.label"
      :icon="headerIcon"
      class="absolute top-2 right-full mr-2"
      @close="closePanel()"
    >
      <template v-if="activePanel.id === 'content'">
        <ContentEditor v-if="selectedElement" />
        <GroupPopover v-else>
          <p class="text-xs text-muted-foreground">Select an element to edit it.</p>
        </GroupPopover>
      </template>

      <template v-else-if="activePanel.id === 'style'">
        <StyleEditor v-if="selectedElement" />
        <GroupPopover v-else>
          <p class="text-xs text-muted-foreground">Select an element to style it.</p>
        </GroupPopover>
      </template>

      <template v-else-if="activePanel.id === 'interactions'">
        <InteractionsEditor v-if="selectedElement" />
        <GroupPopover v-else>
          <p class="text-xs text-muted-foreground">Select an element to add interactions.</p>
        </GroupPopover>
      </template>

      <CommentsEditor v-else-if="activePanel.id === 'comments'" />

      <BranchesEditor v-else-if="activePanel.id === 'branches'" />

      <GroupPopover v-else :label="activePanel.label">
        <p class="text-xs text-muted-foreground">Nothing here yet.</p>
      </GroupPopover>
    </HostPopover>
  </aside>
</template>
