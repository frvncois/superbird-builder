<script setup lang="ts">
// ONE effect, editable in full: its name, who uses it, and what it does.
//
// Shared by the drawer's two views. The effect view shows the one picked in the
// library; the trigger view shows the one the selected element's trigger runs,
// beside that action's options — so an effect is never "opened" from a row, it
// is simply there.
//
// Takes a kind + id and re-resolves, never an object: undo and a branch switch
// swap the whole project graph, so a held object would detach silently.
import { computed } from 'vue'
import { Plus } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import EffectEditor from '@/components/editor/effects/EffectEditor.vue'
import StyleEffectEditor from '@/components/editor/effects/StyleEffectEditor.vue'
import TimelineEditor from '@/components/editor/effects/TimelineEditor.vue'
import { useEffects } from '@/composables/useEffects'
import { useInteraction } from '@/composables/useInteraction'
import { useAnimation } from '@/composables/useAnimation'
import { useEffectsDrawer, type DrawerKind } from '@/composables/useEffectsDrawer'

const props = defineProps<{ kind: DrawerKind; id: string }>()

const interactions = useInteraction()
const animations = useAnimation()
const effects = useEffects()
const { selected, openEffect } = useEffectsDrawer()

const wrapper = computed(() => (props.kind === 'effect' ? (effects.effectById(props.id) ?? null) : null))

/** what the name row names — the effect, or the lone half */
const effect = computed(() => {
  if (props.kind === 'effect') return wrapper.value
  return props.kind === 'interaction'
    ? (interactions.animationFor(props.id) ?? null)
    : (animations.animationFor(props.id) ?? null)
})

const usedOn = computed(() => {
  if (props.kind === 'effect') return wrapper.value ? effects.usageCount(wrapper.value) : 0
  return props.kind === 'interaction'
    ? interactions.usageCount(props.id)
    : animations.usageCount(props.id)
})

/** an effect's halves carry its name too, so the two libraries read the same
 *  way from anywhere that still shows them */
function setName(value: string) {
  if (wrapper.value) effects.rename(wrapper.value, value)
  else if (effect.value) effect.value.name = value
}

/**
 * Give a single-engine half its other half. A half that predates the pairing —
 * or one a preset or an agent made — is still one engine; one button completes
 * it, never mere selection: a library row you only looked at must not come back
 * changed. `addHalf` spreads the new half to every element already using it.
 */
function pairUp() {
  if (props.kind === 'effect') return
  const name = effect.value?.name ?? 'Effect'
  const wrapped = effects.wrap(props.kind, props.id, name)
  effects.addHalf(wrapped, props.kind === 'interaction' ? 'animation' : 'interaction')
  // the effect view was pointed at the half; point it at the whole
  if (selected.value?.kind === props.kind && selected.value.id === props.id) {
    openEffect('effect', wrapped.id)
  }
}
</script>

<template>
  <div v-if="effect" data-effect-body class="flex flex-col">
    <div class="flex h-9 shrink-0 items-center gap-2 border-b border-input px-2.5">
      <div class="w-48 shrink-0">
        <InputUI :model-value="effect.name" placeholder="Effect name" @update:model-value="setName" />
      </div>
      <span class="shrink-0 text-[10px] text-muted-foreground">
        used on {{ usedOn }} element{{ usedOn === 1 ? '' : 's' }}
      </span>
    </div>

    <EffectEditor v-if="kind === 'effect'" :id="id" />
    <template v-else>
      <StyleEffectEditor v-if="kind === 'interaction'" :id="id" />
      <TimelineEditor v-else :id="id" />
      <div class="border-t border-input px-2.5 py-2">
        <ButtonUI variant="ghost" size="xs" :icon="Plus" class="text-muted-foreground" @click="pairUp()">
          {{ kind === 'interaction' ? 'Motion' : 'Classes' }}
        </ButtonUI>
      </div>
    </template>
  </div>
</template>
