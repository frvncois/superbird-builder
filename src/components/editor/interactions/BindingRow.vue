<script setup lang="ts">
// One behaviour on the selected element, read as a sentence — WHEN it fires,
// WHAT plays, and on WHICH element — collapsed to a single line until opened.
//
// Both kinds render through this one row: a tween animation (`Animation`) and a
// class toggle (`Classes`) differ in engine, not in what the author decides
// here, so they share the header, the trigger, the target and the Remove, and
// only the kind-specific rows differ. What the effect DOES is shared by every
// element using it and is edited in the focused detail view (Edit).
import { computed, ref } from 'vue'
import {
  ChevronRight, Crosshair, Eye, MousePointer2, MousePointerClick, MoveVertical, Pencil, Play,
  ToggleLeft, X, Zap,
} from 'lucide-vue-next'
import BadgeUI from '@/components/ui/BadgeUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import IconGroupUI from '@/components/ui/IconGroupUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import RowUI from '@/components/ui/RowUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import ValueFieldUI from '@/components/ui/ValueFieldUI.vue'
import { useElement } from '@/composables/useElement'
import { useComponents } from '@/composables/useComponents'
import { useProject } from '@/composables/useProject'
import { useInteraction } from '@/composables/useInteraction'
import { useAnimation } from '@/composables/useAnimation'
import { useMotion } from '@/composables/useMotion'
import { useSettings } from '@/composables/useSettings'
import { useEffectDetail } from '@/composables/useEffectDetail'
import { SCRUB_DEFAULTS } from '@/lib/motion'
import type { AnimationBinding, ElementNode, InteractionBinding } from '@/types/editor'

const props = defineProps<
  | { kind: 'interaction'; binding: InteractionBinding; owner: ElementNode; open: boolean }
  | { kind: 'animation'; binding: AnimationBinding; owner: ElementNode; open: boolean }
>()
const emit = defineEmits<{ toggle: [] }>()

const { getElement, highlightElement } = useElement()
const { findMasterNode } = useComponents()
const { breakpoints } = useProject()
const interactions = useInteraction()
const animations = useAnimation()
const motion = useMotion()
const { settings } = useSettings()
const { openDetail } = useEffectDetail()
const { pickingFor } = interactions

const isAnimation = computed(() => props.kind === 'animation')
const anim = computed(() => (props.kind === 'animation' ? props.binding : null))
const inter = computed(() => (props.kind === 'interaction' ? props.binding : null))

const effectId = computed(() =>
  props.kind === 'animation' ? props.binding.animationId : props.binding.interactionId,
)
const effect = computed(() =>
  props.kind === 'animation'
    ? animations.animationFor(props.binding.animationId)
    : interactions.animationFor(props.binding.interactionId),
)
const effectName = computed(() => effect.value?.name ?? 'Missing effect')
const usedOn = computed(() =>
  props.kind === 'animation'
    ? animations.usageCount(props.binding.animationId)
    : interactions.usageCount(props.binding.interactionId),
)
const error = computed(() => {
  const a = props.kind === 'animation' ? animations.animationFor(props.binding.animationId) : null
  return a ? animations.animationError(a) : null
})

// --- trigger ---

const INTERACTION_TRIGGERS = [
  { label: 'Hover', value: 'hover', icon: MousePointer2 },
  { label: 'Click', value: 'click', icon: MousePointerClick },
  { label: 'Scroll into view', value: 'appear', icon: Eye },
  { label: 'Scrolled past', value: 'scrolled', icon: MoveVertical },
  { label: 'Input change', value: 'change', icon: ToggleLeft },
]
const ANIMATION_TRIGGERS = [
  { label: 'Page load', value: 'load', icon: Zap },
  { label: 'Scroll into view', value: 'appear', icon: Eye },
  { label: 'Scroll progress', value: 'scrub', icon: MoveVertical },
  { label: 'Hover', value: 'hover', icon: MousePointer2 },
  { label: 'Click', value: 'click', icon: MousePointerClick },
]
const triggers = computed(() => (isAnimation.value ? ANIMATION_TRIGGERS : INTERACTION_TRIGGERS))

/** the one word the collapsed row leads with */
const TRIGGER_WORD: Record<string, string> = {
  hover: 'Hover', click: 'Click', appear: 'Appear', scrolled: 'Scrolled', change: 'Change',
  load: 'Load', scrub: 'Scroll',
}
const triggerWord = computed(() => TRIGGER_WORD[props.binding.trigger] ?? props.binding.trigger)
const triggerIcon = computed(
  () => triggers.value.find((t) => t.value === props.binding.trigger)?.icon ?? Zap,
)

function setTrigger(v: string | undefined) {
  if (!v) return
  ;(props.binding as { trigger: string }).trigger = v
}

// --- interaction-only rows ---

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
const isDiscrete = computed(() => inter.value?.trigger === 'click')

