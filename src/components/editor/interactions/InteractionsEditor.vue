<script setup lang="ts">
// The Interactions panel: trigger-first.
//
// You say WHEN, then WHAT — the order the author thinks in, and the order
// Webflow asks in. Before this the panel asked for an engine ("Animation" or
// "Interaction") before either, which is a question about our implementation,
// and the trigger list then changed depending on the answer.
//
// Three things live here and nothing else:
//   · STATES — the effects some trigger puts THIS element into (a modal's
//     "Open"), where dismissal, the exclusive group and a remembered dismissal
//     are edited once, on the state they belong to.
//   · one section per TRIGGER, each a list of one-line actions.
//   · "+ action", which offers only what that trigger can run, and "+ Trigger".
//
// What an effect DOES is shared by every element using it, so it is edited in
// the bottom drawer (⌘⇧E) — never in here, where a change that retimed the
// whole site read as a change to this one element.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Plus, Zap } from 'lucide-vue-next'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import ActionRow from '@/components/editor/interactions/ActionRow.vue'
import ActionPicker from '@/components/editor/interactions/ActionPicker.vue'
import StateCard from '@/components/editor/interactions/StateCard.vue'
import { usePanel, focusWhenPanelVisible } from '@/composables/usePanel'
import { useElement } from '@/composables/useElement'
import { useAnimation } from '@/composables/useAnimation'
import { useEffects, type EffectPair } from '@/composables/useEffects'
import { useComponents } from '@/composables/useComponents'
import { isDrivenState, useInteraction, type Driver } from '@/composables/useInteraction'
import { useShortcut } from '@/composables/useShortcut'
import { useEffectsDrawer, type DrawerKind } from '@/composables/useEffectsDrawer'
import { UI_TRIGGERS, triggerOrder, triggerSentence, type EffectKind } from '@/lib/effectTriggers'

const { highlightElement, isMultiSelect } = useElement()
const { pickingFor, driversFor, animationFor } = useInteraction()
const { animDriversFor, animationFor: timelineFor } = useAnimation()
const { pairsFor, effectForHalf } = useEffects()
const { editTarget } = useComponents()
const { open: drawerOpen, toggleDrawer } = useEffectsDrawer()

// inside a component instance, effects land on the shared master
const target = editTarget

// Esc cancels a pending target pick
useShortcut('Escape', { onDown: () => (pickingFor.value = null) })

const canEdit = computed(() => !!target.value && !isMultiSelect.value)

const elementLabel = computed(() => {
  const n = target.value
  if (!n) return ''
  return n.ref ? `#${n.ref}` : n.type
})

// --- states this element can be in ---

/**
 * One card per effect landing on this element — but only when it is a state
 * worth surfacing: driven by a CLICK (the discrete gesture that has a
 * direction, a dismissal and a group) or driven by some OTHER element. A hover
 * effect on itself is symmetric and has no state to manage, so it stays a
 * single row and the panel doesn't say the same thing twice.
 */
interface StateRow {
  key: string
  /** what "Edit effect" opens the drawer on */
  drawerKind: DrawerKind
  drawerId: string
  name: string
  summary: string
  classDrivers: Driver[]
  driverOwnerIds: string[]
}

/**
 * One card per effect landing on this element — grouped by EFFECT, so a mixed
 * one is a single state wearing both engines rather than two cards saying half
 * the truth each.
 *
 * A card is drawn only when it is a state worth surfacing: driven by a CLICK
 * (the discrete gesture that has a direction, a dismissal and a group) or
 * driven by some OTHER element. A symmetric effect on itself is just a row.
 */
