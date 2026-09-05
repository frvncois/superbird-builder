<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { usePanel } from '@/composables/usePanel'
import { Crosshair, Eye, MousePointer2, MousePointerClick, Plus, Trash2, X } from 'lucide-vue-next'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import RowUI from '@/components/ui/RowUI.vue'
import SliderUI from '@/components/ui/SliderUI.vue'
import IconGroupUI from '@/components/ui/IconGroupUI.vue'
import ClassFieldInput from '@/components/editor/style/ClassFieldInput.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import { useElement } from '@/composables/useElement'
import { useInteraction } from '@/composables/useInteraction'
import { useProject } from '@/composables/useProject'
import { useShortcut } from '@/composables/useShortcut'
import { useComponents } from '@/composables/useComponents'
import type { Interaction, InteractionBinding } from '@/types/editor'

const { selectedElement, getElement, highlightElement } = useElement()
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
const { masterFor, findMasterNode } = useComponents()
const { breakpoints } = useProject()

// inside a component instance, interaction edits land on the shared master
const target = computed(() =>
  selectedElement.value
    ? (masterFor(selectedElement.value.id)?.master ?? selectedElement.value)
    : null,
)

// Esc cancels a pending target pick
useShortcut('Escape', { onDown: () => (pickingFor.value = null) })

const TRIGGERS = [
  { label: 'Hover', value: 'hover', icon: MousePointer2 },
  { label: 'Click', value: 'click', icon: MousePointerClick },
  { label: 'Appear', value: 'appear', icon: Eye },
]

const DURATION_STOPS = ['75', '100', '150', '200', '300', '500', '700', '1000']

function durationIndex(animation: Interaction): number {
  const i = DURATION_STOPS.indexOf(animation.duration.replace('duration-', ''))
  return i === -1 ? DURATION_STOPS.indexOf('300') : i
}
function setDuration(animation: Interaction, index: number) {
  animation.duration = `duration-${DURATION_STOPS[index] ?? '300'}`
}

const EASINGS = [
  { label: 'Linear', value: 'ease-linear' },
  { label: 'Ease in', value: 'ease-in' },
  { label: 'Ease out', value: 'ease-out' },
  { label: 'Ease in-out', value: 'ease-in-out' },
]

// --- applied to the selected element ---

const bindings = computed(() => target.value?.interactions ?? [])

function animName(binding: InteractionBinding): string {
  return animationFor(binding.interactionId)?.name ?? 'Missing interaction'
}

function isApplied(interactionId: string): boolean {
  return bindings.value.some((b) => b.interactionId === interactionId)
}

function apply(interactionId: string) {
  if (target.value && !isApplied(interactionId)) applyTo(target.value, interactionId)
}

function createAndApply() {
  if (!target.value) return
  apply(createInteraction().id)
}

function unapply(binding: InteractionBinding) {
  if (target.value) removeBinding(target.value, binding.id)
}

// --- library delete (two-step inline confirm) ---

const pendingDelete = ref<string | null>(null)
function confirmDelete(interactionId: string) {
  deleteInteraction(interactionId)
  pendingDelete.value = null
}

// +I in the code editor focuses the first applied interaction's To field
const { pendingFocus } = usePanel()
const toFields = ref<InstanceType<typeof ClassFieldInput>[]>([])

function consumeFocus() {
  if (pendingFocus.value !== 'interactions') return
  pendingFocus.value = null
  nextTick(() => toFields.value[0]?.focus())
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
  <!-- applied to the selected element -->
  <GroupPopover
    v-for="binding in bindings"
    :key="binding.id"
    :label="animName(binding)"
  >
    <template v-if="animationFor(binding.interactionId)">
      <RowUI label="Name">
        <InputUI :model-value="animationFor(binding.interactionId)!.name"
          @update:model-value="(v) => (animationFor(binding.interactionId)!.name = v)" />
        <template #end>
          <ButtonUI
            variant="icon"
            size="sm"
            :icon="X"
            tooltip="Remove from this element"
            class="w-6 shrink-0 text-muted-foreground"
            @click="unapply(binding)"
          />
        </template>
      </RowUI>

      <RowUI label="Trigger">
        <IconGroupUI
          :options="TRIGGERS"
          :model-value="binding.trigger"
          @update:model-value="(v) => (binding.trigger = v as InteractionBinding['trigger'])"
        />
      </RowUI>

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

      <RowUI label="Easing">
        <SelectUI
          :model-value="animationFor(binding.interactionId)!.easing"
          :options="EASINGS"
          @update:model-value="(v) => v && (animationFor(binding.interactionId)!.easing = v)"
        />
      </RowUI>

      <RowUI label="Duration">
        <SliderUI
          :min="0"
          :max="DURATION_STOPS.length - 1"
          :model-value="durationIndex(animationFor(binding.interactionId)!)"
          @update:model-value="(v) => setDuration(animationFor(binding.interactionId)!, v)"
        />
        <span class="w-12 shrink-0 text-right font-mono text-xs text-muted-foreground">
          {{ animationFor(binding.interactionId)!.duration.replace('duration-', '') }}ms
        </span>
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

      <RowUI label="To">
        <ClassFieldInput
          ref="toFields"
          :model-value="animationFor(binding.interactionId)!.toClasses"
          :prerequisites="false"
          class="font-mono"
          @update:model-value="(v) => (animationFor(binding.interactionId)!.toClasses = v)"
        />
      </RowUI>

      <p class="px-1 text-[10px] text-muted-foreground">
        Shared · used on {{ usageCount(binding.interactionId) }}
        element{{ usageCount(binding.interactionId) === 1 ? '' : 's' }}
      </p>
    </template>
  </GroupPopover>

  <!-- project library -->
  <GroupPopover label="Library">
    <p v-if="!library.length" class="text-xs text-muted-foreground">
      No saved interactions yet.
    </p>
    <div
      v-for="animation in library"
      :key="animation.id"
      class="flex flex-col gap-1"
    >
      <div class="flex items-center gap-1.5">
        <span class="min-w-0 flex-1 truncate text-xs">{{ animation.name }}</span>
        <ButtonUI
          variant="outline"
          size="xs"
          :disabled="isApplied(animation.id)"
          @click="apply(animation.id)"
        >
          {{ isApplied(animation.id) ? 'Applied' : 'Apply' }}
        </ButtonUI>
        <ButtonUI
          variant="ghost"
          size="xs"
          :icon="Trash2"
          tooltip="Delete interaction"
          class="text-muted-foreground"
          @click="pendingDelete = animation.id"
        />
      </div>
      <div
        v-if="pendingDelete === animation.id"
        class="flex items-center gap-1.5 pl-1 text-[10px] text-muted-foreground"
      >
        <span class="flex-1">Delete from {{ usageCount(animation.id) }} element{{ usageCount(animation.id) === 1 ? '' : 's' }}?</span>
        <ButtonUI variant="ghost" size="xs" @click="pendingDelete = null">Cancel</ButtonUI>
        <ButtonUI variant="outline" size="xs" class="text-danger" @click="confirmDelete(animation.id)">
          Delete
        </ButtonUI>
      </div>
    </div>
  </GroupPopover>

  <div class="p-3">
    <ButtonUI variant="outline" size="sm" :icon="Plus" class="w-full" @click="createAndApply">
      New interaction
    </ButtonUI>
  </div>
</template>
