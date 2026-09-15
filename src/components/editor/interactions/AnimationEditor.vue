<script setup lang="ts">
// The tween-animation half of the Interactions panel: bindings applied to the
// selected element, each opening a steps editor over the shared library
// timeline, plus the library itself and the preset shortcuts.
import { computed, ref } from 'vue'
import {
  Copy, Crosshair, Eye, MousePointer2, MousePointerClick, Play, Plus, Sparkles, Trash2,
  MoveVertical, Zap, X,
} from 'lucide-vue-next'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import RowUI from '@/components/ui/RowUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import MenuUI from '@/components/ui/MenuUI.vue'
import IconGroupUI from '@/components/ui/IconGroupUI.vue'
import ValueFieldUI from '@/components/ui/ValueFieldUI.vue'
import ColorFieldUI from '@/components/editor/style/ColorFieldUI.vue'
import { useElement } from '@/composables/useElement'
import { useComponents } from '@/composables/useComponents'
import { useProject } from '@/composables/useProject'
import { useInteraction } from '@/composables/useInteraction'
import { useAnimation } from '@/composables/useAnimation'
import { useMotion } from '@/composables/useMotion'
import { useSettings } from '@/composables/useSettings'
import { MOTION_PROPS, EASING_NAMES, SCRUB_DEFAULTS } from '@/lib/motion'
import { MOTION_PRESETS } from '@/lib/motionPresets'
import type { AnimProp, Animation, AnimationBinding, AnimationStep } from '@/types/editor'

const { selectedElement, getElement, highlightElement } = useElement()
const { masterFor, findMasterNode } = useComponents()
const { breakpoints } = useProject()
const { pickingFor } = useInteraction()
const {
  library, animationFor, createAnimation, createFromPreset, deleteAnimation,
  usageCount, applyTo, removeBinding, toggleBreakpoint, animationError,
} = useAnimation()
const motion = useMotion()
const { validTokens } = useSettings()

// inside a component instance, animation edits land on the shared master
const target = computed(() =>
  selectedElement.value
    ? (masterFor(selectedElement.value.id)?.master ?? selectedElement.value)
    : null,
)

const bindings = computed(() => target.value?.animations ?? [])

const TRIGGERS = [
  { label: 'Page load', value: 'load', icon: Zap },
  { label: 'Scroll into view', value: 'appear', icon: Eye },
  { label: 'Scroll progress', value: 'scrub', icon: MoveVertical },
  { label: 'Hover', value: 'hover', icon: MousePointer2 },
  { label: 'Click', value: 'click', icon: MousePointerClick },
]

const APPEAR_MODES = [
  { label: 'Once', value: 'once' },
  { label: 'Every time', value: 'replay' },
  { label: 'Reverse on exit', value: 'reverse' },
]

const EASING_OPTIONS = EASING_NAMES.map((e) => ({ label: e, value: e }))
const PROP_OPTIONS = (Object.keys(MOTION_PROPS) as AnimProp[]).map((p) => ({
  label: MOTION_PROPS[p].label,
  value: p,
}))

const colorTokens = computed(() => validTokens.value.map((t) => ({ name: t.name, value: t.value })))
const isColor = (prop: AnimProp) => MOTION_PROPS[prop].kind === 'color'

// --- apply / unapply ---

const isApplied = (animationId: string) =>
  bindings.value.some((b) => b.animationId === animationId)

function apply(animationId: string) {
  if (target.value && !isApplied(animationId)) applyTo(target.value, animationId)
}
function newAnimation() {
  if (target.value) apply(createAnimation().id)
}
function newFromPreset(presetId: (typeof MOTION_PRESETS)[number]['id'], close: () => void) {
  close()
  if (!target.value) return
  const preset = MOTION_PRESETS.find((p) => p.id === presetId)
  const animation = createFromPreset(presetId)
  applyTo(target.value, animation.id)
  // the preset knows which trigger it was designed for
  const binding = bindings.value.at(-1)
  if (binding && preset) binding.trigger = preset.trigger
}
function unapply(binding: AnimationBinding) {
  if (!target.value) return
  motion.stop(binding)
  removeBinding(target.value, binding.id)
}

// --- preview ---

