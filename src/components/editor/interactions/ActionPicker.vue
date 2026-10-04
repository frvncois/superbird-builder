<script setup lang="ts">
// "+ action": everything this element can do when the section's trigger fires.
//
// Three rules shape it. (1) It opens INLINE, under the button that asked for
// it — the old chooser replaced the whole panel, so you lost sight of the
// element and the actions it already had. (2) It never names an engine: the
// trigger decides which kinds can run (`triggerAllows`), and the list is
// filtered silently. (3) States on the page come FIRST, because "open the modal
// that already exists" is the most common thing to want and used to require
// knowing that the modal's effect was a saved interaction and that the open
// button needed `action: on`.
import { computed } from 'vue'
import { Plus, Sparkles } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { useElement } from '@/composables/useElement'
import { useComponents } from '@/composables/useComponents'
import { isDrivenState, useInteraction } from '@/composables/useInteraction'
import { useAnimation } from '@/composables/useAnimation'
import { useEffects, type LibraryItem } from '@/composables/useEffects'
import { useEffectsDrawer, type EffectKind } from '@/composables/useEffectsDrawer'
import { triggerAllows, uiTrigger } from '@/lib/effectTriggers'
import { MOTION_PRESETS } from '@/lib/motionPresets'
import type { AnimationBinding, ElementNode, InteractionBinding } from '@/types/editor'

const props = defineProps<{
  /** the stored trigger value every action added here will carry */
  trigger: string
  /** the node the binding lands on (already redirected to a master if needed) */
  owner: ElementNode
}>()

const emit = defineEmits<{ close: []; added: [string] }>()

const { getElement, highlightElement } = useElement()
const { findMasterNode } = useComponents()
const interactions = useInteraction()
const animations = useAnimation()
const effects = useEffects()
const { openEffect } = useEffectsDrawer()

const allowsClasses = computed(() => triggerAllows(props.trigger, 'interaction'))
const allowsMotion = computed(() => triggerAllows(props.trigger, 'animation'))
const isClick = computed(() => props.trigger === 'click')

/** finish: the row the picker just made is the one to show open */
function done(bindingId: string) {
  emit('added', bindingId)
  emit('close')
}

// --- 1. states that already exist on this page ---

interface KnownState {
  /** dedupe + v-for key: the effect (or lone half) and the element it lands on */
  key: string
  name: string
  targetId: string
  targetLabel: string
  halves: EffectHalf[]
}

/**
 * Every state some trigger already drives, named for a human — grouped by
 * EFFECT, so a panel that is a class change plus a timeline is joined as one
 * thing. State is shared per (effect-half, target), so binding to one makes this
 * element a second trigger for the SAME state, which is exactly how an open
 * button, a close button and an overlay are built.
 */
