<script setup lang="ts">
// The site-wide motion knobs, summarised at the foot of the Interactions
// panel. Rendered whether or not an element is selected — these settings
// belong to the project, and looking for them only to be told to select an
// element first would be the wrong lesson. The full set (durations, easing,
// custom timelines) lives in Settings → Interactions, one click away.
import { computed } from 'vue'
import { useSettings } from '@/composables/useSettings'
import { useModal } from '@/composables/useModal'
import { usePopover } from '@/composables/usePopover'
import { TRANSITION_PRESET_OPTIONS, TRANSITION_DEFAULTS } from '@/lib/motion'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import RowUI from '@/components/ui/RowUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import ToggleUI from '@/components/ui/ToggleUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import SettingsPanel from '@/components/shared/SettingsPanel.vue'

const { motion, transitions, smoothScroll } = useSettings()
const { openModal } = useModal()
const { closePopover } = usePopover()

const APPEAR_MODE_OPTIONS = [
  { label: 'Once', value: 'once' },
  { label: 'Every time', value: 'replay' },
  { label: 'Reverse on exit', value: 'reverse' },
]

const PRESET_OPTIONS = [...TRANSITION_PRESET_OPTIONS, { label: 'Custom…', value: 'custom' }]

const appearMode = computed({
  get: () => motion.value.appearMode ?? 'once',
  set: (v: string) => (motion.value.appearMode = v as 'once' | 'replay' | 'reverse'),
})

const preset = computed({
  get: () => transitions.value.preset ?? TRANSITION_DEFAULTS.preset,
  set: (v: string) => (transitions.value.preset = v),
})

function openFullSettings() {
  closePopover()
  openModal(SettingsPanel, { initialSection: 'interactions' })
}
</script>

<template>
  <GroupPopover label="Site-wide">
    <!-- same wording as the per-binding row in AnimationEditor: this is the
         default those inherit -->
    <RowUI label="Replay">
      <SelectUI v-model="appearMode" :options="APPEAR_MODE_OPTIONS" />
    </RowUI>

    <RowUI label="Transitions">
      <ToggleUI v-model="transitions.enabled" />
    </RowUI>
    <RowUI v-if="transitions.enabled" label="Style">
      <SelectUI v-model="preset" :options="PRESET_OPTIONS" />
    </RowUI>

    <RowUI label="Smooth">
      <ToggleUI v-model="smoothScroll.enabled" />
      <span class="text-[10px] text-muted-foreground">inertia scrolling</span>
    </RowUI>

    <ButtonUI variant="outline" size="sm" class="mt-1" @click="openFullSettings">
      All motion settings
    </ButtonUI>
  </GroupPopover>
</template>