function previewBinding(binding: AnimationBinding) {
  const animation = animationFor(binding.animationId)
  if (!animation || !target.value) return
  motion.preview(animation, binding.targetId ?? target.value.id)
}

// --- target picking (shares the interaction picker) ---

const hasTarget = (b: AnimationBinding) => !!b.targetId && b.targetId !== target.value?.id
function targetName(b: AnimationBinding): string {
  if (!hasTarget(b)) return 'This element'
  const node = getElement(b.targetId!) ?? findMasterNode(b.targetId!)
  return node ? node.type : 'Missing'
}
const togglePicking = (b: AnimationBinding) => (pickingFor.value = pickingFor.value === b ? null : b)
const previewTarget = (b: AnimationBinding) => hasTarget(b) && highlightElement(b.targetId!)
const clearPreview = () => highlightElement(null)
const resetTarget = (b: AnimationBinding) => (b.targetId = null)

const isBreakpointOn = (b: AnimationBinding, id: string) =>
  !b.breakpoints || b.breakpoints.includes(id)

// --- steps ---

function addStep(animation: Animation) {
  animation.steps.push({
    id: crypto.randomUUID(),
    tracks: [{ prop: 'opacity', from: 0, to: 1 }],
    duration: 400,
    easing: 'ease-out',
  })
}
function duplicateStep(animation: Animation, index: number) {
  const step = animation.steps[index]
  if (!step) return
  animation.steps.splice(index + 1, 0, {
    ...structuredClone(step),
    id: crypto.randomUUID(),
  })
}
function removeStep(animation: Animation, index: number) {
  if (animation.steps.length > 1) animation.steps.splice(index, 1)
}
function addTrack(step: AnimationStep) {
  const used = new Set(step.tracks.map((t) => t.prop))
  const next = (Object.keys(MOTION_PROPS) as AnimProp[]).find((p) => !used.has(p)) ?? 'opacity'
  step.tracks.push({ prop: next, from: isColor(next) ? '#000000' : 0, to: isColor(next) ? '#ffffff' : 1 })
}
function removeTrack(step: AnimationStep, index: number) {
  if (step.tracks.length > 1) step.tracks.splice(index, 1)
  else step.tracks.splice(index, 1) // an empty step is caught by validation
}
/** switching property resets the values to that property's sensible pair */
function setTrackProp(step: AnimationStep, index: number, prop: AnimProp) {
  const track = step.tracks[index]
  if (!track) return
  track.prop = prop
  if (isColor(prop)) {
    track.from = '#000000'
    track.to = '#ffffff'
  } else {
    track.from = MOTION_PROPS[prop].def as number
    track.to = prop === 'opacity' || prop === 'scale' ? 1 : 100
  }
}

const numText = (v: number | string | undefined) => (v === undefined ? '' : String(v))

// track values may carry a unit — '110%', '1em', '50vw' — so a move can be
// relative to the element or the viewport instead of a px measured at one size
const TRACK_VALUE_RE = /^-?\d+(\.\d+)?(px|%|em|rem|vw|vh|deg)?$/
const isTrackValue = (text: string) => text.trim() === '' || TRACK_VALUE_RE.test(text.trim())
/** a bare number stays a number (the property's own unit); a united value
 * stays a string so the unit survives into the CSS */
function trackValue(text: string): number | string {
  const t = text.trim()
  const n = parseFloat(t)
  return /^-?\d+(\.\d+)?$/.test(t) ? (isFinite(n) ? n : 0) : t
}
function setNum<T, K extends keyof T>(obj: T, key: K, text: string, fallback = 0) {
  const n = parseFloat(text)
  obj[key] = (text.trim() === '' ? fallback : isFinite(n) ? n : fallback) as T[K]
}

// --- library delete (two-step inline confirm, same as interactions) ---
const pendingDelete = ref<string | null>(null)
function confirmDelete(id: string) {
  deleteAnimation(id)
  pendingDelete.value = null
}
</script>

