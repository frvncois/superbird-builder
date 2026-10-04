<script setup lang="ts">
// The effects drawer: the project's whole effect library, and what each effect
// DOES, under the canvas.
//
// An effect is shared by every element using it, so editing it is not a
// per-element act — but it used to take over the element panel, which meant
// losing sight of the element you were working on and of the other effects on
// it. Down here the panel stays up, the canvas stays visible, and a timeline
// gets the width a timeline needs.
//
// It is NOT docked by default: the canvas pays per rendered element per frame,
// and a drawer that opens itself would shrink the canvas unasked. ⌘⇧E, an
// effect name in the panel, or "All effects" opens it.
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { Play, Plus, Sparkles, X } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import EffectEditor from '@/components/editor/effects/EffectEditor.vue'
import EffectLibrary from '@/components/editor/effects/EffectLibrary.vue'
import StyleEffectEditor from '@/components/editor/effects/StyleEffectEditor.vue'
import TimelineEditor from '@/components/editor/effects/TimelineEditor.vue'
import { useEffectsDrawer } from '@/composables/useEffectsDrawer'
import { useInteraction } from '@/composables/useInteraction'
import { useAnimation } from '@/composables/useAnimation'
import { useEffects } from '@/composables/useEffects'
import { useComponents } from '@/composables/useComponents'
import { useMotion } from '@/composables/useMotion'
import { useModal } from '@/composables/useModal'
import { usePopover } from '@/composables/usePopover'
import { isEditable } from '@/composables/useShortcut'

const { open, selected, openEffect, keepEffect, closeDrawer } = useEffectsDrawer()
const interactions = useInteraction()
const animations = useAnimation()
const effects = useEffects()
const { editTarget } = useComponents()
const motion = useMotion()
const { currentId } = usePopover()

/**
 * The sidebar panel is a FLOATING popover over the canvas, anchored to the
 * right rail — so it hangs down over this drawer and would hide the end of a
 * timeline. Reserving its width is the point of the drawer: the panel stays
 * visible, and what is under it stays reachable. 22rem = the panel's own w-84
 * (21rem) plus SettingsEditor's RAIL_POPOVER_OFFSET.
 */
const panelOverlaps = computed(() => currentId.value === 'sidebar-panel')

const wrapper = computed(() =>
  selected.value?.kind === 'effect' ? (effects.effectById(selected.value.id) ?? null) : null,
)

/** the timeline to play, whichever shape the selection is */
const playable = computed(() => {
  const sel = selected.value
  if (!sel) return null
  if (sel.kind === 'animation') return sel.id
  return wrapper.value?.animationId ?? null
})

/** what the header names — the effect, or the lone half */
const effect = computed(() => {
  const sel = selected.value
  if (!sel) return null
  if (sel.kind === 'effect') return wrapper.value
  return sel.kind === 'interaction'
    ? (interactions.animationFor(sel.id) ?? null)
    : (animations.animationFor(sel.id) ?? null)
})

const usedOn = computed(() => {
  const sel = selected.value
  if (!sel) return 0
  if (sel.kind === 'effect') return wrapper.value ? effects.usageCount(wrapper.value) : 0
  return sel.kind === 'interaction' ? interactions.usageCount(sel.id) : animations.usageCount(sel.id)
})

/** an effect's halves carry its name too, so the two libraries read the same
 *  way from anywhere that still shows them */
function setName(value: string) {
  if (wrapper.value) effects.rename(wrapper.value, value)
  else if (effect.value) effect.value.name = value
}

// --- ▶ plays on the selected element ---
//
// A timeline has no element of its own, so the canvas needs one to play on.
// Inside a component instance that is the MASTER node, which is what every
// renderer maps the instance's elements to — the same resolution the panel's
// row uses.

const playTarget = computed(() => editTarget.value?.id ?? null)

function play() {
  if (!playable.value || !playTarget.value) return
  const animation = animations.animationFor(playable.value)
  if (animation) motion.preview(animation, playTarget.value)
}

/**
 * Give a single-engine effect its other half.
 *
 * It names the pair first (`wrap`) and then adds the half, so an effect made
 * before this existed — or by a motion preset, or by an agent, which know only
 * the two libraries — is not stuck as one engine forever. Deliberately an
 * explicit action rather than something selection does: wrapping a library row
 * merely because it was opened would change a project for a look.
 *
 * `addHalf` spreads the new half to every element already using the effect, so
 * this is not a change that applies only to the next placement.
 */
/** the opposite engine's effects that no effect has claimed yet */
const pairable = computed(() => {
  const sel = selected.value
  if (!sel || sel.kind === 'effect') return []
  return effects
    .unclaimed(sel.kind === 'interaction' ? 'animation' : 'interaction')
    .map((item) => ({ label: item.name, value: item.id }))
})

/** join the open half to one that already exists, under the open one's name */
function pairWith(id: string | undefined) {
  const sel = selected.value
  if (!id || !sel || sel.kind === 'effect') return
  const name = effect.value?.name ?? 'Effect'
  const paired =
    sel.kind === 'interaction'
      ? effects.pair(sel.id, id, name)
      : effects.pair(id, sel.id, name)
  openEffect('effect', paired.id)
}

