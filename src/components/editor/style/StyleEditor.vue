<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { usePanel } from '@/composables/usePanel'
import { RotateCcw, X } from 'lucide-vue-next'
import { STYLE_SECTIONS } from '@/lib/styleCatalog'
import { STYLE_ICONS } from '@/lib/styleCatalogIcons'
import {
  matchClass,
  sliderClasses,
  sliderLabels,
  sliderPrefix,
  sliderAllowNegative,
  isPropertyRelevant,
} from '@/lib/styles'
import { classToText, textToClass, nearestStepIndex, sizeClassToText, namedTextToClass } from '@/lib/valueClass'
import { isPaletteColor } from '@/lib/colors'
import type { StyleProperty, Control, StyleSection, RelevanceContext } from '@/lib/styles'
import { useElement } from '@/composables/useElement'
import { useComponents } from '@/composables/useComponents'
import { usePage } from '@/composables/usePage'
import { useProject } from '@/composables/useProject'
import { useClassField } from '@/composables/useClassField'
import { breakpointView, applyBreakpointEdit, removeInheritedToken } from '@/lib/responsive'
import { findParent } from '@/lib/tree'
import GroupAccordion from '@/components/accordion/GroupAccordion.vue'
import TitleAccordion from '@/components/accordion/TitleAccordion.vue'
import ContentAccordion from '@/components/accordion/ContentAccordion.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import RowUI from '@/components/ui/RowUI.vue'
import ClassInput from '@/components/editor/style/ClassInput.vue'
import ValueFieldUI from '@/components/ui/ValueFieldUI.vue'
import MediaPickerControl from '@/components/editor/content/MediaPickerControl.vue'
import SpacingBoxControl from '@/components/editor/style/SpacingBoxControl.vue'
import BorderStyleControl from '@/components/editor/style/BorderStyleControl.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import SliderUI from '@/components/ui/SliderUI.vue'
import IconGroupUI from '@/components/ui/IconGroupUI.vue'
import ColorPickerUI from '@/components/ui/ColorPickerUI.vue'
import SpacingControl from '@/components/editor/style/SpacingControl.vue'
import AlignGridControl from '@/components/editor/style/AlignGridControl.vue'
import GapControl from '@/components/editor/style/GapControl.vue'
import InsetControl from '@/components/editor/style/InsetControl.vue'
import SizeControl from '@/components/editor/style/SizeControl.vue'
import { borderWidthScheme } from '@/lib/tieredBox'

const { selectedElement } = useElement()
const { masterFor } = useComponents()
const { activePage } = usePage()
const { activeBreakpoint, baseBreakpoint, breakpoints } = useProject()

// the width of the breakpoint being edited, or null when it's the base (widest)
const activeWidth = computed(() => {
  const a = activeBreakpoint.value
  if (!a || a.id === baseBreakpoint.value?.id) return null
  return a.width
})

// the widest breakpoint's width — the base view resolves the cascade here
const baseWidth = computed(() => baseBreakpoint.value?.width ?? 0)

// the smallest breakpoint wider than the one being edited — the threshold a
// removed class is scoped above so it survives on larger breakpoints only
const nextLargerWidth = computed(() => {
  const w = activeWidth.value
  if (w === null) return null
  const wider = breakpoints.value.map((b) => b.width).filter((x) => x > w)
  return wider.length ? Math.min(...wider) : null
})

// inside a component instance, style edits land on the shared master
const styleTarget = computed(() =>
  selectedElement.value
    ? (masterFor(selectedElement.value.id)?.master ?? selectedElement.value)
    : null,
)

// the element's class string is the single source of truth. Controls edit one
// breakpoint at a time: they see/write the "effective view" for the active
// breakpoint (base values + this breakpoint's overrides, prefix stripped) and
// the wrapper folds edits back into the stored string as max-width variants.
const { tokens: rawTokens, setTokens: setRawTokens } = useClassField({
  get: () => styleTarget.value?.classes ?? '',
  set: (value) => {
    if (styleTarget.value) styleTarget.value.classes = value
  },
})
// cascaded view for the active breakpoint (Mobile inherits Tablet, not just base)
const view = computed(() => breakpointView(rawTokens.value, activeWidth.value, baseWidth.value))
const tokens = computed(() => view.value.tokens)
function setTokens(next: string[]) {
  setRawTokens(applyBreakpointEdit(rawTokens.value, activeWidth.value, next, baseWidth.value))
}
function removeToken(cls: string) {
  // removing an inherited value on a smaller breakpoint scopes it so it drops
  // here and below while larger breakpoints keep it (base-inherited case only)
  if (activeWidth.value !== null && inheritedTokens.value.includes(cls)) {
    const larger = nextLargerWidth.value
    if (larger !== null) {
      const next = removeInheritedToken(rawTokens.value, cls, larger)
      if (next) setRawTokens(next)
    }
    return
  }
  setTokens(tokens.value.filter((t) => t !== cls))
}