const states = computed<StateRow[]>(() => {
  const n = canEdit.value ? target.value : null
  if (!n) return []

  interface Group {
    drawerKind: DrawerKind
    drawerId: string
    name: string
    summary: string
    classDrivers: Driver[]
    drivers: { binding: { trigger: string }; ownerId: string }[]
    ownerIds: string[]
  }
  const groups = new Map<string, Group>()

  const add = (
    kind: EffectKind,
    halfId: string,
    driver: { binding: { trigger: string }; ownerId: string },
  ) => {
    const effect = effectForHalf(kind, halfId)
    const key = effect ? effect.id : `${kind}:${halfId}`
    const classEffect = kind === 'interaction' ? animationFor(halfId) : undefined
    const fallbackName =
      (kind === 'interaction' ? animationFor(halfId)?.name : timelineFor(halfId)?.name) ??
      'Missing effect'
    const group =
      groups.get(key) ??
      ({
        drawerKind: effect ? 'effect' : kind,
        drawerId: effect ? effect.id : halfId,
        name: effect?.name ?? fallbackName,
        summary: '',
        classDrivers: [],
        drivers: [],
        ownerIds: [],
      } satisfies Group)
    if (classEffect) group.summary = classEffect.toClasses?.trim() ?? ''
    if (kind === 'interaction') group.classDrivers.push(driver as Driver)
    group.drivers.push(driver)
    group.ownerIds.push(driver.ownerId)
    groups.set(key, group)
  }

  for (const driver of driversFor(n.id)) add('interaction', driver.binding.interactionId, driver)
  // a click play is keyed per (animation, target) too, so a timeline several
  // triggers share is a state in exactly the same sense
  for (const driver of animDriversFor(n.id)) add('animation', driver.binding.animationId, driver)

  const out: StateRow[] = []
  for (const [key, group] of groups) {
    if (!isDrivenState(n.id, group.drivers)) continue
    out.push({
      key,
      drawerKind: group.drawerKind,
      drawerId: group.drawerId,
      name: group.name,
      summary: group.summary,
      classDrivers: group.classDrivers,
      driverOwnerIds: group.ownerIds,
    })
  }
  return out
})

// --- the element's own actions, grouped by trigger ---

/** triggers the author has opened a section for but not yet filled */
const pending = ref<string[]>([])

/**
 * One row per ACTION, not per binding: an effect wearing both engines holds two
 * bindings and must read as one thing (useEffects.pairsFor recognises the pair).
 */
const sections = computed(() => {
  const n = canEdit.value ? target.value : null
  if (!n) return []
  const byTrigger = new Map<string, EffectPair[]>()
  for (const pair of pairsFor(n, n.id)) {
    const trigger = (pair.interaction ?? pair.animation)!.trigger
    const list = byTrigger.get(trigger) ?? []
    list.push(pair)
    byTrigger.set(trigger, list)
  }
  for (const trigger of pending.value) if (!byTrigger.has(trigger)) byTrigger.set(trigger, [])
  return [...byTrigger.entries()]
    .map(([trigger, rows]) => ({ trigger, rows, sentence: triggerSentence(trigger) }))
    .sort((a, b) => triggerOrder(a.trigger) - triggerOrder(b.trigger))
})

/** the id a row is keyed and opened by — its first half's binding id */
const rowId = (pair: EffectPair) => (pair.interaction ?? pair.animation)!.id

const totalActions = computed(() => sections.value.reduce((n, s) => n + s.rows.length, 0))

// --- one row open at a time, one picker open at a time ---

const openId = ref<string | null>(null)
const pickerFor = ref<string | null>(null)
const addingTrigger = ref(false)

function toggleRow(id: string) {
  openId.value = openId.value === id ? null : id
}

function openPicker(trigger: string) {
  addingTrigger.value = false
  pickerFor.value = pickerFor.value === trigger ? null : trigger
}

/** "+ Trigger" → a section, with its picker already open: one gesture to the
 *  question that follows ("and then what?") */
function addTrigger(trigger: string) {
  if (!pending.value.includes(trigger)) pending.value = [...pending.value, trigger]
  pickerFor.value = trigger
  addingTrigger.value = false
}

function onAdded(id: string) {
  openId.value = id
  // the section has a real binding now, so it no longer needs holding open
  const filled = new Set<string>([
    ...(target.value?.animations ?? []).map((b) => b.trigger as string),
    ...(target.value?.interactions ?? []).map((b) => b.trigger as string),
  ])
  pending.value = pending.value.filter((t) => !filled.has(t))
}

/** triggers not already on screen — a second empty "On click" would be a bug */
const availableTriggers = computed(() =>
  UI_TRIGGERS.filter((t) => !sections.value.some((s) => s.trigger === t.key)),
)

// a row that disappears, or a change of element, folds everything
watch(
  () => sections.value.flatMap((s) => s.rows.map(rowId)),
  (ids) => {
    if (openId.value && !ids.includes(openId.value)) openId.value = null
  },
  { immediate: true },
)
watch(
  () => target.value?.id,
  () => {
    openId.value = null
    pickerFor.value = null
    addingTrigger.value = false
    pending.value = []
  },
)

