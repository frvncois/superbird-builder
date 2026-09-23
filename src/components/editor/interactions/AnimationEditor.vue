<script setup lang="ts">
// The tween-animation half of the Interactions panel: the bindings applied to
// the selected element — WHEN each one plays — plus the project library.
//
// What the animation DOES (its name and step timeline) is shared by every
// element playing it, so it lives in the focused AnimationDetail view instead;
// editing it here among per-element controls made it read as per-element.
import { computed } from 'vue'
import {
  Crosshair, Eye, MousePointer2, MousePointerClick, Pencil, Play, Plus, Sparkles,
  MoveVertical, Zap, X,
} from 'lucide-vue-next'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import RowUI from '@/components/ui/RowUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import MenuUI from '@/components/ui/MenuUI.vue'
import IconGroupUI from '@/components/ui/IconGroupUI.vue'
import ValueFieldUI from '@/components/ui/ValueFieldUI.vue'
import EffectLibraryList from '@/components/editor/interactions/EffectLibraryList.vue'
import { useElement } from '@/composables/useElement'
import { useComponents } from '@/composables/useComponents'
import { useProject } from '@/composables/useProject'
import { useInteraction } from '@/composables/useInteraction'
import { useAnimation } from '@/composables/useAnimation'
import { useMotion } from '@/composables/useMotion'
import { useSettings } from '@/composables/useSettings'
import { useEffectDetail } from '@/composables/useEffectDetail'
import { SCRUB_DEFAULTS } from '@/lib/motion'
import { MOTION_PRESETS } from '@/lib/motionPresets'
import type { AnimationBinding } from '@/types/editor'

const { getElement, highlightElement, isMultiSelect } = useElement()
const { editTarget, findMasterNode } = useComponents()
const { breakpoints } = useProject()
const { pickingFor } = useInteraction()
const {
  library, animationFor, createAnimation, createFromPreset, deleteAnimation,
  usageCount, applyTo, removeBinding, toggleBreakpoint, animationError,
} = useAnimation()
const motion = useMotion()
const { settings } = useSettings()
const { openDetail } = useEffectDetail()

// inside a component instance, animation edits land on the shared master
const target = editTarget

/** the per-element half needs exactly one element; the library below doesn't */
const canEditElement = computed(() => !!target.value && !isMultiSelect.value)

const bindings = computed(() => (canEditElement.value ? (target.value?.animations ?? []) : []))

const TRIGGERS = [
  { label: 'Page load', value: 'load', icon: Zap },
  { label: 'Scroll into view', value: 'appear', icon: Eye },
  { label: 'Scroll progress', value: 'scrub', icon: MoveVertical },
  { label: 'Hover', value: 'hover', icon: MousePointer2 },
  { label: 'Click', value: 'click', icon: MousePointerClick },
]

const APPEAR_MODE_LABELS: Record<string, string> = {
  once: 'Once',
  replay: 'Every time',
  reverse: 'Reverse on exit',
}

// 'inherit' is the stored `undefined` — the site default set in
// Settings → Interactions, named here so the row says what it resolves to
const APPEAR_MODES = computed(() => [
  {
    label: `Site default (${APPEAR_MODE_LABELS[settings.value.motion?.appearMode ?? 'once']})`,
    value: 'inherit',
  },
  ...Object.entries(APPEAR_MODE_LABELS).map(([value, label]) => ({ label, value })),
])

// --- library ---

const libraryItems = computed(() => library.value.map((a) => ({ id: a.id, name: a.name })))

function isApplied(animationId: string): boolean {
  return bindings.value.some((b) => b.animationId === animationId)
}

function apply(animationId: string) {
  if (canEditElement.value && !isApplied(animationId)) applyTo(target.value!, animationId)
}

/** an invalid animation applied nowhere has no card to report on it, so the
 * library row is the only place its error can surface */
function errorFor(animationId: string): string | null {
  const animation = animationFor(animationId)
  return animation ? animationError(animation) : null
}

