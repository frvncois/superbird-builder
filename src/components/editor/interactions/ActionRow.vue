<script setup lang="ts">
// ONE action in a trigger's section: what this element does when the section's
// trigger fires, on one line.
//
// The trigger is the section heading, so the row only has to say WHAT runs and
// (for a click) in WHICH direction — "Open #modal", "Lift". A row may be ONE
// effect wearing both engines: a class change that switches `display` and a
// timeline that moves it. The engine is never named, and when/where is written
// to EVERY half together — an effect whose two halves fired at different
// moments, or landed on different elements, would simply be broken.
//
// What the effect DOES is shared by every element using it and is edited in the
// bottom drawer (⋯ → Edit effect). What is left here is the long tail — target,
// breakpoints, replay, scrub range — folded into the options strip, because a
// value that applies must be reachable, not prominent.
import { computed } from 'vue'
import { ChevronRight, Crosshair, Pencil, Play, Trash2, X } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import MenuUI from '@/components/ui/MenuUI.vue'
import RowUI from '@/components/ui/RowUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import ValueFieldUI from '@/components/ui/ValueFieldUI.vue'
import { useElement } from '@/composables/useElement'
import { useComponents } from '@/composables/useComponents'
import { useProject } from '@/composables/useProject'
import { useInteraction } from '@/composables/useInteraction'
import { useAnimation } from '@/composables/useAnimation'
import { useEffects, type EffectPair } from '@/composables/useEffects'
import { useMotion } from '@/composables/useMotion'
import { useSettings } from '@/composables/useSettings'
import { useEffectsDrawer } from '@/composables/useEffectsDrawer'
import { ACTION_VERBS, actionVerb, isDiscreteTrigger } from '@/lib/effectTriggers'
import { SCRUB_DEFAULTS } from '@/lib/motion'
import type { AnimationBinding, ElementNode } from '@/types/editor'

const props = defineProps<{ pair: EffectPair; owner: ElementNode; open: boolean }>()
const emit = defineEmits<{ toggle: [] }>()

const { getElement, highlightElement } = useElement()
const { findMasterNode } = useComponents()
const { breakpoints } = useProject()
const interactions = useInteraction()
const animations = useAnimation()
const effects = useEffects()
const motion = useMotion()
const { settings } = useSettings()
const { openEffect } = useEffectsDrawer()
const { pickingFor } = interactions

const MENU_ITEM =
  'flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30'

const inter = computed(() => props.pair.interaction ?? null)
const anim = computed(() => props.pair.animation ?? null)
/** every binding this row stands for — one, or both halves of one effect */
const halves = computed(() => [inter.value, anim.value].filter((b) => !!b))
/** the half the row READS its when/where from; writes go to all of them */
const primary = computed(() => inter.value ?? anim.value!)

const effectName = computed(() => effects.nameOf(props.pair))
/** at least one half still resolves in its library */
const resolved = computed(
  () =>
    (!!inter.value && !!interactions.animationFor(inter.value.interactionId)) ||
    (!!anim.value && !!animations.animationFor(anim.value.animationId)),
)
const error = computed(() => {
  const timeline = anim.value && animations.animationFor(anim.value.animationId)
  return timeline ? animations.animationError(timeline) : null
})

/** only a click can be aimed: the symmetric triggers drive both directions
 *  themselves, which is why `action` is refused on them. Both engines answer a
 *  click the same way — a class change and a timeline are each keyed per
 *  (effect, target), so an Open button and a Close button drive one of either. */
const isDiscrete = computed(() => isDiscreteTrigger(primary.value.trigger))
const verb = computed(() => (isDiscrete.value ? actionVerb(primary.value.action) : null))

function setAction(value: string | undefined) {
  const next = !value || value === 'toggle' ? undefined : (value as 'on' | 'off')
  for (const binding of halves.value) binding.action = next
}

// --- target ---

const hasTarget = computed(
  () => !!primary.value.targetId && primary.value.targetId !== props.owner.id,
)
const targetName = computed(() => {
  if (!hasTarget.value) return 'this element'
  const node = getElement(primary.value.targetId!) ?? findMasterNode(primary.value.targetId!)
  return node ? (node.ref ? `#${node.ref}` : node.type) : 'Missing'
})
/** by MEMBERSHIP, not identity: a pending pick may be the array this row made,
 *  and a computed hands back a fresh array every time it re-evaluates */
