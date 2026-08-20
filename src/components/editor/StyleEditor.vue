<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { usePanel } from '@/composables/usePanel'
import { X } from 'lucide-vue-next'
import { STYLE_SECTIONS, matchClass } from '@/lib/styles'
import type { StyleProperty, Control } from '@/lib/styles'
import { useElement } from '@/composables/useElement'
import { useComponents } from '@/composables/useComponents'
import GroupAccordion from '@/components/accordion/GroupAccordion.vue'
import TitleAccordion from '@/components/accordion/TitleAccordion.vue'
import ContentAccordion from '@/components/accordion/ContentAccordion.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import RowUI from '@/components/ui/RowUI.vue'
import ClassInput from '@/components/editor/ClassInput.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import SliderUI from '@/components/ui/SliderUI.vue'
import ColorPickerUI from '@/components/ui/ColorPickerUI.vue'

const { selectedElement } = useElement()
const { masterFor } = useComponents()

// inside a component instance, style edits land on the shared master
const styleTarget = computed(() =>
  selectedElement.value
    ? (masterFor(selectedElement.value.id)?.master ?? selectedElement.value)
    : null,
)

// the element's class string is the single source of truth: the
// visual controls read their state out of it and write back into it
const tokens = computed(() => (styleTarget.value?.classes ?? '').split(/\s+/).filter(Boolean))

function setTokens(next: string[]) {
  if (styleTarget.value) styleTarget.value.classes = next.join(' ')
}

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

function remove(prop: StyleProperty) {
  const current = classFor(prop)
  if (current) setTokens(tokens.value.filter((cls) => cls !== current))
}

// --- accordion open state (all closed by default) ---

const openSections = ref<Record<string, boolean>>(
  Object.fromEntries(STYLE_SECTIONS.map((s) => [s.id, false])),
)

const displayProp = STYLE_SECTIONS.flatMap((s) => s.properties).find((p) => p.id === 'display')!

// flex-dependent classes (align, justify, gap…) imply a display — add one so
// the Display row always reflects reality
watch(
  tokens,
  () => {
    const needsDisplay = STYLE_SECTIONS.flatMap((s) => s.properties).some(
      (p) => p.needsDisplay && matchClass(p, tokens.value),
    )
    if (needsDisplay && !matchClass(displayProp, tokens.value)) {
      setTokens(['flex', ...tokens.value])
    }
  },
  { immediate: true },
)

// --- control value mapping (stored value is always the tailwind class) ---

function control<K extends Control['kind']>(prop: StyleProperty, kind: K) {
  return prop.control as Extract<Control, { kind: K }>
}

function selectOptions(prop: StyleProperty) {
  return control(prop, 'select').options.map((o) => ({ label: o.label, value: o.class }))
}

function sliderIndex(prop: StyleProperty): number {
  const { prefix, stops } = control(prop, 'slider')
  const index = stops.findIndex((s) => `${prefix}-${s}` === classFor(prop))
  return index === -1 ? 0 : index
}

function setSlider(prop: StyleProperty, index: number) {
  const { prefix, stops } = control(prop, 'slider')
  set(prop, `${prefix}-${stops[index] ?? stops[0]}`)
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

function addToken(cls: string) {
  if (!tokens.value.includes(cls)) setTokens([...tokens.value, cls])
}

function removeToken(cls: string) {
  setTokens(tokens.value.filter((t) => t !== cls))
}
</script>

<template>
  <div class="flex flex-col">
    <GroupAccordion
      v-for="section in STYLE_SECTIONS"
      :key="section.id"
      v-model:open="openSections[section.id]"
    >
      <TitleAccordion>
        {{ section.label }}
      </TitleAccordion>

      <ContentAccordion>
        <RowUI v-for="prop in section.properties" :key="prop.id" :label="prop.label">
          <SelectUI
              v-if="prop.control.kind === 'select'"
              :options="selectOptions(prop)"
              placeholder="—"
              :model-value="classFor(prop) ?? ''"
              @update:model-value="(v) => v && set(prop, v)"
            />
            <template v-else-if="prop.control.kind === 'slider'">
              <SliderUI
                :min="0"
                :max="control(prop, 'slider').stops.length - 1"
                :model-value="sliderIndex(prop)"
                @update:model-value="(v) => setSlider(prop, v)"
              />
              <span class="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">
                {{ control(prop, 'slider').stops[sliderIndex(prop)] }}
              </span>
            </template>
            <ColorPickerUI
              v-else-if="prop.control.kind === 'color'"
              :model-value="colorValue(prop)"
              @update:model-value="(v) => setColor(prop, v)"
            />
            <InputUI
              v-else-if="prop.control.kind === 'input'"
              :placeholder="control(prop, 'input').placeholder"
              :model-value="inputValue(prop)"
              @update:model-value="(v) => setInput(prop, v)"
            />

          <template #start>
            <ButtonUI
              v-if="classFor(prop)"
              variant="ghost"
              size="xs"
              :icon="X"
              title="Remove"
              class="aspect-square shrink-0 text-muted-foreground"
              @click="remove(prop)"
            />
          </template>
        </RowUI>
      </ContentAccordion>
    </GroupAccordion>

    <div class="flex flex-col gap-1.5 p-3">
      <p class="text-xs font-medium text-muted-foreground">Classes</p>
      <ClassInput ref="classInput" :tokens="tokens" @add="addToken" @remove="removeToken" />
    </div>
  </div>
</template>
