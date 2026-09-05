<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import { Palette, Zap, GitBranch, Sun, Moon, Code, Database } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import PanelPopoverBody from '@/components/editor/sidebar/PanelPopoverBody.vue'
import { useBranches } from '@/composables/useBranches'
import { useElement } from '@/composables/useElement'
import { elementIcon } from '@/lib/elementIcons'
import { usePanel } from '@/composables/usePanel'
import { usePopover } from '@/composables/usePopover'
import { useModal } from '@/composables/useModal'
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
// The panel popover opts out of the PopoverHost Escape (closeOnEscape: false)
// so this handler stays the single owner of that flow.
function onWindowKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (useModal().stack.value.length) return // an open modal owns Escape
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

// --- the panel popover lives in the app PopoverHost, anchored to this rail.
// It opens once per null → panel transition; switching panels just swaps the
// body/title reactively (PanelPopoverBody reads activePanelId itself).
const railEl = ref<HTMLElement>()
const { currentId, openPopover, closePopover } = usePopover()

watch(activePanel, (panel, prev) => {
  if (panel && !prev && railEl.value) {
    openPopover({
      id: 'sidebar-panel',
      component: PanelPopoverBody,
      anchor: railEl.value,
      placement: 'left-start',
      title: () => activePanel.value?.label ?? '',
      icon: () => headerIcon.value,
      closeOnEscape: false,
      onClose: () => closePanel(),
    })
  } else if (!panel && currentId.value === 'sidebar-panel') {
    closePopover()
  }
})
</script>

<template>
  <aside ref="railEl" class="relative flex h-full w-10 flex-col items-center gap-1 py-2">
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
      :tooltip="theme === 'light' ? 'Switch to dark' : 'Switch to light'"
      tooltip-side="left"
      class="mt-auto w-7 text-muted-foreground"
      @click="toggleTheme"
    />
  </aside>
</template>