/** creating always adds to the library and opens the editor; applying to the
 * selection is the bonus when there IS one */
function newAnimation() {
  const animation = createAnimation()
  if (canEditElement.value) applyTo(target.value!, animation.id)
  openDetail('animation', animation.id, true)
}

function newFromPreset(presetId: (typeof MOTION_PRESETS)[number]['id'], close: () => void) {
  close()
  const preset = MOTION_PRESETS.find((p) => p.id === presetId)
  const animation = createFromPreset(presetId)
  if (canEditElement.value) {
    // applyTo returns the binding it made — reading it back off the end of the
    // list would pick the wrong one the moment anything else appends
    const binding = applyTo(target.value!, animation.id)
    // the preset knows which trigger it was designed for
    if (preset) binding.trigger = preset.trigger
  }
  openDetail('animation', animation.id, true)
}

function unapply(binding: AnimationBinding) {
  if (!target.value) return
  motion.stop(binding)
  removeBinding(target.value, binding.id)
}

// --- preview ---
// stays per-element: a timeline can only play on a real element on the canvas,
// and the detail view may have no selection at all

function previewBinding(binding: AnimationBinding) {
  const animation = animationFor(binding.animationId)
  if (!animation || !target.value) return
  motion.preview(animation, binding.targetId ?? target.value.id)
}

// --- target picker ---

const hasTarget = (b: AnimationBinding) => !!b.targetId && b.targetId !== target.value?.id
function targetName(b: AnimationBinding): string {
  if (!hasTarget(b)) return 'self'
  const node = getElement(b.targetId!) ?? findMasterNode(b.targetId!)
  return node ? node.type : 'Missing'
}
const togglePicking = (b: AnimationBinding) => (pickingFor.value = pickingFor.value === b ? null : b)
const previewTarget = (b: AnimationBinding) => hasTarget(b) && highlightElement(b.targetId!)
const clearPreview = () => highlightElement(null)
const resetTarget = (b: AnimationBinding) => (b.targetId = null)

const isBreakpointOn = (b: AnimationBinding, id: string) =>
  !b.breakpoints || b.breakpoints.includes(id)
</script>