// `I` in the Layers tree: the panel's primary action is adding a trigger
const { pendingFocus } = usePanel()
const addButton = ref<InstanceType<typeof ButtonUI>>()
function consumeFocus() {
  if (pendingFocus.value !== 'interactions') return
  pendingFocus.value = null
  focusWhenPanelVisible(() => addButton.value?.$el?.focus?.())
}
onMounted(consumeFocus)
watch(pendingFocus, consumeFocus)
// don't leave a dangling preview outline when the panel closes
onBeforeUnmount(() => highlightElement(null))
</script>

<template>
  <GroupPopover v-if="!canEdit">
    <p class="text-xs text-muted-foreground">
      {{
        isMultiSelect
          ? 'Select a single element to give it interactions.'
          : 'Select an element to give it interactions.'
      }}
    </p>
    <!-- the effect library is project-level, so it is reachable with nothing
         selected — only applying an effect needs an element -->
    <ButtonUI ref="addButton" variant="outline" size="sm" class="w-full" @click="toggleDrawer()">
      {{ drawerOpen ? 'Hide effects' : 'Open effects' }}
    </ButtonUI>
  </GroupPopover>

  <div v-else class="flex flex-col">
    <!-- which element this is about, and the one way in -->
    <div class="flex items-center gap-1.5 border-b border-input px-3 py-2">
      <p class="min-w-0 flex-1 truncate text-xs font-medium">
        {{ elementLabel }}
        <span v-if="totalActions" class="text-muted-foreground">· {{ totalActions }}</span>
      </p>
      <ButtonUI
        ref="addButton"
        variant="outline"
        size="xs"
        :icon="Plus"
        :disabled="!availableTriggers.length"
        @click="addingTrigger = !addingTrigger"
      >
        Trigger
      </ButtonUI>
    </div>

    <!-- + Trigger: inline, with the one line each choice needs -->
    <div v-if="addingTrigger" class="flex flex-col gap-1 border-b border-input p-2">
      <button
        v-for="t in availableTriggers"
        :key="t.key"
        type="button"
        class="flex items-start gap-2 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-accent/30 focus-visible:bg-accent/30"
        @click="addTrigger(t.key)"
      >
        <component :is="t.icon" class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1">
          <span class="block text-xs">{{ t.label }}</span>
          <span class="block text-[10px] text-muted-foreground">{{ t.hint }}</span>
        </span>
      </button>
    </div>

    <!-- states: what this element can BE, and how it gets dismissed -->
    <GroupPopover v-if="states.length" label="States">
      <StateCard
        v-for="state in states"
        :key="state.key"
        :node-id="target!.id"
        :drawer-kind="state.drawerKind"
        :drawer-id="state.drawerId"
        :name="state.name"
        :summary="state.summary"
        :class-drivers="state.classDrivers"
        :driver-owner-ids="state.driverOwnerIds"
      />
    </GroupPopover>

    <!-- one section per trigger -->
    <GroupPopover v-for="section in sections" :key="section.trigger" :label="section.sentence">
      <ActionRow
        v-for="row in section.rows"
        :key="rowId(row)"
        :pair="row"
        :owner="target!"
        :open="openId === rowId(row)"
        @toggle="toggleRow(rowId(row))"
      />

      <ActionPicker
        v-if="pickerFor === section.trigger"
        :trigger="section.trigger"
        :owner="target!"
        @added="onAdded"
        @close="pickerFor = null"
      />
      <ButtonUI
        v-else
        variant="ghost"
        size="xs"
        :icon="Plus"
        class="w-full !justify-start text-muted-foreground"
        @click="openPicker(section.trigger)"
      >
        action
      </ButtonUI>
    </GroupPopover>

    <GroupPopover v-if="!sections.length && !states.length">
      <p class="text-xs text-muted-foreground">
        Nothing yet. Add a trigger to say when something happens.
      </p>
    </GroupPopover>

    <!-- the library and every effect's own settings live one surface down -->
    <GroupPopover>
      <ButtonUI
        variant="ghost"
        size="xs"
        :icon="Zap"
        class="w-full !justify-start text-muted-foreground"
        @click="toggleDrawer()"
      >
        {{ drawerOpen ? 'Hide effects' : 'All effects' }}
      </ButtonUI>
    </GroupPopover>
  </div>
</template>