function isDismissOn(mode: 'outside' | 'escape'): boolean {
  return !!inter.value?.closeOn?.includes(mode)
}
function toggleDismiss(mode: 'outside' | 'escape') {
  const b = inter.value
  if (!b) return
  const next = new Set(b.closeOn ?? [])
  if (next.has(mode)) next.delete(mode)
  else next.add(mode)
  // omitted when empty so untouched bindings stay byte-identical for merge
  b.closeOn = next.size ? [...next] : undefined
}

// --- animation-only rows ---

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

function preview() {
  const a = anim.value
  const animation = a && animations.animationFor(a.animationId)
  if (!a || !animation) return
  motion.preview(animation, a.targetId ?? props.owner.id)
}

// --- target ---

const hasTarget = computed(
  () => !!props.binding.targetId && props.binding.targetId !== props.owner.id,
)
const targetName = computed(() => {
  if (!hasTarget.value) return 'this element'
  const node = getElement(props.binding.targetId!) ?? findMasterNode(props.binding.targetId!)
  return node ? (node.ref ? `#${node.ref}` : node.type) : 'Missing'
})
const picking = computed(() => pickingFor.value === props.binding)
function togglePicking() {
  pickingFor.value = picking.value ? null : props.binding
}
function previewTarget() {
  if (hasTarget.value) highlightElement(props.binding.targetId!)
}
function clearPreview() {
  highlightElement(null)
}
function resetTarget() {
  props.binding.targetId = null
  clearPreview()
}

// --- breakpoints (all active by default) ---

function isBreakpointOn(id: string): boolean {
  return !props.binding.breakpoints || props.binding.breakpoints.includes(id)
}
function toggleBreakpoint(id: string) {
  const all = breakpoints.value.map((b) => b.id)
  const on = new Set(props.binding.breakpoints ?? all)
  if (on.has(id)) {
    // keep at least one — an effect on no breakpoint can never run
    if (on.size <= 1) return
    on.delete(id)
  } else {
    on.add(id)
  }
  // canonicalize: all on → undefined (stays byte-identical); else project order
  props.binding.breakpoints = all.every((b) => on.has(b)) ? undefined : all.filter((b) => on.has(b))
}

// --- the long tail ---
// folded by default, open when any of it is set — a value that applies must
// never hide behind a closed disclosure
const hasMore = computed(() => {
  if (props.binding.breakpoints) return true
  if (inter.value) return !!(inter.value.once || inter.value.group || inter.value.closeOn?.length)
  return anim.value?.appearAt !== undefined
})
const more = ref(hasMore.value)
const showMoreToggle = computed(
  () => breakpoints.value.length > 1 || isDiscrete.value || anim.value?.trigger === 'appear',
)

// --- remove ---

function remove() {
  if (props.kind === 'animation') {
    motion.stop(props.binding)
    animations.removeBinding(props.owner, props.binding.id)
  } else {
    interactions.removeBinding(props.owner, props.binding.id)
  }
  clearPreview()
}
</script>

