<script setup lang="ts">
// The class-toggle half of the Interactions panel: the interactions applied to
// the selected element — WHEN each one fires — plus the project library.
//
// What an interaction DOES (its name, classes, timing) is shared by every
// element using it, so it lives in the focused InteractionDetail view instead;
// editing it here among per-element controls made a change that retimed the
// whole site look like a change to this one element.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { usePanel, focusWhenPanelVisible } from '@/composables/usePanel'
import {
  Crosshair,
  Eye,
  MousePointer2,
  MousePointerClick,
  MoveVertical,
  Pencil,
  Plus,
  ToggleLeft,
  X,
} from 'lucide-vue-next'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import RowUI from '@/components/ui/RowUI.vue'
import IconGroupUI from '@/components/ui/IconGroupUI.vue'
import AnimationEditor from '@/components/editor/interactions/AnimationEditor.vue'
import EffectLibraryList from '@/components/editor/interactions/EffectLibraryList.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import { useElement } from '@/composables/useElement'
import { useInteraction } from '@/composables/useInteraction'
import { useProject } from '@/composables/useProject'
import { useShortcut } from '@/composables/useShortcut'
import { useComponents } from '@/composables/useComponents'
import { useEffectDetail } from '@/composables/useEffectDetail'
import type { InteractionBinding } from '@/types/editor'

const { getElement, highlightElement, isMultiSelect } = useElement()
const {
  pickingFor,
  library,
  animationFor,
  createInteraction,
  usageCount,
  deleteInteraction,
  applyTo,
  removeBinding,
} = useInteraction()
const { editTarget, findMasterNode } = useComponents()
const { breakpoints } = useProject()
const { openDetail } = useEffectDetail()

// inside a component instance, interaction edits land on the shared master
const target = editTarget

// Esc cancels a pending target pick
useShortcut('Escape', { onDown: () => (pickingFor.value = null) })

const TRIGGERS = [
  { label: 'Hover', value: 'hover', icon: MousePointer2 },
  { label: 'Click', value: 'click', icon: MousePointerClick },
  { label: 'Appear', value: 'appear', icon: Eye },
  { label: 'Scrolled', value: 'scrolled', icon: MoveVertical },
  { label: 'Input change', value: 'change', icon: ToggleLeft },
]

/** what a click does to the effect. State is keyed by (interaction, target), so
 * an "Open" button and a "Close" button drive the SAME effect — which is what
 * makes modals and drawers work. */
const ACTIONS = [
  { label: 'Toggle', value: 'toggle' },
  { label: 'Turn on', value: 'on' },
  { label: 'Turn off', value: 'off' },
]

const ONCE_OPTIONS = [
  { label: 'Always', value: '' },
  { label: 'Once per session', value: 'session' },
  { label: 'Once per browser', value: 'local' },
]

/** only a discrete gesture can choose a direction; hover/scrolled/change drive
 * both directions themselves */
const isDiscrete = (binding: InteractionBinding) => binding.trigger === 'click'

function isDismissOn(binding: InteractionBinding, mode: 'outside' | 'escape'): boolean {
  return !!binding.closeOn?.includes(mode)
}

function toggleDismiss(binding: InteractionBinding, mode: 'outside' | 'escape') {
  const next = new Set(binding.closeOn ?? [])
  if (next.has(mode)) next.delete(mode)
  else next.add(mode)
  // omitted when empty so untouched bindings stay byte-identical for merge
  binding.closeOn = next.size ? [...next] : undefined
}

// --- applied to the selected element ---

/** the per-element half needs exactly one element; the libraries below don't */
const canEditElement = computed(() => !!target.value && !isMultiSelect.value)

const bindings = computed(() => (canEditElement.value ? (target.value?.interactions ?? []) : []))

function animName(binding: InteractionBinding): string {
  return animationFor(binding.interactionId)?.name ?? 'Missing interaction'
}

// --- library ---

const libraryItems = computed(() => library.value.map((i) => ({ id: i.id, name: i.name })))

function isApplied(interactionId: string): boolean {
  return bindings.value.some((b) => b.interactionId === interactionId)
}

function apply(interactionId: string) {
  if (canEditElement.value && !isApplied(interactionId)) applyTo(target.value!, interactionId)
}

/** creating always adds to the library and opens the editor; applying to the
 * selection is the bonus when there IS one */
