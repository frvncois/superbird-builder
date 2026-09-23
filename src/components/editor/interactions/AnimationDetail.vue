<script setup lang="ts">
// The focused editor for ONE saved animation — its name and its whole step
// timeline, shared by every element playing it. Renders alone in the panel
// (see useEffectDetail); the per-element half (trigger, target, replay, scrub,
// breakpoints, ▶) stays on the card, because those are about WHEN it plays.
//
// Takes an ID and re-resolves, never an object: undo and a branch switch swap
// the whole project graph, so a held object would detach silently.
import { computed, onBeforeUnmount, onMounted, nextTick, ref } from 'vue'
import { ArrowLeft, Copy, Plus, Trash2, X } from 'lucide-vue-next'
import RowUI from '@/components/ui/RowUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import ValueFieldUI from '@/components/ui/ValueFieldUI.vue'
import ColorFieldUI from '@/components/editor/style/ColorFieldUI.vue'
import { useAnimation } from '@/composables/useAnimation'
import { useInteraction } from '@/composables/useInteraction'
import { useEffectDetail } from '@/composables/useEffectDetail'
import { useSettings } from '@/composables/useSettings'
import { useModal } from '@/composables/useModal'
import { MOTION_PROPS, EASING_NAMES } from '@/lib/motion'
import type { AnimProp, AnimationStep } from '@/types/editor'

const props = defineProps<{ id: string; created: boolean }>()

const { animationFor, usageCount, deleteAnimation, animationError } = useAnimation()
const { pickingFor } = useInteraction()
const { closeDetail } = useEffectDetail()
const { validTokens } = useSettings()
const { confirm } = useModal()

const animation = computed(() => animationFor(props.id))

const EASING_OPTIONS = EASING_NAMES.map((e) => ({ label: e, value: e }))
const PROP_OPTIONS = (Object.keys(MOTION_PROPS) as AnimProp[]).map((p) => ({
  label: MOTION_PROPS[p].label,
  value: p,
}))
const colorTokens = computed(() => validTokens.value.map((t) => ({ name: t.name, value: t.value })))
const isColor = (prop: AnimProp) => MOTION_PROPS[prop].kind === 'color'

// --- steps ---

function addStep() {
  animation.value?.steps.push({
    id: crypto.randomUUID(),
    tracks: [{ prop: 'opacity', from: 0, to: 1 }],
    duration: 400,
    easing: 'ease-out',
  })
}
function duplicateStep(index: number) {
  const steps = animation.value?.steps
  const step = steps?.[index]
  if (!steps || !step) return
  steps.splice(index + 1, 0, { ...structuredClone(step), id: crypto.randomUUID() })
}
function removeStep(index: number) {
  const steps = animation.value?.steps
  if (steps && steps.length > 1) steps.splice(index, 1)
}
function addTrack(step: AnimationStep) {
  const used = new Set(step.tracks.map((t) => t.prop))
  const next = (Object.keys(MOTION_PROPS) as AnimProp[]).find((p) => !used.has(p)) ?? 'opacity'
  step.tracks.push({ prop: next, from: isColor(next) ? '#000000' : 0, to: isColor(next) ? '#ffffff' : 1 })
}
function removeTrack(step: AnimationStep, index: number) {
  step.tracks.splice(index, 1) // an empty step is caught by validation
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

// --- leaving ---

const nameField = ref<InstanceType<typeof InputUI>>()
onMounted(() => {
  if (props.created) nextTick(() => nameField.value?.focus())
})

/** Cancel discards outright: the cascading delete also strips the binding that
 * New auto-applied, wherever it landed — so it works even if the element has
 * since been deselected or deleted. */
function cancel() {
  deleteAnimation(props.id)
  closeDetail()
}

async function onDelete() {
  const used = usageCount(props.id)
  const ok = await confirm({
    title: 'Delete animation',
    message: used
      ? `Delete “${animation.value?.name}”? It is used on ${used} element${used === 1 ? '' : 's'}.`
      : `Delete “${animation.value?.name}”?`,
    confirmLabel: 'Delete',
  })
  if (!ok) return
  deleteAnimation(props.id)
  closeDetail()
}

// Escape peels back one layer instead of closing the whole panel, which is
// what SettingsEditor's bubble-phase handler would do. Capture phase +
// stopPropagation beats it to the event (same trick as PagesDrawer).
// It KEEPS the animation — only the Cancel button discards.
function onKeydownCapture(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (pickingFor.value) return // a pick in flight cancels first
  e.stopPropagation()
  closeDetail()
}
onMounted(() => window.addEventListener('keydown', onKeydownCapture, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydownCapture, true))
</script>

<template>
  <div v-if="animation" class="flex flex-col">
    <!-- the popover header already says New/Edit animation, so this row exists
         for the Back button and names the effect being edited. A brand new one
         has no name worth showing and nowhere to go back to. -->
    <div v-if="!created" class="flex items-center gap-1 border-b border-input px-1 py-1.5">
      <ButtonUI
        variant="icon"
        size="sm"
        :icon="ArrowLeft"
        tooltip="Back"
        class="w-7 text-muted-foreground"
        @click="closeDetail()"
      />
      <span class="min-w-0 flex-1 truncate px-1 text-xs font-medium">{{ animation.name }}</span>
    </div>

    <div class="flex flex-col gap-1.5 p-3">
      <RowUI label="Name">
        <InputUI ref="nameField" v-model="animation.name" placeholder="Animation" />
      </RowUI>

      <!-- steps: the timeline, read top to bottom -->
      <div class="flex flex-col gap-2 pt-1">
        <div
          v-for="(step, si) in animation.steps"
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
              @click="duplicateStep(si)"
            />
            <ButtonUI
              v-if="animation.steps.length > 1"
              variant="icon" size="xs" :icon="Trash2" tooltip="Delete step"
              class="w-5 text-muted-foreground hover:!text-danger"
              @click="removeStep(si)"
            />
          </div>

          <!-- property tracks -->
          <!-- keyed by index AND prop: a track has no id, and a bare index
               makes the value fields keep their draft text when one is removed -->
          <div v-for="(track, ti) in step.tracks" :key="`${ti}-${track.prop}`" class="flex items-center gap-1">
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

        <ButtonUI variant="outline" size="sm" :icon="Plus" class="w-full" @click="addStep">
          Add step
        </ButtonUI>
      </div>

      <p v-if="animationError(animation)" class="px-1 text-[10px] text-danger">
        {{ animationError(animation) }}
      </p>
      <p class="px-1 text-[10px] text-muted-foreground">
        Shared — played by {{ usageCount(id) }} element{{ usageCount(id) === 1 ? '' : 's' }}.
      </p>
    </div>

    <div class="flex items-center gap-1.5 border-t border-input p-3">
      <template v-if="created">
        <ButtonUI variant="ghost" size="sm" class="text-muted-foreground" @click="cancel">
          Cancel
        </ButtonUI>
        <ButtonUI variant="default" size="sm" class="flex-1" @click="closeDetail()">Done</ButtonUI>
      </template>
      <ButtonUI v-else variant="ghost" size="sm" class="text-danger" @click="onDelete">
        Delete animation
      </ButtonUI>
    </div>
  </div>
</template>
