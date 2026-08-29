<script setup lang="ts">
import { computed, ref, type Component } from 'vue'
import { Palette, Zap, GitBranch, CircleHelp, Sun, Moon, Code, Database } from 'lucide-vue-next'
import { useDocumentation } from '@/composables/useDocumentation'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import HostPopover from '@/components/popover/HostPopover.vue'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import StyleEditor from '@/components/editor/style/StyleEditor.vue'
import InteractionsEditor from '@/components/editor/interactions/InteractionsEditor.vue'
import CustomCodeEditor from '@/components/editor/code/CustomCodeEditor.vue'
import BranchesEditor from '@/components/editor/drafts/BranchesEditor.vue'
import DataEditor from '@/components/editor/content/DataEditor.vue'
import { useBranches } from '@/composables/useBranches'
import { useElement } from '@/composables/useElement'
import { elementIcon } from '@/lib/elementIcons'
import { usePanel } from '@/composables/usePanel'
import { useInteraction } from '@/composables/useInteraction'
import { isEditable } from '@/composables/useShortcut'
import { useTheme } from '@/composables/useTheme'
import { onBeforeUnmount, onMounted } from 'vue'

interface Panel {
  id: string
  label: string
  icon: Component
  divider?: boolean
}

const panels: Panel[] = [
  { id: 'data', label: 'Data', icon: Database },
  { id: 'style', label: 'Style', icon: Palette },
  { id: 'interactions', label: 'Interactions', icon: Zap },
  { id: 'custom-code', label: 'Custom code', icon: Code, divider: true },
  { id: 'branches', label: 'Drafts', icon: GitBranch, divider: true },
]

const { activePanelId, togglePanel, closePanel } = usePanel()
const activePanel = computed(() => panels.find((p) => p.id === activePanelId.value))
const { pickingFor } = useInteraction()
const { selectedElement, isMultiSelect, requestEditorFocus } = useElement()

// Escape always returns to the code editor with the caret on the current
// selection: it closes an open panel first, and otherwise pulls focus back from
// the canvas/sidebar. It defers to a focused text field (the code editor's own
// Esc dismisses its ghost; other inputs handle their own) and to target picking.
function onWindowKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (pickingFor.value) return // target picking cancels first
  if (activePanelId.value) {
    closePanel()
    requestEditorFocus()
  } else if (!isEditable(document.activeElement)) {
    requestEditorFocus()
  }
}
onMounted(() => window.addEventListener('keydown', onWindowKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown))

const { onMain } = useBranches()
const { open: openDocumentation } = useDocumentation()
const { theme, toggleTheme } = useTheme()

// element-editing panels show the selected element's icon in the header
const ELEMENT_PANELS = ['data', 'style', 'interactions']

/** these panels edit a single element, so they're blocked during a multi-selection */
const blocked = (id: string) => ELEMENT_PANELS.includes(id) && isMultiSelect.value
function onTabClick(id: string) {
  if (blocked(id)) return
  togglePanel(id)
}
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
        :icon="panel.icon"
        class="w-7"
        :disabled="blocked(panel.id)"
        :class="
          blocked(panel.id)
            ? 'opacity-40'
            : panel.id === 'branches' && !onMain
              ? 'text-pending'
              : activePanelId === panel.id
                ? 'text-accent-foreground'
                : 'text-muted-foreground text-muted-foreground'
        "
        @click="onTabClick(panel.id)"
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
      title="Documentation"
      class="w-7 text-muted-foreground"
      @click="openDocumentation()"
    />

    <HostPopover
      v-if="activePanel"
      :title="activePanel.label"
      :icon="headerIcon"
      class="absolute top-2 right-full mr-2"
      @close="closePanel()"
    >
      <template v-if="activePanel.id === 'data'">
        <DataEditor v-if="selectedElement && !isMultiSelect" />
        <GroupPopover v-else>
          <p class="text-xs text-muted-foreground">Select a single element to edit its data.</p>
        </GroupPopover>
      </template>

      <template v-else-if="activePanel.id === 'style'">
        <StyleEditor v-if="selectedElement && !isMultiSelect" />
        <GroupPopover v-else>
          <p class="text-xs text-muted-foreground">Select a single element to style it.</p>
        </GroupPopover>
      </template>

      <template v-else-if="activePanel.id === 'interactions'">
        <InteractionsEditor v-if="selectedElement && !isMultiSelect" />
        <GroupPopover v-else>
          <p class="text-xs text-muted-foreground">Select a single element to add interactions.</p>
        </GroupPopover>
      </template>

      <CustomCodeEditor v-else-if="activePanel.id === 'custom-code'" />

      <BranchesEditor v-else-if="activePanel.id === 'branches'" />

      <GroupPopover v-else :label="activePanel.label">
        <p class="text-xs text-muted-foreground">Nothing here yet.</p>
      </GroupPopover>
    </HostPopover>
  </aside>
</template>