const picking = computed(() => interactions.pendingPicks().some((b) => halves.value.includes(b)))
function togglePicking() {
  pickingFor.value = picking.value ? null : [...halves.value]
}
function previewTarget() {
  if (hasTarget.value) highlightElement(primary.value.targetId!)
}
function clearPreview() {
  highlightElement(null)
}
function resetTarget() {
  for (const binding of halves.value) binding.targetId = null
  clearPreview()
}

// --- the kind-specific tail ---

const APPEAR_MODE_LABELS: Record<string, string> = {
  once: 'Once',
  replay: 'Every time',
  reverse: 'Reverse on exit',
}
// 'inherit' is the stored `undefined` — the site default
// (settings.motion.appearMode). Naming it keeps the distinction: writing the
// resolved value back would PIN every binding the moment its row was opened.
const APPEAR_MODES = computed(() => [
  {
    label: `Site default (${APPEAR_MODE_LABELS[settings.value.motion?.appearMode ?? 'once']})`,
    value: 'inherit',
  },
  ...Object.entries(APPEAR_MODE_LABELS).map(([value, label]) => ({ label, value })),
])

function preview() {
  const binding = anim.value
  const timeline = binding && animations.animationFor(binding.animationId)
  if (!binding || !timeline) return
  motion.preview(timeline, binding.targetId ?? props.owner.id)
}

// --- breakpoints (all active by default) ---

function isBreakpointOn(id: string): boolean {
  return !primary.value.breakpoints || primary.value.breakpoints.includes(id)
}
function toggleBreakpoint(id: string) {
  const all = breakpoints.value.map((b) => b.id)
  const on = new Set(primary.value.breakpoints ?? all)
  if (on.has(id)) {
    // keep at least one — an effect on no breakpoint can never run
    if (on.size <= 1) return
    on.delete(id)
  } else {
    on.add(id)
  }
  // canonicalize: all on → undefined (stays byte-identical); else project order
  const next = all.every((b) => on.has(b)) ? undefined : all.filter((b) => on.has(b))
  for (const binding of halves.value) binding.breakpoints = next
}

/** a dot when something inside the strip is set away from its default — never
 *  for the target, which the row already names */
const optionsSet = computed(() => {
  if (primary.value.breakpoints) return true
  if (inter.value?.scrollAt !== undefined) return true
  return anim.value?.appearMode !== undefined || anim.value?.appearAt !== undefined
})

/** the drawer opens on the EFFECT when there is one, so both halves are there */
function edit() {
  if (props.pair.effect) openEffect('effect', props.pair.effect.id)
  else if (inter.value) openEffect('interaction', inter.value.interactionId)
  else if (anim.value) openEffect('animation', anim.value.animationId)
}

function remove() {
  if (anim.value) {
    motion.stop(anim.value, anim.value.targetId ?? props.owner.id)
    animations.removeBinding(props.owner, anim.value.id)
  }
  if (inter.value) interactions.removeBinding(props.owner, inter.value.id)
  clearPreview()
}
</script>

