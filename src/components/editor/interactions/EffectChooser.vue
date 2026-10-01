<script setup lang="ts">
// The Add chooser: everything that can be put on the selected element —
// motion presets, the two saved libraries, and New. It takes over the panel
// like the detail view does, so the list itself only ever shows what THIS
// element does.
//
// It is also where the libraries are managed (rename via Edit, Delete): a
// project-level thing, so it works with no selection too — only Apply needs one.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowLeft, Plus } from 'lucide-vue-next'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import EffectLibraryList from '@/components/editor/interactions/EffectLibraryList.vue'
import { usePanel, focusWhenPanelVisible } from '@/composables/usePanel'
import { useElement } from '@/composables/useElement'
import { useComponents } from '@/composables/useComponents'
import { useInteraction } from '@/composables/useInteraction'
import { useAnimation } from '@/composables/useAnimation'
import { useEffectDetail } from '@/composables/useEffectDetail'
import { MOTION_PRESETS } from '@/lib/motionPresets'

const { isMultiSelect } = useElement()
const { editTarget } = useComponents()
const interactions = useInteraction()
const animations = useAnimation()
const { openDetail, closeChooser, openBindingId } = useEffectDetail()
const { pickingFor } = interactions

// inside a component instance, effects land on the shared master
const target = editTarget
const canApply = computed(() => !!target.value && !isMultiSelect.value)

const where = computed(() => {
  const n = target.value
  if (!canApply.value || !n) return 'Library'
  return `Add to ${n.ref ? `#${n.ref}` : n.type}`
})

// --- presets: a new animation each time, already on the element ---

function fromPreset(presetId: (typeof MOTION_PRESETS)[number]['id']) {
  const preset = MOTION_PRESETS.find((p) => p.id === presetId)
  const animation = animations.createFromPreset(presetId)
  if (canApply.value) {
    // applyTo returns the binding it made — reading it back off the end of the
    // list would pick the wrong one the moment anything else appends
    const binding = animations.applyTo(target.value!, animation.id)
    // the preset knows which trigger it was designed for
    if (preset) binding.trigger = preset.trigger
    openBindingId.value = binding.id
    closeChooser()
    return
  }
  // nothing to put it on: it goes in the library, open for naming
  openDetail('animation', animation.id, true)
}

// --- the libraries ---

const animationItems = computed(() => animations.library.value.map((a) => ({ id: a.id, name: a.name })))
const interactionItems = computed(() => interactions.library.value.map((i) => ({ id: i.id, name: i.name })))

const isAnimationApplied = (id: string) => !!target.value?.animations?.some((b) => b.animationId === id)
const isInteractionApplied = (id: string) => !!target.value?.interactions?.some((b) => b.interactionId === id)

function applyAnimation(id: string) {
  if (!canApply.value || isAnimationApplied(id)) return
  openBindingId.value = animations.applyTo(target.value!, id).id
  closeChooser()
}
function applyInteraction(id: string) {
  if (!canApply.value || isInteractionApplied(id)) return
  openBindingId.value = interactions.applyTo(target.value!, id).id
  closeChooser()
}

/** an invalid animation applied nowhere has no row to report on it, so the
 * library row is the only place its error can surface */
function errorFor(animationId: string): string | null {
  const animation = animations.animationFor(animationId)
  return animation ? animations.animationError(animation) : null
}

/** creating always adds to the library and opens the editor; applying to the
 * selection is the bonus when there IS one */
function newAnimation() {
  const animation = animations.createAnimation()
  if (canApply.value) openBindingId.value = animations.applyTo(target.value!, animation.id).id
  openDetail('animation', animation.id, true)
}
function newInteraction() {
  const interaction = interactions.createInteraction()
  if (canApply.value) openBindingId.value = interactions.applyTo(target.value!, interaction.id).id
  openDetail('interaction', interaction.id, true)
}

// `I` in the Layers tree lands here when the chooser is what's open
const { pendingFocus } = usePanel()
const newButton = ref<InstanceType<typeof ButtonUI>>()
function consumeFocus() {
  if (pendingFocus.value !== 'interactions') return
  pendingFocus.value = null
  focusWhenPanelVisible(() => newButton.value?.$el?.focus?.())
}
onMounted(consumeFocus)
watch(pendingFocus, consumeFocus)

// Escape peels back to the list instead of closing the whole panel (capture
// phase + stopPropagation beats SettingsEditor's bubble handler to it)
function onKeydownCapture(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (pickingFor.value) return
  e.stopPropagation()
  closeChooser()
}
onMounted(() => window.addEventListener('keydown', onKeydownCapture, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydownCapture, true))
</script>

<template>
  <div class="flex flex-col">
    <div class="flex items-center gap-1 border-b border-input px-1 py-1.5">
      <ButtonUI
        variant="icon" size="sm" :icon="ArrowLeft" tooltip="Back"
        class="w-7 text-muted-foreground"
        @click="closeChooser()"
      />
      <span class="min-w-0 flex-1 truncate px-1 text-xs font-medium">{{ where }}</span>
    </div>

    <GroupPopover label="Presets">
      <p v-if="!canApply" class="text-[10px] text-muted-foreground">
        Select an element to put one on it.
      </p>
      <div class="grid grid-cols-2 gap-1">
        <button
          v-for="preset in MOTION_PRESETS"
          :key="preset.id"
          v-tooltip="preset.description"
          type="button"
          class="flex h-8 min-w-0 items-center gap-1.5 rounded-xl border border-input px-2 text-left text-xs outline-none transition-colors hover:border-accent hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-accent"
          @click="fromPreset(preset.id)"
        >
          <span class="min-w-0 flex-1 truncate">{{ preset.label }}</span>
          <Plus class="size-3 shrink-0 text-muted-foreground" />
        </button>
      </div>
    </GroupPopover>

    <EffectLibraryList
      label="Animation library"
      :items="animationItems"
      empty-text="No saved animations yet."
      noun="animation"
      :is-applied="isAnimationApplied"
      :usage-count="animations.usageCount"
      :can-apply="canApply"
      :error-for="errorFor"
      @open="(id) => openDetail('animation', id)"
      @apply="applyAnimation"
      @remove="animations.deleteAnimation"
    >
      <template #actions>
        <ButtonUI variant="outline" size="sm" :icon="Plus" class="w-full" @click="newAnimation">
          New animation
        </ButtonUI>
      </template>
    </EffectLibraryList>

    <EffectLibraryList
      label="Interaction library"
      :items="interactionItems"
      empty-text="No saved interactions yet."
      noun="interaction"
      :is-applied="isInteractionApplied"
      :usage-count="interactions.usageCount"
      :can-apply="canApply"
      @open="(id) => openDetail('interaction', id)"
      @apply="applyInteraction"
      @remove="interactions.deleteInteraction"
    >
      <template #actions>
        <ButtonUI ref="newButton" variant="outline" size="sm" :icon="Plus" class="w-full" @click="newInteraction">
          New interaction
        </ButtonUI>
      </template>
    </EffectLibraryList>
  </div>
</template>