<template>
  <GroupPopover v-for="binding in bindings" :key="binding.id" :label="animationFor(binding.animationId)?.name ?? 'Missing animation'">
    <template v-if="animationFor(binding.animationId)">
      <div class="flex items-center gap-1">
        <ButtonUI
          variant="outline" size="xs" :icon="Pencil"
          class="min-w-0 flex-1 !justify-start"
          @click="openDetail('animation', binding.animationId)"
        >
          Edit animation
        </ButtonUI>
        <ButtonUI
          variant="icon" size="sm" :icon="Play" tooltip="Play on the canvas"
          class="w-6 shrink-0 text-muted-foreground"
          @click="previewBinding(binding)"
        />
        <ButtonUI
          variant="icon" size="sm" :icon="X" tooltip="Remove from this element"
          class="w-6 shrink-0 text-muted-foreground"
          @click="unapply(binding)"
        />
      </div>

      <RowUI label="Trigger">
        <IconGroupUI
          :options="TRIGGERS"
          :model-value="binding.trigger"
          @update:model-value="(v) => v && (binding.trigger = v as AnimationBinding['trigger'])"
        />
      </RowUI>

      <RowUI v-if="binding.trigger === 'appear'" label="Replay">
        <SelectUI
          :options="APPEAR_MODES"
          :model-value="binding.appearMode ?? 'inherit'"
          @update:model-value="
            (v) => (binding.appearMode = v === 'inherit' ? undefined : (v as AnimationBinding['appearMode']))
          "
        />
      </RowUI>

      <RowUI v-if="binding.trigger === 'appear'" label="Starts at">
        <ValueFieldUI
          :model-value="String(binding.appearAt ?? 0)"
          @commit="(t) => (binding.appearAt = parseFloat(t) > 0 ? Math.min(1, parseFloat(t)) : undefined)"
        />
        <span class="text-[10px] text-muted-foreground">× viewport (0 = first pixel)</span>
      </RowUI>

      <template v-if="binding.trigger === 'scrub'">
        <RowUI label="Starts">
          <ValueFieldUI
            :model-value="String(binding.scrub?.start ?? SCRUB_DEFAULTS.start)"
            @commit="(t) => (binding.scrub = { ...binding.scrub, start: parseFloat(t) || 0 })"
          />
          <span class="text-[10px] text-muted-foreground">× viewport</span>
        </RowUI>
        <RowUI label="Ends">
          <ValueFieldUI
            :model-value="String(binding.scrub?.end ?? SCRUB_DEFAULTS.end)"
            @commit="(t) => (binding.scrub = { ...binding.scrub, end: parseFloat(t) || 0 })"
          />
          <span class="text-[10px] text-muted-foreground">× viewport</span>
        </RowUI>
        <p class="px-1 text-[10px] text-muted-foreground">
          Progress runs from 0 when the element's top sits that far down the viewport, to 1
          when it reaches the second mark. Scroll the Preview to see it.
        </p>
      </template>

      <RowUI v-if="breakpoints.length > 1" label="Breakpoints">
        <div class="flex flex-1 flex-wrap justify-end gap-1">
          <ButtonUI
            v-for="bp in breakpoints"
            :key="bp.id"
            :variant="isBreakpointOn(binding, bp.id) ? 'outline' : 'ghost'"
            size="xs"
            :class="isBreakpointOn(binding, bp.id) ? '' : 'text-muted-foreground opacity-60'"
            @click="toggleBreakpoint(binding, bp.id, breakpoints.map((b) => b.id))"
          >
            {{ bp.name }}
          </ButtonUI>
        </div>
      </RowUI>

      <RowUI label="Moves">
        <ButtonUI
          variant="outline" size="sm" :icon="Crosshair"
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
          variant="icon" size="sm" :icon="X" tooltip="Reset to this element"
          class="w-6 shrink-0 text-muted-foreground"
          @click="resetTarget(binding)"
        />
      </RowUI>

      <p v-if="errorFor(binding.animationId)" class="px-1 text-[10px] text-danger">
        {{ errorFor(binding.animationId) }}
      </p>
      <p class="px-1 text-[10px] text-muted-foreground">
        Shared · used on {{ usageCount(binding.animationId) }}
        element{{ usageCount(binding.animationId) === 1 ? '' : 's' }}
      </p>
    </template>
  </GroupPopover>

  <EffectLibraryList
    label="Animation library"
    :items="libraryItems"
    empty-text="No saved animations yet."
    noun="animation"
    :is-applied="isApplied"
    :usage-count="usageCount"
    :can-apply="canEditElement"
    :error-for="errorFor"
    @open="(id) => openDetail('animation', id)"
    @apply="apply"
    @remove="deleteAnimation"
  >
    <template #actions>
      <div class="flex gap-1.5">
        <ButtonUI variant="outline" size="sm" :icon="Plus" class="min-w-0 flex-1" @click="newAnimation">
          New animation
        </ButtonUI>
        <MenuUI
          width="w-60"
          align="right"
          trigger-class="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-accent px-3 text-xs font-medium transition-colors outline-none hover:bg-accent/30 hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-accent"
        >
          <template #trigger>
            <Sparkles class="size-3.5 shrink-0" /> Presets
          </template>
          <template #default="{ close }">
            <button
              v-for="preset in MOTION_PRESETS"
              :key="preset.id"
              type="button"
              class="flex flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-accent/30"
              @click="newFromPreset(preset.id, close)"
            >
              <span class="text-xs">{{ preset.label }}</span>
              <span class="text-[10px] text-muted-foreground">{{ preset.description }}</span>
            </button>
          </template>
        </MenuUI>
      </div>
    </template>
  </EffectLibraryList>
</template>
