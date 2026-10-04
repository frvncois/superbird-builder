<script setup lang="ts">
// A named effect in full: its class change, its timeline, or both.
//
// The two engines are drawn as two sections of ONE thing rather than two
// library entries, because the split is ours and not the author's: a panel that
// slides in needs `hidden` → `flex` (which no tween can do — the first frame
// after a display change does not animate) AND a slide (which no class swap can
// express without fighting the cascade). Naming that pair once is the whole
// point; see useEffects for what is actually stored, which is only the name and
// the two ids.
import { computed } from 'vue'
import { Plus, Sparkles, Trash2 } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import StyleEffectEditor from '@/components/editor/effects/StyleEffectEditor.vue'
import TimelineEditor from '@/components/editor/effects/TimelineEditor.vue'
import { useEffects } from '@/composables/useEffects'
import { useModal } from '@/composables/useModal'

const props = defineProps<{ id: string }>()

const { effectById, halfIds, addHalf, removeHalf } = useEffects()
const { confirm } = useModal()

const effect = computed(() => effectById(props.id))
/** a half whose library entry has gone counts as absent, so the section offers
 *  to make it again rather than rendering nothing */
const halves = computed(() => (effect.value ? halfIds(effect.value) : {}))

async function drop(kind: 'interaction' | 'animation') {
  const target = effect.value
  if (!target) return
  const ok = await confirm({
    title: kind === 'interaction' ? 'Remove the style change' : 'Remove the motion',
    message:
      `“${target.name}” keeps its other half, but every element using this one loses it. ` +
      'This cannot be undone from here.',
    confirmLabel: 'Remove',
  })
  if (ok) removeHalf(target, kind)
}
</script>

<template>
  <div v-if="effect" class="flex flex-col">
    <!-- the class change -->
    <section data-effect-half="interaction" class="flex flex-col border-b border-input">
      <header class="flex h-8 items-center gap-2 px-2.5">
        <span class="text-[9px] font-medium tracking-wide text-muted-foreground uppercase">
          Style change
        </span>
        <ButtonUI
          v-if="halves.interactionId"
          variant="icon"
          size="xs"
          :icon="Trash2"
          tooltip="Remove the style change"
          class="ml-auto w-5 text-muted-foreground hover:!text-danger"
          @click="drop('interaction')"
        />
      </header>
      <StyleEffectEditor v-if="halves.interactionId" :id="halves.interactionId!" />
      <div v-else class="px-2.5 pb-2">
        <ButtonUI
          variant="outline"
          size="xs"
          :icon="Plus"
          @click="addHalf(effect, 'interaction')"
        >
          Add a style change
        </ButtonUI>
        <p class="pt-1 text-[10px] text-muted-foreground">
          Classes worn while the effect is on — the only way to switch
          <span class="font-mono">display</span>, which no timeline can tween.
        </p>
      </div>
    </section>

    <!-- the timeline -->
    <section data-effect-half="animation" class="flex flex-col">
      <header class="flex h-8 items-center gap-2 px-2.5">
        <span class="text-[9px] font-medium tracking-wide text-muted-foreground uppercase">
          Motion
        </span>
        <ButtonUI
          v-if="halves.animationId"
          variant="icon"
          size="xs"
          :icon="Trash2"
          tooltip="Remove the motion"
          class="ml-auto w-5 text-muted-foreground hover:!text-danger"
          @click="drop('animation')"
        />
      </header>
      <TimelineEditor v-if="halves.animationId" :id="halves.animationId!" />
      <div v-else class="px-2.5 pb-2">
        <ButtonUI
          variant="outline"
          size="xs"
          :icon="Sparkles"
          @click="addHalf(effect, 'animation')"
        >
          Add motion
        </ButtonUI>
        <p class="pt-1 text-[10px] text-muted-foreground">
          A timeline over real values — movement a class swap cannot express.
        </p>
      </div>
    </section>
  </div>
</template>
