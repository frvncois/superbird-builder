<script setup lang="ts">
// A named effect in full: the classes it wears and the motion it runs, as ONE
// thing.
//
// The two engines are not two sections the author chooses between. A panel that
// slides in needs `hidden` → `flex` (which no tween can do — the first frame
// after a display change does not animate) AND a slide (which no class swap can
// express without fighting the cascade); that split is ours, so the editor
// shows the class row and the timeline in one flow, with nothing naming an
// engine. See useEffects for what is actually stored, which is only the name and
// the two ids.
//
// A new effect always has both halves. One made before that was so — by a
// preset, an agent, or an older project — may be missing one, and the missing
// half is a single button here: nothing is created merely by opening it, since a
// library row you only looked at must not come back changed.
import { computed } from 'vue'
import { Plus } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import StyleEffectEditor from '@/components/editor/effects/StyleEffectEditor.vue'
import TimelineEditor from '@/components/editor/effects/TimelineEditor.vue'
import { useEffects } from '@/composables/useEffects'

const props = defineProps<{ id: string }>()

const { effectById, halfIds, addHalf } = useEffects()

const effect = computed(() => effectById(props.id))
/** a half whose library entry has gone counts as absent, so the editor offers
 *  to make it again rather than rendering nothing */
const halves = computed(() => (effect.value ? halfIds(effect.value) : {}))
</script>

<template>
  <div v-if="effect" class="flex flex-col">
    <!-- the classes worn while it is on -->
    <div data-effect-half="interaction" class="border-b border-input">
      <StyleEffectEditor v-if="halves.interactionId" :id="halves.interactionId!" />
      <div v-else class="px-2.5 py-2">
        <ButtonUI
          variant="ghost"
          size="xs"
          :icon="Plus"
          class="text-muted-foreground"
          @click="addHalf(effect, 'interaction')"
        >
          Classes
        </ButtonUI>
      </div>
    </div>

    <!-- the timeline -->
    <div data-effect-half="animation">
      <TimelineEditor v-if="halves.animationId" :id="halves.animationId!" />
      <div v-else class="px-2.5 py-2">
        <ButtonUI
          variant="ghost"
          size="xs"
          :icon="Plus"
          class="text-muted-foreground"
          @click="addHalf(effect, 'animation')"
        >
          Motion
        </ButtonUI>
      </div>
    </div>
  </div>
</template>