function createAndApply() {
  const interaction = createInteraction()
  if (canEditElement.value) applyTo(target.value!, interaction.id)
  openDetail('interaction', interaction.id, true)
}

function unapply(binding: InteractionBinding) {
  if (target.value) removeBinding(target.value, binding.id)
}

// `I` in the Layers tree: the panel's primary action, so Enter creates. Its
// old target (the first binding's "To" field) now lives in the detail view.
const { pendingFocus } = usePanel()
const newButton = ref<InstanceType<typeof ButtonUI>>()

function consumeFocus() {
  if (pendingFocus.value !== 'interactions') return
  pendingFocus.value = null
  focusWhenPanelVisible(() => newButton.value?.$el?.focus?.())
}
onMounted(consumeFocus)
watch(pendingFocus, consumeFocus)
// don't leave a dangling preview outline when the panel closes
onBeforeUnmount(clearPreview)

// --- per-application target (picker + canvas/code preview) ---

function hasTarget(binding: InteractionBinding): boolean {
  return !!binding.targetId && binding.targetId !== target.value?.id
}

function targetName(binding: InteractionBinding): string {
  if (!hasTarget(binding)) return 'self'
  const node = getElement(binding.targetId!) ?? findMasterNode(binding.targetId!)
  return node ? node.type : 'Missing'
}

function previewTarget(binding: InteractionBinding) {
  if (hasTarget(binding)) highlightElement(binding.targetId!)
}
function clearPreview() {
  highlightElement(null)
}
function resetTarget(binding: InteractionBinding) {
  binding.targetId = null
  clearPreview()
}

function togglePicking(binding: InteractionBinding) {
  pickingFor.value = pickingFor.value === binding ? null : binding
}

// --- per-application breakpoint scope (all active by default) ---

function isBreakpointOn(binding: InteractionBinding, id: string): boolean {
  return !binding.breakpoints || binding.breakpoints.includes(id)
}

function toggleBreakpoint(binding: InteractionBinding, id: string) {
  const all = breakpoints.value.map((b) => b.id)
  const on = new Set(binding.breakpoints ?? all)
  if (on.has(id)) {
    // keep at least one — an interaction on no breakpoint can never run
    if (on.size <= 1) return
    on.delete(id)
  } else {
    on.add(id)
  }
  // canonicalize: all on → undefined (stays byte-identical); else project order
  binding.breakpoints = all.every((b) => on.has(b)) ? undefined : all.filter((b) => on.has(b))
}
</script>

