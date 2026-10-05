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
// It is also where an ELEMENT's actions are managed. The Interactions panel
// only lists the selected element's triggers; each one opens the drawer's
// trigger view (TriggerEditor) — the one action it runs, options and effect
// side by side — so the left column is the drawer's index (the element's
// triggers on top, the project's effects below) and the main pane is whichever
// of the two is being edited.
//
// It is NOT docked by default: the canvas pays per rendered element per frame,
// and a drawer that opens itself would shrink the canvas unasked. ⌘⇧E, an
// effect name in the panel, a trigger in the panel, or "All effects" opens it.
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { X, Zap } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import EffectBody from '@/components/editor/effects/EffectBody.vue'
import EffectLibrary from '@/components/editor/effects/EffectLibrary.vue'
import TriggerEditor from '@/components/editor/effects/TriggerEditor.vue'
import { useEffectsDrawer } from '@/composables/useEffectsDrawer'
import { useElementEffects } from '@/composables/useElementEffects'
import { useInteraction } from '@/composables/useInteraction'
import { useAnimation } from '@/composables/useAnimation'
import { useEffects } from '@/composables/useEffects'
import { useModal } from '@/composables/useModal'
import { isEditable } from '@/composables/useShortcut'
import { triggerOrder, triggerSentence, uiTrigger } from '@/lib/effectTriggers'

const { open, selected, trigger, view, openTrigger, done, closeDrawer } = useEffectsDrawer()
const interactions = useInteraction()
const animations = useAnimation()
const effects = useEffects()
const { canEdit, elementLabel, sections } = useElementEffects()

/**
 * The element's triggers for the left column: the ones with an action, plus the
 * one being filled when it has none yet, so it has a row the moment it is
 * opened from the panel.
 */
const triggerRows = computed(() => {
  if (!canEdit.value) return []
  const list = sections.value.map((s) => ({ trigger: s.trigger, count: s.rows.length }))
  if (trigger.value && !list.some((r) => r.trigger === trigger.value)) {
    list.push({ trigger: trigger.value, count: 0 })
  }
  return list.sort((a, b) => triggerOrder(a.trigger) - triggerOrder(b.trigger))
})

const wrapper = computed(() =>
  selected.value?.kind === 'effect' ? (effects.effectById(selected.value.id) ?? null) : null,
)



// --- leaving ---

/** Cancel on a brand-new effect discards it outright. The cascading delete also
 *  strips any binding it had, wherever it landed — so it works even if the
 *  element has since been deselected or deleted. */
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
  >
    <aside class="flex w-52 shrink-0 flex-col border-r border-input">
      <!-- the selected element's triggers — what the panel hands here -->
      <div v-if="triggerRows.length" class="flex shrink-0 flex-col border-b border-input">
        <p
          class="flex h-9 shrink-0 items-center gap-1 px-3 text-[9px] font-medium tracking-wide text-muted-foreground uppercase"
        >
          <span class="shrink-0">Element</span>
          <span class="min-w-0 truncate normal-case tracking-normal">· {{ elementLabel }}</span>
        </p>
        <div class="flex flex-col px-1 pb-1.5">
          <button
            v-for="row in triggerRows"
            :key="row.trigger"
            type="button"
            data-drawer-trigger
            class="flex h-7 items-center gap-1.5 rounded-lg px-2 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent"
            :class="
              view === 'trigger' && trigger === row.trigger ? 'bg-accent/30' : 'hover:bg-accent/15'
            "
            @click="openTrigger(row.trigger)"
          >
            <component
              :is="uiTrigger(row.trigger)?.icon ?? Zap"
              class="size-3.5 shrink-0 text-muted-foreground"
            />
            <span class="min-w-0 flex-1 truncate">{{ triggerSentence(row.trigger) }}</span>
            <span v-if="!row.count" class="shrink-0 text-[10px] text-muted-foreground">empty</span>
          </button>
        </div>
      </div>

      <EffectLibrary class="min-h-0 flex-1" />
    </aside>

    <TriggerEditor v-if="view === 'trigger'" :trigger="trigger!" />

    <div v-else class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-9 shrink-0 items-center gap-2 border-b border-input px-2">
        <p class="min-w-0 flex-1 truncate px-1 text-xs text-muted-foreground">
          {{
            selected
              ? 'Shared by every element using it.'
              : canEdit
                ? 'Pick a trigger or an effect on the left.'
                : 'Pick an effect on the left.'
          }}
        </p>

        <div class="ml-auto flex shrink-0 items-center gap-1">
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

      <div class="custom-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <EffectBody v-if="selected" :kind="selected.kind" :id="selected.id" />
      </div>

      <footer
        v-if="selected?.created"
        class="flex h-10 shrink-0 items-center justify-end gap-1.5 border-t border-input px-2"
      >
        <ButtonUI variant="ghost" size="sm" class="text-muted-foreground" @click="cancel">
          Cancel
        </ButtonUI>
        <ButtonUI variant="default" size="sm" @click="done()">Done</ButtonUI>
      </footer>
    </div>
  </section>
</template>