// on a smaller breakpoint, the tokens inherited from a larger breakpoint (not
// this breakpoint's own override) — shown dimmed in the class panel
const inheritedTokens = computed(() => view.value.inherited)

// inherited tokens that come straight from the base (unprefixed) token, so they
// can be removed (scoped away) here — others (overridden by a larger non-base
// breakpoint) stay non-removable for now
const removableInherited = computed(() =>
  activeWidth.value === null ? [] : inheritedTokens.value.filter((t) => rawTokens.value.includes(t)),
)

function classFor(prop: StyleProperty): string | undefined {
  return matchClass(prop, tokens.value)
}

function set(prop: StyleProperty, cls: string) {
  const next = [...tokens.value]
  const current = classFor(prop)
  const at = current ? next.indexOf(current) : -1
  if (at === -1) next.push(cls)
  else next[at] = cls
  setTokens(next)
}

function isDisplayDependent(cls: string): boolean {
  // props (gap, align, justify…) that only make sense once a flex/grid display is set
  return allProps.some((p) => p.needsDisplay && !!matchClass(p, [cls])) || cls.startsWith('gap-')
}

function remove(prop: StyleProperty) {
  const current = classFor(prop)
  if (!current) return
  let next = tokens.value.filter((cls) => cls !== current)
  // removing Display also clears the classes that depend on it, so the
  // auto-display watch can't snap flex back and the user starts clean
  if (prop.id === 'display') next = next.filter((cls) => !isDisplayDependent(cls))
  setTokens(next)
}

// baseline = the element's classes captured when it was selected, so the revert
// button can hide once a property is back to what it originally was
const baseline = ref<string[]>([])
const backgroundBaseline = ref<string>('')
watch(
  [() => styleTarget.value?.id, activeWidth],
  () => {
    baseline.value = breakpointView(
      (styleTarget.value?.classes ?? '').split(/\s+/).filter(Boolean),
      activeWidth.value,
      baseWidth.value,
    ).tokens
    backgroundBaseline.value = styleTarget.value?.background ?? ''
  },
  { immediate: true },
)

function baselineClassFor(prop: StyleProperty): string | undefined {
  return matchClass(prop, baseline.value)
}

function isDirty(prop: StyleProperty): boolean {
  return (classFor(prop) ?? '') !== (baselineClassFor(prop) ?? '')
}

function revert(prop: StyleProperty) {
  const base = baselineClassFor(prop)
  if (base) set(prop, base)
  else remove(prop)
}

// --- accordion open state (all closed by default) ---

const openSections = ref<Record<string, boolean>>(
  Object.fromEntries(STYLE_SECTIONS.map((s) => [s.id, false])),
)

const allProps = STYLE_SECTIONS.flatMap((s) => s.properties)
const propById = (id: string) => allProps.find((p) => p.id === id)!
const displayProp = propById('display')
const positionProp = propById('position')
const transitionProp = propById('transition')
const directionProp = propById('direction')

// flex-col flips which visual axis of the 9-dot align grid maps to justify/items
const isVerticalFlex = computed(() => {
  const d = matchClass(directionProp, tokens.value)
  return d === 'flex-col' || d === 'flex-col-reverse'
})

// flex-dependent classes (align, justify, gap…) imply a display — add one so
// the Display row always reflects reality
watch(
  tokens,
  () => {
    // trigger only on this breakpoint's OWN flex/grid-child classes — an
    // inherited one (e.g. gap kept from base) must not resurrect a display the
    // user just removed on this breakpoint
    const own = tokens.value.filter((t) => !inheritedTokens.value.includes(t))
    const needsDisplay = allProps.some((p) => p.needsDisplay && matchClass(p, own))
    if (needsDisplay && !matchClass(displayProp, tokens.value)) {
      setTokens(['flex', ...tokens.value])
    }
  },
  { immediate: true },
)

// --- relevance: only surface properties that apply to this element ---