<template>
  <div
    data-binding-row
    class="rounded-xl border transition-colors"
    :class="open ? 'border-accent bg-accent/5' : 'border-input hover:border-accent'"
  >
    <!-- the line: verb · effect · target -->
    <div class="flex h-8 items-center gap-1 pr-1">
      <button
        type="button"
        class="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-xl px-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
        @click="emit('toggle')"
      >
        <span v-if="verb" class="shrink-0 text-xs text-muted-foreground">{{ verb }}</span>
        <span
          class="min-w-0 flex-1 truncate text-xs font-medium"
          :class="!resolved && 'text-danger'"
        >
          {{ effectName }}
        </span>
        <span
          v-if="hasTarget"
          class="max-w-20 shrink-0 truncate text-[10px] text-muted-foreground"
          @mouseenter="previewTarget"
          @mouseleave="clearPreview"
        >
          → {{ targetName }}
        </span>
        <span
          v-if="optionsSet && !open"
          class="size-1.5 shrink-0 rounded-full bg-accent-foreground/60"
        />
        <ChevronRight
          class="size-3 shrink-0 text-muted-foreground transition-transform"
          :class="open && 'rotate-90'"
        />
      </button>

      <ButtonUI
        v-if="anim"
        variant="icon" size="sm" :icon="Play" tooltip="Play on the canvas"
        class="w-6 shrink-0 text-muted-foreground"
        @click="preview"
      />

      <MenuUI width="w-44" side="bottom" align="right" label="Action options">
        <template #default="{ close }">
          <button type="button" :class="MENU_ITEM" @click="(edit(), close())">
            <Pencil class="size-3.5" /> Edit effect
          </button>
          <div class="mx-1 my-1 h-px bg-input" />
          <button type="button" :class="[MENU_ITEM, 'text-danger']" @click="(remove(), close())">
            <Trash2 class="size-3.5" /> Remove
          </button>
        </template>
      </MenuUI>
    </div>

    <!-- the options strip: the long tail, folded by default -->
    <div v-if="open && resolved" class="flex flex-col gap-1 border-t border-input/60 pb-2 pt-1.5">
      <RowUI label="On">
        <ButtonUI
          variant="outline" size="sm" :icon="Crosshair"
          class="min-w-0 flex-1 !justify-start"
          :class="picking && 'bg-accent text-accent-foreground'"
          @click="togglePicking"
          @mouseenter="previewTarget"
          @mouseleave="clearPreview"
        >
          <span class="truncate">{{ picking ? 'Click an element…' : targetName }}</span>
        </ButtonUI>
        <ButtonUI
          v-if="hasTarget"
          variant="icon" size="sm" :icon="X" tooltip="Back to this element"
          class="w-6 shrink-0 text-muted-foreground"
          @click="resetTarget"
        />
      </RowUI>

      <RowUI v-if="isDiscrete" label="Does">
        <SelectUI
          :model-value="primary.action ?? 'toggle'"
          :options="ACTION_VERBS"
          @update:model-value="setAction"
        />
      </RowUI>

      <RowUI v-if="inter && inter.trigger === 'scrolled'" label="After">
        <InputUI
          type="number"
          :model-value="String(inter.scrollAt ?? 50)"
          @update:model-value="(v) => (inter!.scrollAt = Number(v) || undefined)"
        />
        <span class="w-6 shrink-0 text-right text-xs text-muted-foreground">px</span>
      </RowUI>

      <template v-if="anim">
        <template v-if="anim.trigger === 'appear'">
          <RowUI label="Replay">
            <SelectUI
              :options="APPEAR_MODES"
              :model-value="anim.appearMode ?? 'inherit'"
              @update:model-value="
                (v) => (anim!.appearMode = v === 'inherit' ? undefined : (v as AnimationBinding['appearMode']))
              "
            />
          </RowUI>
          <RowUI label="Starts at">
            <ValueFieldUI
              :model-value="String(anim.appearAt ?? 0)"
              @commit="(t) => (anim!.appearAt = parseFloat(t) > 0 ? Math.min(1, parseFloat(t)) : undefined)"
            />
            <span class="text-[10px] text-muted-foreground">× viewport</span>
          </RowUI>
        </template>
        <template v-if="anim.trigger === 'scrub'">
          <RowUI label="From">
            <ValueFieldUI
              :model-value="String(anim.scrub?.start ?? SCRUB_DEFAULTS.start)"
              @commit="(t) => (anim!.scrub = { ...anim!.scrub, start: parseFloat(t) || 0 })"
            />
            <span class="text-[10px] text-muted-foreground">× viewport</span>
          </RowUI>
          <RowUI label="To">
            <ValueFieldUI
              :model-value="String(anim.scrub?.end ?? SCRUB_DEFAULTS.end)"
              @commit="(t) => (anim!.scrub = { ...anim!.scrub, end: parseFloat(t) || 0 })"
            />
            <span class="text-[10px] text-muted-foreground">× viewport</span>
          </RowUI>
        </template>
      </template>

      <RowUI v-if="breakpoints.length > 1" label="Breakpoints">
        <div class="flex flex-1 flex-wrap justify-end gap-1">
          <ButtonUI
            v-for="bp in breakpoints"
            :key="bp.id"
            :variant="isBreakpointOn(bp.id) ? 'outline' : 'ghost'"
            size="xs"
            :class="isBreakpointOn(bp.id) ? '' : 'text-muted-foreground opacity-60'"
            @click="toggleBreakpoint(bp.id)"
          >
            {{ bp.name }}
          </ButtonUI>
        </div>
      </RowUI>

      <p v-if="error" class="px-2.5 text-[10px] text-danger">{{ error }}</p>
    </div>

    <!-- the effect was deleted from the library while bound here -->
    <div v-else-if="open" class="flex items-center justify-between border-t border-input/60 px-2.5 py-2">
      <p class="text-[10px] text-muted-foreground">This effect no longer exists.</p>
      <ButtonUI variant="ghost" size="xs" :icon="X" class="text-muted-foreground" @click="remove">
        Remove
      </ButtonUI>
    </div>
  </div>
</template>