function pairUp() {
  const sel = selected.value
  if (!sel || sel.kind === 'effect') return
  const name = effect.value?.name ?? 'Effect'
  const wrapped = effects.wrap(sel.kind, sel.id, name)
  effects.addHalf(wrapped, sel.kind === 'interaction' ? 'animation' : 'interaction')
  openEffect('effect', wrapped.id)
}

// --- leaving ---

/** Cancel on a brand-new effect discards it outright. The cascading delete also
 *  strips the binding the picker auto-applied, wherever it landed — so it works
 *  even if the element has since been deselected or deleted. */
function cancel() {
  const sel = selected.value
  if (!sel) return
  if (sel.kind === 'effect') {
    if (wrapper.value) effects.deleteEffect(wrapper.value)
  } else if (sel.kind === 'interaction') {
    interactions.deleteInteraction(sel.id)
  } else {
    animations.deleteAnimation(sel.id)
  }
}

// Escape closes the DRAWER and nothing else — one layer per press, like the
// modal stack. Capture phase + stopPropagation beats SettingsEditor's
// bubble-phase handler to it, which would otherwise close the whole panel.
// It yields to a target pick (which cancels first), to an open modal, and to a
// focused field, whose own Escape reverts the text being typed.
function onKeydownCapture(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !open.value) return
  if (interactions.pickingFor.value) return
  if (useModal().stack.value.length) return
  if (isEditable(document.activeElement)) return
  e.stopPropagation()
  closeDrawer()
}
onMounted(() => window.addEventListener('keydown', onKeydownCapture, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydownCapture, true))
</script>

<template>
  <section
    v-if="open"
    data-effects-drawer
    class="flex h-72 min-h-0 shrink-0 border-t border-input bg-background"
    :class="panelOverlaps && 'pr-[22rem]'"
  >
    <EffectLibrary class="w-48 shrink-0 border-r border-input" />

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-9 shrink-0 items-center gap-2 border-b border-input px-2">
        <template v-if="effect">
          <div class="w-48 shrink-0">
            <InputUI
              :model-value="effect.name"
              placeholder="Effect name"
              @update:model-value="setName"
            />
          </div>
          <span class="shrink-0 text-[10px] text-muted-foreground">
            used on {{ usedOn }} element{{ usedOn === 1 ? '' : 's' }}
          </span>
        </template>
        <p v-else class="flex-1 text-xs text-muted-foreground">
          Pick an effect on the left, or make one.
        </p>

        <div class="ml-auto flex shrink-0 items-center gap-1">
          <ButtonUI
            v-if="playable"
            variant="outline"
            size="xs"
            :icon="Play"
            :disabled="!playTarget"
            :tooltip="playTarget ? 'Play on the selected element' : 'Select an element to play it'"
            @click="play"
          >
            Play
          </ButtonUI>
          <ButtonUI
            variant="icon"
            size="sm"
            :icon="X"
            aria-label="Close effects"
            class="w-7 text-muted-foreground"
            @click="closeDrawer()"
          />
        </div>
      </header>

      <div class="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
        <EffectEditor v-if="selected?.kind === 'effect'" :id="selected.id" />
        <template v-else-if="selected">
          <StyleEffectEditor v-if="selected.kind === 'interaction'" :id="selected.id" />
          <TimelineEditor v-else :id="selected.id" />
          <!-- an effect that predates the pairing — or one a preset or an agent
               made — is still one engine. This is how it gains the other,
               without wrapping anything on mere selection: a library row you
               only looked at must not come back changed. -->
          <div class="flex flex-col gap-1.5 border-t border-input px-2.5 py-2">
            <div class="flex items-center gap-2">
              <ButtonUI
                variant="outline"
                size="xs"
                :icon="selected.kind === 'interaction' ? Sparkles : Plus"
                @click="pairUp()"
              >
                {{ selected.kind === 'interaction' ? 'Add motion' : 'Add a style change' }}
              </ButtonUI>
              <p class="min-w-0 flex-1 text-[10px] text-muted-foreground">
                {{
                  selected.kind === 'interaction'
                    ? 'Movement this cannot express as classes — every element already using it gets it too.'
                    : 'Classes worn while it runs, the only way to switch display — every element already using it gets them too.'
                }}
              </p>
            </div>
            <!-- …or join one that already exists. The two libraries produced
                 these separately — an older project, a motion preset, an agent —
                 and this is how a human says they are one thing. -->
            <div v-if="pairable.length" class="flex items-center gap-2">
              <span class="shrink-0 text-[10px] text-muted-foreground">or pair with</span>
              <div class="min-w-0 flex-1">
                <SelectUI
                  :options="pairable"
                  :model-value="''"
                  placeholder="an effect you already have…"
                  @update:model-value="pairWith"
                />
              </div>
            </div>
          </div>
        </template>
      </div>

      <footer
        v-if="selected?.created"
        class="flex h-10 shrink-0 items-center justify-end gap-1.5 border-t border-input px-2"
      >
        <ButtonUI variant="ghost" size="sm" class="text-muted-foreground" @click="cancel">
          Cancel
        </ButtonUI>
        <ButtonUI variant="default" size="sm" @click="keepEffect()">Done</ButtonUI>
      </footer>
    </div>
  </section>
</template>