// the parent's display drives whether flex/grid *child* props are worth showing
const parentDisplay = computed(() => {
  const id = selectedElement.value?.id
  if (!id) return undefined
  const parent = findParent(activePage.value.elements, id)
  if (!parent) return undefined
  // a component-mapped parent carries its style on the shared master
  const parentClasses = (masterFor(parent.id)?.master ?? parent).classes ?? ''
  return matchClass(displayProp, parentClasses.split(/\s+/).filter(Boolean))
})

const relevanceContext = computed<RelevanceContext>(() => {
  const transition = matchClass(transitionProp, tokens.value)
  return {
    display: matchClass(displayProp, tokens.value),
    position: matchClass(positionProp, tokens.value),
    parentDisplay: parentDisplay.value,
    hasTransition: !!transition && transition !== 'transition-none',
    isMedia: ['image', 'video'].includes(selectedElement.value?.type ?? ''),
    hasBackground: !!styleTarget.value?.background,
  }
})

// background media (node.background) — edited on the style target like classes
const backgroundMedia = computed<string>({
  get: () => styleTarget.value?.background ?? '',
  set: (v) => {
    if (styleTarget.value) styleTarget.value.background = v || undefined
  },
})

function isVisible(prop: StyleProperty): boolean {
  const relevant = isPropertyRelevant(prop, relevanceContext.value)
  // display/parent-display–gated props (gap, align, grid-cols…) are meaningless
  // when the display no longer matches — hide them even if a stale class lingers,
  // rather than showing e.g. Gap for an inline/hidden element
  const r = prop.relevance
  if (r && (r.when === 'display' || r.when === 'parentDisplay') && !relevant) {
    return false
  }
  // otherwise an already-set property is always shown so it can be seen/removed
  return !!classFor(prop) || relevant
}

// rows folded into a composite control: the 9-dot AlignGridControl
// ('align' / 'self' render it) and the cross InsetControl ('top' renders it)
const GRID_COVERED = new Set([
  'justify',
  'align-content',
  'justify-self',
  'right',
  'bottom',
  'left',
])

function visibleProps(section: StyleSection): StyleProperty[] {
  return section.properties.filter((p) => !GRID_COVERED.has(p.id) && isVisible(p))
}

const ALWAYS_SHOWN = new Set(['spacing', 'size'])
const visibleSections = computed(() =>
  // spacing (padding/margin) and size apply to everything, so they're always shown
  STYLE_SECTIONS.filter((s) => ALWAYS_SHOWN.has(s.id) || visibleProps(s).length > 0),
)

// --- control value mapping (stored value is always the tailwind class) ---

function control<K extends Control['kind']>(prop: StyleProperty, kind: K) {
  return prop.control as Extract<Control, { kind: K }>
}

function selectOptions(prop: StyleProperty) {
  return control(prop, 'select').options.map((o) => ({ label: o.label, value: o.class }))
}

function sliderIndex(prop: StyleProperty): number {
  const slider = control(prop, 'slider')
  const classes = sliderClasses(slider)
  const current = classFor(prop)
  if (current) {
    const index = classes.indexOf(current)
    if (index !== -1) return index
    // custom / off-scale value → sit the thumb at the nearest scale stop
    const prefix = sliderPrefix(slider)
    if (prefix) {
      const near = nearestStepIndex(
        sliderLabels(slider),
        classToText(prefix, current, { allowNegative: sliderAllowNegative(slider) }),
      )
      if (near !== -1) return near
    }
  }
  // resting position with nothing set: centre on the '0' stop (signed
  // sliders) or fall back to the first stop
  const zero = sliderLabels(slider).indexOf('0')
  return zero === -1 ? 0 : zero
}

// --- editable slider value ---

function sliderCustomPrefix(prop: StyleProperty): string | null {
  return sliderPrefix(control(prop, 'slider'))
}

function sliderValueText(prop: StyleProperty): string {
  const slider = control(prop, 'slider')
  const prefix = sliderPrefix(slider)
  if (!prefix) return ''
  // named-scale sliders read keyword/arbitrary as the raw suffix (xl, 18px, bold)
  if (slider.custom) return sizeClassToText(prefix, classFor(prop))
  return classToText(prefix, classFor(prop), { allowNegative: sliderAllowNegative(slider) })
}

// named-scale sliders validate keyword + in-format arbitrary; others use the units guard
function sliderValidate(prop: StyleProperty): ((text: string) => boolean) | undefined {
  const slider = control(prop, 'slider')
  if (!slider.custom) return undefined
  const { prefix, format } = slider.custom
  const known = sliderClasses(slider)
  return (text: string) => namedTextToClass(prefix, format, known, text) !== false
}