<template>
  <div
    data-binding-row
    class="rounded-xl border transition-colors"
    :class="open ? 'border-accent bg-accent/5' : 'border-input hover:border-accent'"
  >
    <!-- the sentence: trigger · effect · (target) -->
    <button
      type="button"
      class="flex h-9 w-full min-w-0 items-center gap-2 px-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-xl"
      @click="emit('toggle')"
    >
      <component :is="triggerIcon" class="size-3.5 shrink-0 text-muted-foreground" />
      <span class="shrink-0 text-xs text-muted-foreground">{{ triggerWord }}</span>
      <span class="min-w-0 flex-1 truncate text-xs font-medium" :class="!effect && 'text-danger'">
        {{ effectName }}
      </span>
      <BadgeUI class="shrink-0">{{ isAnimation ? 'Animation' : 'Classes' }}</BadgeUI>
      <span
        v-if="hasTarget && !open"
        class="max-w-20 shrink-0 truncate text-[10px] text-muted-foreground"
        @mouseenter="previewTarget"
        @mouseleave="clearPreview"
      >
        → {{ targetName }}
      </span>
      <ChevronRight
        class="size-3 shrink-0 text-muted-foreground transition-transform"
        :class="open && 'rotate-90'"
      />
    </button>

    <div v-if="open && effect" class="flex flex-col gap-1 border-t border-input/60 pb-2 pt-1.5">
      <RowUI label="Effect">
        <ButtonUI
          variant="outline" size="xs" :icon="Pencil"
          class="min-w-0 flex-1 !justify-start"
          :aria-label="isAnimation ? 'Edit animation' : 'Edit interaction'"
          @click="openDetail(kind, effectId)"
        >
          <span class="truncate">Edit</span>
          <span v-if="usedOn > 1" class="ml-auto text-muted-foreground">on {{ usedOn }}</span>
        </ButtonUI>
        <ButtonUI
          v-if="isAnimation"
          variant="icon" size="sm" :icon="Play" tooltip="Play on the canvas"
          class="w-6 shrink-0 text-muted-foreground"
          @click="preview"
        />
      </RowUI>

      <RowUI label="When">
        <IconGroupUI
          :options="triggers"
          :model-value="binding.trigger"
          @update:model-value="setTrigger"
        />
      </RowUI>

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

      <!-- what the trigger needs to know, by kind -->
      <template v-if="inter">
        <RowUI v-if="isDiscrete" label="Action">
          <SelectUI
            :model-value="inter.action ?? 'toggle'"
            :options="ACTIONS"
            @update:model-value="(v) => (inter!.action = v === 'toggle' ? undefined : (v as 'on' | 'off'))"
          />
        </RowUI>
        <RowUI v-if="inter.trigger === 'scrolled'" label="After">
          <InputUI
            type="number"
            :model-value="String(inter.scrollAt ?? 50)"
            @update:model-value="(v) => (inter!.scrollAt = Number(v) || undefined)"
          />
          <span class="w-6 shrink-0 text-right text-xs text-muted-foreground">px</span>
        </RowUI>
      </template>

      <template v-if="anim">
        <RowUI v-if="anim.trigger === 'appear'" label="Replay">
          <SelectUI
            :options="APPEAR_MODES"
            :model-value="anim.appearMode ?? 'inherit'"
            @update:model-value="
              (v) => (anim!.appearMode = v === 'inherit' ? undefined : (v as AnimationBinding['appearMode']))
            "
          />
        </RowUI>
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

      <!-- the long tail -->
      <button
        v-if="showMoreToggle"
        type="button"
        class="flex h-7 items-center gap-1 px-2.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
        @click="more = !more"
      >
        <ChevronRight class="size-3 transition-transform" :class="more && 'rotate-90'" />
        More
        <span v-if="hasMore && !more" class="size-1.5 rounded-full bg-accent-foreground/60" />
      </button>

      <template v-if="more && showMoreToggle">
        <template v-if="inter && isDiscrete">
          <!-- Dismiss-on and Exclusive group are stored per binding, but the
               runtime folds them per EFFECT and target (useInteraction
               effectOptions): two bindings of this interaction on the same
               target resolve to ONE set of options. -->
          <RowUI label="Dismiss on">
            <div class="flex flex-1 justify-end gap-1">
              <ButtonUI
                v-for="mode in (['outside', 'escape'] as const)"
                :key="mode"
                :variant="isDismissOn(mode) ? 'outline' : 'ghost'"
                size="xs"
                :class="isDismissOn(mode) ? '' : 'text-muted-foreground opacity-60'"
                @click="toggleDismiss(mode)"
              >
                {{ mode === 'outside' ? 'Outside click' : 'Escape' }}
              </ButtonUI>
            </div>
          </RowUI>
          <RowUI label="Group">
            <InputUI
              placeholder="e.g. faq — one open at a time"
              :model-value="inter.group ?? ''"
              @update:model-value="(v) => (inter!.group = v.trim() || undefined)"
            />
          </RowUI>
          <RowUI label="Remember">
            <SelectUI
              :model-value="inter.once ?? ''"
              :options="ONCE_OPTIONS"
              @update:model-value="(v) => (inter!.once = v ? (v as 'session' | 'local') : undefined)"
            />
          </RowUI>
          <p v-if="inter.once" class="px-2.5 text-[10px] text-muted-foreground">
            Remembered on the published site only — the editor always shows the element.
          </p>
        </template>

        <RowUI v-if="anim && anim.trigger === 'appear'" label="Starts at">
          <ValueFieldUI
            :model-value="String(anim.appearAt ?? 0)"
            @commit="(t) => (anim!.appearAt = parseFloat(t) > 0 ? Math.min(1, parseFloat(t)) : undefined)"
          />
          <span class="text-[10px] text-muted-foreground">× viewport</span>
        </RowUI>

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
      </template>

      <p v-if="error" class="px-2.5 text-[10px] text-danger">{{ error }}</p>

      <div class="flex justify-end px-2.5 pt-1">
        <ButtonUI variant="ghost" size="xs" :icon="X" class="text-muted-foreground hover:text-danger" @click="remove">
          Remove from element
        </ButtonUI>
      </div>
    </div>

    <!-- the effect was deleted from the library while bound here -->
    <div v-else-if="open" class="flex items-center justify-between border-t border-input/60 px-2.5 py-2">
      <p class="text-[10px] text-muted-foreground">This effect no longer exists.</p>
      <ButtonUI variant="ghost" size="xs" :icon="X" class="text-muted-foreground" @click="remove">Remove</ButtonUI>
    </div>
  </div>
</template>
