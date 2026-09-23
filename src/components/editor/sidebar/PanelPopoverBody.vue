<script setup lang="ts">
// Body of the right-sidebar panel popover, rendered by the app PopoverHost.
// Reads the active panel id itself so switching panels swaps the body without
// reopening the popover.
import GroupPopover from '@/components/popover/GroupPopover.vue'
import StyleEditor from '@/components/editor/style/StyleEditor.vue'
import InteractionsEditor from '@/components/editor/interactions/InteractionsEditor.vue'
import InteractionDetail from '@/components/editor/interactions/InteractionDetail.vue'
import AnimationDetail from '@/components/editor/interactions/AnimationDetail.vue'
import SiteMotionPopover from '@/components/editor/interactions/SiteMotionPopover.vue'
import BranchesEditor from '@/components/editor/drafts/BranchesEditor.vue'
import DataEditor from '@/components/editor/content/DataEditor.vue'
import { usePanel } from '@/composables/usePanel'
import { useElement } from '@/composables/useElement'
import { useAuth } from '@/composables/useAuth'
import { useEffectDetail } from '@/composables/useEffectDetail'

const { activePanelId } = usePanel()
const { selectedElement, isMultiSelect } = useElement()
const { canBuild } = useAuth()
const { detail } = useEffectDetail()
</script>

<template>
  <template v-if="activePanelId === 'data'">
    <DataEditor v-if="selectedElement && !isMultiSelect" />
    <GroupPopover v-else>
      <p class="text-xs text-muted-foreground">Select a single element to edit its data.</p>
    </GroupPopover>
  </template>

  <template v-else-if="activePanelId === 'style'">
    <StyleEditor v-if="selectedElement && !isMultiSelect" />
    <GroupPopover v-else>
      <p class="text-xs text-muted-foreground">Select a single element to style it.</p>
    </GroupPopover>
  </template>

  <template v-else-if="activePanelId === 'interactions'">
    <!-- creating or editing an effect takes over the whole panel: it is a
         project-level thing, and showing it among per-element cards made it
         read as per-element -->
    <template v-if="detail">
      <InteractionDetail
        v-if="detail.kind === 'interaction'"
        :key="detail.id"
        :id="detail.id"
        :created="detail.created"
      />
      <AnimationDetail v-else :key="detail.id" :id="detail.id" :created="detail.created" />
    </template>
    <template v-else>
      <!-- the libraries are project-level, so this renders with no selection
           too; only the per-element cards and Apply need one -->
      <InteractionsEditor />
      <SiteMotionPopover v-if="canBuild" />
    </template>
  </template>

  <BranchesEditor v-else-if="activePanelId === 'branches'" />

  <GroupPopover v-else>
    <p class="text-xs text-muted-foreground">Nothing here yet.</p>
  </GroupPopover>
</template>