<template>
  <GroupPopover v-for="binding in bindings" :key="binding.id" :label="animationFor(binding.animationId)?.name ?? 'Missing animation'">
    <template v-if="animationFor(binding.animationId)">
      <RowUI label="Name">
        <InputUI
          :model-value="animationFor(binding.animationId)!.name"
          @update:model-value="(v) => (animationFor(binding.animationId)!.name = v)"
        />
        <template #end>
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
        </template>
      </RowUI>

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
          :model-value="binding.appearMode ?? 'once'"
          @update:model-value="(v) => (binding.appearMode = v === 'once' ? undefined : (v as 'replay' | 'reverse'))"
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

      <!-- steps: the timeline, read top to bottom -->
      <div class="flex flex-col gap-2 pt-1">
        <div
          v-for="(step, si) in animationFor(binding.animationId)!.steps"
          :key="step.id"
          class="flex flex-col gap-1.5 rounded-xl border border-input p-2"
        >
          <div class="flex items-center gap-1">
            <span class="flex-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              Step {{ si + 1 }}
            </span>
            <ButtonUI
              variant="icon" size="xs" :icon="Copy" tooltip="Duplicate step"
              class="w-5 text-muted-foreground"
              @click="duplicateStep(animationFor(binding.animationId)!, si)"
            />
            <ButtonUI
              v-if="animationFor(binding.animationId)!.steps.length > 1"
              variant="icon" size="xs" :icon="Trash2" tooltip="Delete step"
              class="w-5 text-muted-foreground hover:!text-danger"
              @click="removeStep(animationFor(binding.animationId)!, si)"
            />
          </div>

          <!-- property tracks -->
          <div v-for="(track, ti) in step.tracks" :key="ti" class="flex items-center gap-1">
            <div class="min-w-0 flex-1">
              <SelectUI
                :options="PROP_OPTIONS"
                :model-value="track.prop"
                @update:model-value="(v) => v && setTrackProp(step, ti, v as AnimProp)"
              />
            </div>
            <template v-if="isColor(track.prop)">
              <ColorFieldUI
                :model-value="String(track.from ?? '')"
                :tokens="colorTokens"
                :swatch="String(track.from ?? '#000000')"
                placeholder="from"
                @commit="(t) => (track.from = t)"
                @pick="(v) => (track.from = v)"
              />
              <span class="shrink-0 text-[10px] text-muted-foreground">→</span>
              <ColorFieldUI
                :model-value="String(track.to ?? '')"
                :tokens="colorTokens"
                :swatch="String(track.to ?? '#ffffff')"
                placeholder="to"
                @commit="(t) => (track.to = t)"
                @pick="(v) => (track.to = v)"
              />
            </template>
            <template v-else>
              <ValueFieldUI
                v-tooltip="'From (empty = current value)'"
                :model-value="numText(track.from)"
                placeholder="auto"
                allow-negative
                :validate="isTrackValue"
                @commit="(t) => (t.trim() === '' ? (track.from = undefined) : (track.from = trackValue(t)))"
              />
              <span class="shrink-0 text-[10px] text-muted-foreground">→</span>
              <ValueFieldUI
                v-tooltip="'To'"
                :model-value="numText(track.to)"
                allow-negative
                :validate="isTrackValue"
                @commit="(t) => (track.to = trackValue(t))"
              />
            </template>
            <ButtonUI
              variant="icon" size="xs" :icon="X" tooltip="Remove property"
              class="w-5 shrink-0 text-muted-foreground"
              @click="removeTrack(step, ti)"
            />
          </div>
          <ButtonUI
            variant="ghost" size="xs" :icon="Plus"
            class="justify-start text-muted-foreground"
            @click="addTrack(step)"
          >
            Property
          </ButtonUI>

          <div class="h-px bg-input" />

          <RowUI label="Duration">
            <ValueFieldUI
              :model-value="String(step.duration)"
              @commit="(t) => setNum(step, 'duration', t, 400)"
            />
            <span class="text-[10px] text-muted-foreground">ms</span>
          </RowUI>
          <RowUI label="Easing">
            <SelectUI
              :options="EASING_OPTIONS"
              :model-value="step.easing"
              @update:model-value="(v) => v && (step.easing = v)"
            />
          </RowUI>
          <RowUI v-if="si > 0" label="Offset">
            <ValueFieldUI
              :model-value="String(step.offset ?? 0)"
              allow-negative
              @commit="(t) => (t.trim() === '' || t === '0' ? (step.offset = undefined) : setNum(step, 'offset', t))"
            />
            <span class="text-[10px] text-muted-foreground">ms · negative overlaps</span>
          </RowUI>
          <RowUI label="Stagger">
            <ValueFieldUI
              :model-value="String(step.stagger ?? 0)"
              @commit="(t) => (t.trim() === '' || t === '0' ? (step.stagger = undefined) : setNum(step, 'stagger', t))"
            />
            <span class="text-[10px] text-muted-foreground">ms per child</span>
          </RowUI>
          <RowUI v-if="step.stagger" label="Cascade">
            <InputUI
              :model-value="step.staggerSelector ?? ''"
              placeholder="direct children"
              class="font-mono"
              @update:model-value="(v) => (step.staggerSelector = v.trim() || undefined)"
            />
          </RowUI>
          <p v-if="step.stagger" class="text-[10px] text-muted-foreground">
            Staggered properties move the children; the step's other properties still move
            this element.
          </p>
          <RowUI label="Repeat">
            <ValueFieldUI
              v-tooltip="'Extra plays after the first — −1 repeats forever'"
              :model-value="String(step.repeat ?? 0)"
              allow-negative
              @commit="(t) => (t.trim() === '' || t === '0' ? (step.repeat = undefined) : setNum(step, 'repeat', t))"
            />
            <span class="text-[10px] text-muted-foreground">−1 = forever</span>
            <ButtonUI
              :variant="step.yoyo ? 'outline' : 'ghost'"
              size="xs"
              class="ml-auto"
              :class="step.yoyo ? '' : 'text-muted-foreground opacity-60'"
              tooltip="Play each repeat back and forth"
              @click="step.yoyo = step.yoyo ? undefined : true"
            >
              Yoyo
            </ButtonUI>
          </RowUI>
        </div>

        <ButtonUI variant="outline" size="sm" :icon="Plus" class="w-full" @click="addStep(animationFor(binding.animationId)!)">
          Add step
        </ButtonUI>
      </div>

      <p v-if="animationError(animationFor(binding.animationId)!)" class="px-1 text-[10px] text-danger">
        {{ animationError(animationFor(binding.animationId)!) }}
      </p>
      <p class="px-1 text-[10px] text-muted-foreground">
        Shared · used on {{ usageCount(binding.animationId) }}
        element{{ usageCount(binding.animationId) === 1 ? '' : 's' }}
      </p>
    </template>
  </GroupPopover>

  <!-- project library: the list, then this half's actions — grouped together
       so "New animation / Presets" can't be mistaken for panel-wide buttons -->
  <GroupPopover label="Animation library">
    <p v-if="!library.length" class="text-xs text-muted-foreground">No saved animations yet.</p>
    <div v-for="animation in library" :key="animation.id" class="flex flex-col gap-1">
      <div class="flex items-center gap-1.5">
        <span class="min-w-0 flex-1 truncate text-xs">{{ animation.name }}</span>
        <ButtonUI
          variant="outline" size="xs" :disabled="isApplied(animation.id)"
          @click="apply(animation.id)"
        >
          {{ isApplied(animation.id) ? 'Applied' : 'Apply' }}
        </ButtonUI>
        <ButtonUI
          variant="ghost" size="xs" :icon="Trash2" tooltip="Delete animation"
          class="text-muted-foreground"
          @click="pendingDelete = animation.id"
        />
      </div>
      <div
        v-if="pendingDelete === animation.id"
        class="flex items-center gap-1.5 pl-1 text-[10px] text-muted-foreground"
      >
        <span class="flex-1">
          Delete from {{ usageCount(animation.id) }}
          element{{ usageCount(animation.id) === 1 ? '' : 's' }}?
        </span>
        <ButtonUI variant="ghost" size="xs" @click="pendingDelete = null">Cancel</ButtonUI>
        <ButtonUI variant="outline" size="xs" class="text-danger" @click="confirmDelete(animation.id)">
          Delete
        </ButtonUI>
      </div>
    </div>

    <div class="flex gap-1.5 pt-1">
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
  </GroupPopover>
</template>