const knownStates = computed<KnownState[]>(() => {
  type Group = { halves: EffectHalf[]; drivers: { binding: { trigger: string }; ownerId: string }[]; name: string }
  const byTarget = new Map<string, Map<string, Group>>()

  const add = (
    targetId: string,
    kind: EffectKind,
    halfId: string,
    driver: { binding: { trigger: string }; ownerId: string },
    halfName: string | undefined,
  ) => {
    if (!halfName) return
    const effect = effects.effectForHalf(kind, halfId)
    const key = effect ? effect.id : `${kind}:${halfId}`
    const groups = byTarget.get(targetId) ?? new Map<string, Group>()
    const group = groups.get(key) ?? { halves: [], drivers: [], name: effect?.name ?? halfName }
    if (!group.halves.some((h) => h.kind === kind && h.id === halfId)) {
      group.halves.push({ kind, id: halfId })
    }
    group.drivers.push(driver)
    groups.set(key, group)
    byTarget.set(targetId, groups)
  }

  for (const [targetId, drivers] of interactions.driversIndex.value) {
    for (const driver of drivers) {
      add(
        targetId,
        'interaction',
        driver.binding.interactionId,
        driver,
        interactions.animationFor(driver.binding.interactionId)?.name,
      )
    }
  }
  for (const [targetId, drivers] of animations.animDriversIndex.value) {
    for (const driver of drivers) {
      add(
        targetId,
        'animation',
        driver.binding.animationId,
        driver,
        animations.animationFor(driver.binding.animationId)?.name,
      )
    }
  }

  const out: KnownState[] = []
  for (const [targetId, groups] of byTarget) {
    const node = getElement(targetId) ?? findMasterNode(targetId)
    if (!node) continue
    for (const [key, group] of groups) {
      // the same test the panel's States block uses, so the picker never offers
      // to "Open" something the panel does not call a state
      if (!isDrivenState(targetId, group.drivers)) continue
      // half of a mixed effect would render wrong while reporting success
      if (!group.halves.every((half) => triggerAllows(props.trigger, half.kind))) continue
      out.push({
        key: `${key}@${targetId}`,
        name: group.name,
        targetId,
        targetLabel: node.ref ? `#${node.ref}` : node.type,
        halves: group.halves,
      })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
})

/** already bound here, under this trigger, at this target, in this direction */
function stateBound(state: KnownState, action?: 'on' | 'off'): boolean {
  return state.halves.every((half) => halfBound(half, state.targetId, action, true))
}

function applyState(state: KnownState, action?: 'on' | 'off') {
  if (stateBound(state, action)) return
  const targetId = state.targetId === props.owner.id ? null : state.targetId
  const made = state.halves.map((half) => bindHalf(half, { targetId, action }))
  done(made[0]!.id)
}

// --- the two apply primitives (today's applyTo, then the when/where) ---

function bindInteraction(
  interactionId: string,
  opts: { targetId?: string | null; action?: 'on' | 'off' } = {},
): InteractionBinding {
  const binding = interactions.applyTo(props.owner, interactionId)
  binding.trigger = props.trigger as InteractionBinding['trigger']
  if (opts.targetId !== undefined) binding.targetId = opts.targetId
  // only a click can carry a direction — a symmetric trigger drives both
  if (opts.action && isClick.value) binding.action = opts.action
  return binding
}

function bindAnimation(
  animationId: string,
  opts: { targetId?: string | null; action?: 'on' | 'off' } = {},
): AnimationBinding {
  const binding = animations.applyTo(props.owner, animationId)
  binding.trigger = props.trigger as AnimationBinding['trigger']
  if (opts.targetId !== undefined) binding.targetId = opts.targetId
  // only a click can carry a direction — hover rewinds on leave by itself
  if (opts.action && isClick.value) binding.action = opts.action
  return binding
}

// --- 2. presets ---

/** the presets this trigger can run, the ones designed for it first */
const presets = computed(() => {
  if (!allowsMotion.value) return []
  return [...MOTION_PRESETS].sort(
    (a, b) => Number(b.trigger === props.trigger) - Number(a.trigger === props.trigger),
  )
})

function applyPreset(id: (typeof MOTION_PRESETS)[number]['id']) {
  const animation = animations.createFromPreset(id)
  done(bindAnimation(animation.id).id)
}

// --- 3. saved effects ---
//
// One entry per EFFECT. An effect wearing both engines binds both halves in one
// go, with the same when and where, because that is what makes it one effect —
// and it is offered only when the trigger can run BOTH, since binding half of
// it would land something that renders wrong while reporting success.

interface SavedItem {
  id: string
  name: string
  halves: EffectHalf[]
}

/** the engines an item would bind, with the library id of each */
type EffectHalf = { kind: EffectKind; id: string }

function halvesOf(item: LibraryItem): EffectHalf[] {
  if (item.kind !== 'effect') return [{ kind: item.kind, id: item.id }]
  const effect = effects.effectById(item.id)
  if (!effect) return []
  const has = effects.halfIds(effect)
  const out: EffectHalf[] = []
  if (has.interactionId) out.push({ kind: 'interaction', id: has.interactionId })
  if (has.animationId) out.push({ kind: 'animation', id: has.animationId })
  return out
}

const saved = computed<SavedItem[]>(() =>
  effects.libraryItems.value
    .map((item) => ({ id: item.id, name: item.name, halves: halvesOf(item) }))
    .filter(
      (item) =>
        item.halves.length > 0 &&
        item.halves.every((half) => triggerAllows(props.trigger, half.kind)),
    ),
)

/** binds one half, with the row's when and where */
function bindHalf(half: EffectHalf, opts: { targetId?: string | null; action?: 'on' | 'off' }) {
  return half.kind === 'interaction'
    ? bindInteraction(half.id, opts)
    : bindAnimation(half.id, opts)
}

function halfBound(
  half: EffectHalf,
  targetId: string,
  action?: 'on' | 'off',
  checkAction = false,
): boolean {
  const matches = (b: { trigger: string; targetId: string | null; action?: string }) =>
    b.trigger === props.trigger &&
    (b.targetId ?? props.owner.id) === targetId &&
    (!checkAction || (b.action ?? 'toggle') === (action ?? 'toggle'))
  return half.kind === 'interaction'
    ? (props.owner.interactions ?? []).some((b) => b.interactionId === half.id && matches(b))
    : (props.owner.animations ?? []).some((b) => b.animationId === half.id && matches(b))
}

function savedBound(item: SavedItem): boolean {
  return item.halves.every((half) => halfBound(half, props.owner.id))
}

function applySaved(item: SavedItem) {
  if (savedBound(item)) return
  const made = item.halves.map((half) => bindHalf(half, {}))
  done(made[0]!.id)
}

// --- 4. new ---
//
// The one place the two kinds are told apart, phrased as what the effect DOES
// rather than which engine runs it. Creating applies it to this element under
// this trigger and opens the drawer on it, flagged `created` so Cancel discards
// the effect AND the binding through the cascading delete.

/** a new effect is NAMED, then given this half — so gaining the other engine
 *  later is an ordinary edit in the drawer rather than a conversion */
function newEffect(kind: EffectKind) {
  const half = kind === 'interaction' ? interactions.createInteraction() : animations.createAnimation()
  const effect = effects.wrap(kind, half.id, half.name)
  const binding = bindHalf({ kind, id: half.id }, {})
  emit('added', binding.id)
  emit('close')
  openEffect('effect', effect.id, true)
}

/** the library row's name opens the drawer on whatever that row IS */
function openSaved(item: SavedItem) {
  const wrapped = effects.effectById(item.id)
  if (wrapped) openEffect('effect', item.id)
  else if (item.halves[0]) openEffect(item.halves[0].kind, item.halves[0].id)
}

const hint = computed(() => uiTrigger(props.trigger)?.hint ?? '')
</script>

<template>
  <div
    data-action-picker
    class="flex flex-col gap-2 rounded-xl border border-accent bg-accent/5 p-2"
  >
    <div class="flex items-start gap-1">
      <p class="min-w-0 flex-1 text-[10px] text-muted-foreground">{{ hint }}</p>
      <ButtonUI variant="ghost" size="xs" class="text-muted-foreground" @click="emit('close')">
        Cancel
      </ButtonUI>
    </div>

    <!-- states first: joining one is how modals, menus and accordions are built -->
    <div v-if="knownStates.length" class="flex flex-col gap-1">
      <p class="text-[9px] font-medium tracking-wide text-muted-foreground uppercase">
        States on this page
      </p>
      <div
        v-for="state in knownStates"
        :key="state.key"
        data-state-option
        class="flex items-center gap-1"
        @mouseenter="highlightElement(state.targetId)"
        @mouseleave="highlightElement(null)"
      >
        <span class="min-w-0 flex-1 truncate text-xs">
          {{ state.name }}
          <span class="text-muted-foreground">· {{ state.targetLabel }}</span>
        </span>
        <template v-if="isClick">
          <ButtonUI
            size="xs" :variant="stateBound(state, 'on') ? 'ghost' : 'outline'"
            :disabled="stateBound(state, 'on')"
            @click="applyState(state, 'on')"
          >
            Open
          </ButtonUI>
          <ButtonUI
            size="xs" :variant="stateBound(state, 'off') ? 'ghost' : 'outline'"
            :disabled="stateBound(state, 'off')"
            @click="applyState(state, 'off')"
          >
            Close
          </ButtonUI>
          <ButtonUI
            size="xs" :variant="stateBound(state) ? 'ghost' : 'outline'"
            :disabled="stateBound(state)"
            @click="applyState(state)"
          >
            Toggle
          </ButtonUI>
        </template>
        <ButtonUI
          v-else
          size="xs" :variant="stateBound(state) ? 'ghost' : 'outline'"
          :disabled="stateBound(state)"
          @click="applyState(state)"
        >
          {{ stateBound(state) ? 'Added' : 'Add' }}
        </ButtonUI>
      </div>
    </div>

    <!-- presets: ready-made timelines, a starting point rather than a kind -->
    <div v-if="presets.length" class="flex flex-col gap-1">
      <p class="text-[9px] font-medium tracking-wide text-muted-foreground uppercase">Presets</p>
      <div class="grid grid-cols-2 gap-1">
        <button
          v-for="preset in presets"
          :key="preset.id"
          v-tooltip="preset.description"
          type="button"
          class="flex h-7 min-w-0 items-center gap-1 rounded-lg border border-input px-2 text-left text-[11px] outline-none transition-colors hover:border-accent hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-accent"
          @click="applyPreset(preset.id)"
        >
          <span class="min-w-0 flex-1 truncate">{{ preset.label }}</span>
          <Plus class="size-3 shrink-0 text-muted-foreground" />
        </button>
      </div>
    </div>

    <!-- saved: one list, both engines, no badge -->
    <div v-if="saved.length" class="flex flex-col gap-1">
      <p class="text-[9px] font-medium tracking-wide text-muted-foreground uppercase">Saved</p>
      <div v-for="item in saved" :key="item.id" data-saved-effect class="flex items-center gap-1">
        <button
          type="button"
          class="min-w-0 flex-1 truncate rounded text-left text-xs outline-none hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-accent"
          @click="openSaved(item)"
        >
          {{ item.name }}
        </button>
        <ButtonUI
          size="xs"
          :variant="savedBound(item) ? 'ghost' : 'outline'"
          :disabled="savedBound(item)"
          @click="applySaved(item)"
        >
          {{ savedBound(item) ? 'Added' : 'Add' }}
        </ButtonUI>
      </div>
    </div>

    <div class="flex flex-col gap-1 border-t border-input pt-2">
      <p class="text-[9px] font-medium tracking-wide text-muted-foreground uppercase">New effect</p>
      <ButtonUI
        v-if="allowsClasses"
        variant="outline" size="sm" :icon="Plus" class="w-full !justify-start"
        @click="newEffect('interaction')"
      >
        Style change
      </ButtonUI>
      <ButtonUI
        v-if="allowsMotion"
        variant="outline" size="sm" :icon="Sparkles" class="w-full !justify-start"
        @click="newEffect('animation')"
      >
        Motion
      </ButtonUI>
    </div>
  </div>
</template>