<template>
  <!-- the libraries below still work without a selection — only applying and
       the per-element cards need exactly one element -->
  <GroupPopover v-if="!canEditElement">
    <p class="text-xs text-muted-foreground">
      {{
        isMultiSelect
          ? 'Select a single element to give it interactions.'
          : 'Select an element to give it interactions, or edit your saved ones below.'
      }}
    </p>
  </GroupPopover>

  <!-- tween animations (timeline engine) come first: the richer system.
       GroupPopover borders already separate the two halves. -->
  <AnimationEditor />

  <!-- class-toggle interactions: still the right tool for hover states -->
  <GroupPopover
    v-for="binding in bindings"
    :key="binding.id"
    :label="animName(binding)"
  >
    <template v-if="animationFor(binding.interactionId)">
      <div class="flex items-center gap-1">
        <ButtonUI
          variant="outline" size="xs" :icon="Pencil"
          class="min-w-0 flex-1 !justify-start"
          @click="openDetail('interaction', binding.interactionId)"
        >
          Edit interaction
        </ButtonUI>
        <ButtonUI
          variant="icon"
          size="sm"
          :icon="X"
          tooltip="Remove from this element"
          class="w-6 shrink-0 text-muted-foreground"
          @click="unapply(binding)"
        />
      </div>

      <RowUI label="Trigger">
        <IconGroupUI
          :options="TRIGGERS"
          :model-value="binding.trigger"
          @update:model-value="(v) => (binding.trigger = v as InteractionBinding['trigger'])"
        />
      </RowUI>

      <RowUI v-if="isDiscrete(binding)" label="Action">
        <SelectUI
          :model-value="binding.action ?? 'toggle'"
          :options="ACTIONS"
          @update:model-value="
            (v) => (binding.action = v === 'toggle' ? undefined : (v as 'on' | 'off'))
          "
        />
      </RowUI>

      <RowUI v-if="binding.trigger === 'scrolled'" label="Scrolled past">
        <InputUI
          type="number"
          :model-value="String(binding.scrollAt ?? 50)"
          @update:model-value="(v) => (binding.scrollAt = Number(v) || undefined)"
        />
        <span class="w-6 shrink-0 text-right text-xs text-muted-foreground">px</span>
      </RowUI>

      <!-- Dismiss-on and Exclusive group are stored per binding, but the
           runtime folds them per EFFECT and target (useInteraction effectOptions):
           two bindings of this interaction on the same target resolve to ONE
           set of options, whichever the fold reaches first. -->
      <RowUI v-if="isDiscrete(binding)" label="Dismiss on">
        <div class="flex flex-1 justify-end gap-1">
          <ButtonUI
            v-for="mode in (['outside', 'escape'] as const)"
            :key="mode"
            :variant="isDismissOn(binding, mode) ? 'outline' : 'ghost'"
            size="xs"
            :class="isDismissOn(binding, mode) ? '' : 'text-muted-foreground opacity-60'"
            @click="toggleDismiss(binding, mode)"
          >
            {{ mode === 'outside' ? 'Outside click' : 'Escape' }}
          </ButtonUI>
        </div>
      </RowUI>

      <RowUI v-if="isDiscrete(binding)" label="Exclusive group">
        <InputUI
          placeholder="e.g. faq"
          :model-value="binding.group ?? ''"
          @update:model-value="(v) => (binding.group = v.trim() || undefined)"
        />
      </RowUI>

      <RowUI v-if="isDiscrete(binding)" label="Remember">
        <SelectUI
          :model-value="binding.once ?? ''"
          :options="ONCE_OPTIONS"
          @update:model-value="
            (v) => (binding.once = v ? (v as 'session' | 'local') : undefined)
          "
        />
      </RowUI>

      <p v-if="binding.once" class="px-1 text-[10px] text-muted-foreground">
        Remembered on the published site only — the editor always shows the element so you
        can still style it.
      </p>

      <RowUI v-if="breakpoints.length > 1" label="Breakpoints">
        <div class="flex flex-1 flex-wrap justify-end gap-1">
          <ButtonUI
            v-for="bp in breakpoints"
            :key="bp.id"
            :variant="isBreakpointOn(binding, bp.id) ? 'outline' : 'ghost'"
            size="xs"
            :class="isBreakpointOn(binding, bp.id) ? '' : 'text-muted-foreground opacity-60'"
            @click="toggleBreakpoint(binding, bp.id)"
          >
            {{ bp.name }}
          </ButtonUI>
        </div>
      </RowUI>

      <RowUI label="Target">
        <ButtonUI
          variant="outline"
          size="sm"
          :icon="Crosshair"
          class="min-w-0 flex-1 !justify-start"
          :class="pickingFor === binding && 'bg-accent text-accent-foreground'"
          @click="togglePicking(binding)"
          @mouseenter="previewTarget(binding)"
          @mouseleave="clearPreview()"
        >
          <span class="truncate">
            {{ pickingFor === binding ? 'Click an element' : targetName(binding) }}
          </span>
        </ButtonUI>
        <ButtonUI
          v-if="hasTarget(binding)"
          variant="icon"
          size="sm"
          :icon="X"
          tooltip="Reset target to this element"
          class="w-6 shrink-0 text-muted-foreground"
          @click="resetTarget(binding)"
        />
      </RowUI>

      <p class="px-1 text-[10px] text-muted-foreground">
        Shared · used on {{ usageCount(binding.interactionId) }}
        element{{ usageCount(binding.interactionId) === 1 ? '' : 's' }}
      </p>
    </template>
  </GroupPopover>

  <EffectLibraryList
    label="Interaction library"
    :items="libraryItems"
    empty-text="No saved interactions yet."
    noun="interaction"
    :is-applied="isApplied"
    :usage-count="usageCount"
    :can-apply="canEditElement"
    @open="(id) => openDetail('interaction', id)"
    @apply="apply"
    @remove="deleteInteraction"
  >
    <template #actions>
      <ButtonUI ref="newButton" variant="outline" size="sm" :icon="Plus" class="w-full" @click="createAndApply">
        New interaction
      </ButtonUI>
    </template>
  </EffectLibraryList>
</template>