function applySliderText(prop: StyleProperty, text: string) {
  const slider = control(prop, 'slider')
  const prefix = sliderPrefix(slider)
  if (!prefix) return
  const cls = slider.custom
    ? namedTextToClass(prefix, slider.custom.format, sliderClasses(slider), text)
    : textToClass(prefix, text, { allowNegative: sliderAllowNegative(slider) })
  if (cls === false) return
  const current = classFor(prop)
  const next = tokens.value.filter((c) => c !== current)
  if (cls) next.push(cls)
  setTokens(next)
}

function setSlider(prop: StyleProperty, index: number) {
  const classes = sliderClasses(control(prop, 'slider'))
  set(prop, classes[index] ?? classes[0]!)
}

function sliderMax(prop: StyleProperty): number {
  return sliderClasses(control(prop, 'slider')).length - 1
}

function sliderReadout(prop: StyleProperty): string {
  return sliderLabels(control(prop, 'slider'))[sliderIndex(prop)] ?? ''
}

function colorValue(prop: StyleProperty): string {
  const cls = classFor(prop)
  if (!cls) return 'slate-500'
  const value = cls.slice(control(prop, 'color').prefix.length + 1)
  return value.match(/^\[(#[0-9a-fA-F]+)\]$/)?.[1] ?? value
}

function setColor(prop: StyleProperty, value: string) {
  const { prefix } = control(prop, 'color')
  set(prop, value.startsWith('#') ? `${prefix}-[${value}]` : `${prefix}-${value}`)
}

// the editable color value text, '' when unset (vs colorValue's swatch default)
function colorText(prop: StyleProperty): string {
  const cls = classFor(prop)
  if (!cls) return ''
  const value = cls.slice(control(prop, 'color').prefix.length + 1)
  return value.match(/^\[(#[0-9a-fA-F]+)\]$/)?.[1] ?? value
}

const COLOR_KEYWORDS = ['white', 'black', 'transparent', 'current', 'inherit']
function isColorValue(text: string): boolean {
  const t = text.trim()
  if (t === '') return true
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(t)) return true
  return COLOR_KEYWORDS.includes(t) || isPaletteColor(t)
}

function applyColorText(prop: StyleProperty, text: string) {
  if (text === '') remove(prop)
  else setColor(prop, text)
}

function inputValue(prop: StyleProperty): string {
  const { prefix } = control(prop, 'input')
  const value = classFor(prop) ?? ''
  return value.startsWith(`${prefix}-`) ? value.slice(prefix.length + 1) : value
}

function setInput(prop: StyleProperty, raw: string) {
  const { prefix } = control(prop, 'input')
  set(prop, `${prefix}-${raw.trim() || 'auto'}`)
}

// +S in the code editor lands the user straight in the class input
const { pendingFocus } = usePanel()
const classInput = ref<InstanceType<typeof ClassInput>>()

function consumeFocus() {
  if (pendingFocus.value !== 'style') return
  pendingFocus.value = null
  nextTick(() => classInput.value?.focus())
}
onMounted(consumeFocus)
watch(pendingFocus, consumeFocus)
</script>

<template>
  <div class="flex flex-col">
    <div class="flex flex-col gap-1.5 p-3 border-b border-input">
      <p class="text-xs font-medium text-muted-foreground">Classes</p>
      <ClassInput
        ref="classInput"
        :tokens="tokens"
        :inherited="inheritedTokens"
        :removable-inherited="removableInherited"
        @commit="setTokens"
        @remove="removeToken"
      />
    </div>

    <GroupAccordion
      v-for="section in visibleSections"
      :key="section.id"
      v-model:open="openSections[section.id]"
    >
      <TitleAccordion>
        {{ section.label }}
      </TitleAccordion>

      <ContentAccordion>
        <SpacingControl
          v-if="section.id === 'spacing'"
          :key="styleTarget?.id"
          :model-value="tokens"
          :baseline="baseline"
          @update:model-value="setTokens"
        />
        <SizeControl
          v-else-if="section.id === 'size'"
          :key="`size-${styleTarget?.id}`"
          :model-value="tokens"
          @update:model-value="setTokens"
        />
        <template v-else>
        <!-- background media picker (node.background) — image or video -->
        <div v-if="section.id === 'background'" class="relative mb-1.5 flex flex-col gap-1.5 px-2.5 pl-8">
          <div class="absolute left-1 top-0">
            <ButtonUI
              v-if="backgroundMedia !== backgroundBaseline"
              variant="ghost"
              size="xs"
              :icon="RotateCcw"
              tooltip="Revert"
              class="aspect-square shrink-0 text-muted-foreground"
              @click="backgroundMedia = backgroundBaseline"
            />
          </div>
          <div class="flex items-center justify-between">
            <span class="text-xs leading-6 text-foreground">Media</span>
            <ButtonUI
              v-if="backgroundMedia"
              variant="ghost"
              size="xs"
              :icon="X"
              tooltip="Remove background"
              class="aspect-square text-muted-foreground"
              @click="backgroundMedia = ''"
            />
          </div>
          <MediaPickerControl
            :key="`bg-${styleTarget?.id}`"
            v-model="backgroundMedia"
            kind="image"
            :kinds="['image', 'video']"
          />
        </div>
        <SpacingBoxControl
          v-if="section.id === 'border'"
          :key="`bw-${styleTarget?.id}`"
          label="Width"
          base="border"
          :scheme="borderWidthScheme"
          :model-value="tokens"
          :baseline="baseline"
          @update:model-value="setTokens"
        />
        <template v-for="prop in visibleProps(section)" :key="prop.id">
        <AlignGridControl
          v-if="prop.id === 'align'"
          :key="`align-${styleTarget?.id}`"
          :model-value="tokens"
          :baseline="baseline"
          :vertical="isVerticalFlex"
          @update:model-value="setTokens"
        />
        <AlignGridControl
          v-else-if="prop.id === 'self'"
          :key="`self-${styleTarget?.id}`"
          mode="self"
          :model-value="tokens"
          :baseline="baseline"
          @update:model-value="setTokens"
        />
        <GapControl
          v-else-if="prop.id === 'gap'"
          :key="`gap-${styleTarget?.id}`"
          :model-value="tokens"
          :baseline="baseline"
          @update:model-value="setTokens"
        />
        <InsetControl
          v-else-if="prop.id === 'top'"
          :key="`inset-${styleTarget?.id}`"
          :model-value="tokens"
          @update:model-value="setTokens"
        />
        <RowUI v-else :label="prop.label">
          <BorderStyleControl
              v-if="prop.id === 'border-style'"
              :model-value="tokens"
              @update:model-value="setTokens"
            />
            <SelectUI
              v-else-if="prop.control.kind === 'select'"
              :options="selectOptions(prop)"
              placeholder="—"
              :model-value="classFor(prop) ?? ''"
              @update:model-value="(v) => v && set(prop, v)"
            />
            <template v-else-if="prop.control.kind === 'slider'">
              <SliderUI
                :min="0"
                :max="sliderMax(prop)"
                :model-value="sliderIndex(prop)"
                @update:model-value="(v) => setSlider(prop, v)"
              />
              <ValueFieldUI
                v-if="sliderCustomPrefix(prop)"
                :model-value="sliderValueText(prop)"
                :allow-negative="sliderAllowNegative(control(prop, 'slider'))"
                :validate="sliderValidate(prop)"
                @commit="(t) => applySliderText(prop, t)"
              />
              <span v-else class="w-10 shrink-0 text-right font-mono text-xs text-muted-foreground">
                {{ sliderReadout(prop) }}
              </span>
            </template>
            <IconGroupUI
              v-else-if="prop.control.kind === 'icons'"
              :options="control(prop, 'icons').options.map((o) => ({ label: o.label, value: o.class, icon: STYLE_ICONS[o.icon]! }))"
              :model-value="classFor(prop) ?? undefined"
              @update:model-value="(v) => v && set(prop, v)"
            />
            <template v-else-if="prop.control.kind === 'color'">
              <ValueFieldUI
                :model-value="colorText(prop)"
                :validate="isColorValue"
                placeholder="—"
                class="!w-auto min-w-0 flex-1 !text-left"
                @commit="(t) => applyColorText(prop, t)"
              />
              <ColorPickerUI
                :model-value="colorValue(prop)"
                @update:model-value="(v) => setColor(prop, v)"
              />
            </template>
            <InputUI
              v-else-if="prop.control.kind === 'input'"
              :placeholder="control(prop, 'input').placeholder"
              :model-value="inputValue(prop)"
              @update:model-value="(v) => setInput(prop, v)"
            />

          <template #start>
            <ButtonUI
              v-if="isDirty(prop)"
              variant="ghost"
              size="xs"
              :icon="RotateCcw"
              tooltip="Revert"
              class="aspect-square shrink-0 text-muted-foreground"
              @click="revert(prop)"
            />
          </template>
        </RowUI>
        </template>
        </template>
      </ContentAccordion>
    </GroupAccordion>


  </div>
</template>
