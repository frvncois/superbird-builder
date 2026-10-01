<script setup lang="ts">
// The site-wide half of motion: settings that belong to the project rather
// than to one element. Everything here applies to the Preview surface and the
// published site — never the Build canvas, which pans instead of scrolling.
// Body of the Settings → Interactions tab — the one place these are edited.
import { computed } from 'vue'
import { useSettings } from '@/composables/useSettings'
import { useAnimation } from '@/composables/useAnimation'
import {
  EASING_NAMES,
  TRANSITION_PRESET_OPTIONS,
  TRANSITION_DEFAULTS,
  SCROLL_LERP_DEFAULT,
  SCROLL_LERP_MIN,
  SCROLL_LERP_MAX,
} from '@/lib/motion'
import SettingsGroup from './SettingsGroup.vue'
import RowUI from '@/components/ui/RowUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import SliderUI from '@/components/ui/SliderUI.vue'
import ToggleUI from '@/components/ui/ToggleUI.vue'

const { motion, transitions, smoothScroll } = useSettings()
const { library } = useAnimation()

const APPEAR_MODE_OPTIONS = [
  { label: 'Once', value: 'once' },
  { label: 'Every time', value: 'replay' },
  { label: 'Reverse on exit', value: 'reverse' },
]

const appearMode = computed({
  get: () => motion.value.appearMode ?? 'once',
  set: (v: string) => (motion.value.appearMode = v as 'once' | 'replay' | 'reverse'),
})

// --- page transitions ---

const PRESET_OPTIONS = [...TRANSITION_PRESET_OPTIONS, { label: 'Custom…', value: 'custom' }]
const EASING_OPTIONS = EASING_NAMES.map((e) => ({ label: e, value: e }))

const preset = computed({
  get: () => transitions.value.preset ?? TRANSITION_DEFAULTS.preset,
  set: (v: string) => (transitions.value.preset = v),
})
const isCustom = computed(() => preset.value === 'custom')

const duration = computed({
  get: () => transitions.value.duration ?? TRANSITION_DEFAULTS.duration,
  set: (v: number) => (transitions.value.duration = v),
})
const easing = computed({
  get: () => transitions.value.easing ?? TRANSITION_DEFAULTS.easing,
  set: (v: string) => (transitions.value.easing = v),
})
const exitDuration = computed(() => Math.round(duration.value * TRANSITION_DEFAULTS.exitRatio))

/** '' is the "none" choice — one side of the pair may be left empty */
const animationOptions = computed(() => [
  { label: 'None', value: '' },
  ...library.value.map((a) => ({ label: a.name, value: a.id })),
])
const exitAnimationId = computed({
  get: () => transitions.value.exitAnimationId ?? '',
  set: (v: string) => (transitions.value.exitAnimationId = v || undefined),
})
const enterAnimationId = computed({
  get: () => transitions.value.enterAnimationId ?? '',
  set: (v: string) => (transitions.value.enterAnimationId = v || undefined),
})

// --- smooth scrolling ---

// the slider reads as "intensity" (higher = snappier); lerp is the underlying
// per-frame catch-up fraction, so the two run in the same direction
const SCROLL_STEP = 0.01
const lerp = computed({
  get: () => smoothScroll.value.lerp ?? SCROLL_LERP_DEFAULT,
  set: (v: number) => (smoothScroll.value.lerp = v),
})
</script>

<template>
  <SettingsGroup
    title="Appear animations"
    description="What a scroll-into-view animation does when the element leaves and re-enters. Any element can override this in its Interactions panel."
  >
    <RowUI label="Default">
      <SelectUI v-model="appearMode" :options="APPEAR_MODE_OPTIONS" />
    </RowUI>
    <p class="text-[10px] text-muted-foreground">
      <strong class="font-medium text-foreground">Once</strong> plays on first entry and never
      again. <strong class="font-medium text-foreground">Every time</strong> replays on every
      entry. <strong class="font-medium text-foreground">Reverse on exit</strong> rewinds the
      animation as the element scrolls back out.
    </p>
  </SettingsGroup>

  <SettingsGroup
    title="Page transitions"
    description="An animation plays over the whole page when a visitor follows a link: out on the page they leave, in on the page they arrive at."
  >
    <RowUI label="Enabled">
      <ToggleUI v-model="transitions.enabled" />
    </RowUI>
    <template v-if="transitions.enabled">
      <RowUI label="Style">
        <SelectUI v-model="preset" :options="PRESET_OPTIONS" />
      </RowUI>
      <template v-if="isCustom">
        <RowUI label="Leaving">
          <SelectUI v-model="exitAnimationId" :options="animationOptions" />
        </RowUI>
        <RowUI label="Arriving">
          <SelectUI v-model="enterAnimationId" :options="animationOptions" />
        </RowUI>
        <p class="text-[10px] text-muted-foreground">
          Animations from your library, played on the page body. Build them in the Interactions
          panel first.
        </p>
      </template>
      <template v-else>
        <RowUI label="Duration">
          <SliderUI v-model="duration" :min="100" :max="1200" :step="50" />
          <span class="w-12 shrink-0 text-right font-mono text-xs text-muted-foreground">
            {{ duration }}ms
          </span>
        </RowUI>
        <RowUI label="Easing">
          <SelectUI v-model="easing" :options="EASING_OPTIONS" />
        </RowUI>
        <p class="text-[10px] text-muted-foreground">
          Leaving runs at {{ exitDuration }}ms — quicker than arriving, so a click feels
          responsive. Anything but Fade moves the page body, which briefly re-anchors fixed
          headers for the length of the transition.
        </p>
      </template>
    </template>
  </SettingsGroup>

  <SettingsGroup
    title="Smooth scrolling"
    description="The page glides toward where you scrolled instead of jumping there — the weighted feel used on showcase sites."
  >
    <RowUI label="Enabled">
      <ToggleUI v-model="smoothScroll.enabled" />
    </RowUI>
    <RowUI v-if="smoothScroll.enabled" label="Intensity">
      <SliderUI v-model="lerp" :min="SCROLL_LERP_MIN" :max="SCROLL_LERP_MAX" :step="SCROLL_STEP" />
      <span class="w-12 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {{ lerp.toFixed(2) }}
      </span>
    </RowUI>
    <p class="text-[10px] text-muted-foreground">
      Lower is heavier and slower to settle. Smooth scrolling takes the wheel away from the
      browser, so it can feel wrong to visitors who rely on a precise scroll position, and it is
      switched off automatically on touch devices and for anyone whose system asks for reduced
      motion. Leave it off unless the effect is worth that trade.
    </p>
  </SettingsGroup>
</template>
