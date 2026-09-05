<script setup lang="ts">
import { computed } from 'vue'
import { Plus, Trash2, X } from 'lucide-vue-next'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import RowUI from '@/components/ui/RowUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import ToggleUI from '@/components/ui/ToggleUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import MediaPickerControl from '@/components/editor/content/MediaPickerControl.vue'
import { useElement } from '@/composables/useElement'
import { useComponents } from '@/composables/useComponents'
import { useCollections } from '@/composables/useCollections'
import { useConditions } from '@/composables/useConditions'
import { ELEMENTS } from '@/lib/elements'
import type { ConditionRule, ConditionSpec, ElementNode } from '@/types/editor'

const { selectedElement } = useElement()
const { masterFor } = useComponents()
const { collections, collectionById, activeCollection } = useCollections()
const { previewConditions } = useConditions()

// inside a component instance the shared master carries the conditions
// (like style/interactions) — edits apply to every instance
const target = computed<ElementNode | null>(() => {
  const el = selectedElement.value
  if (!el) return null
  return masterFor(el.id)?.master ?? el
})

const spec = computed(() => target.value?.conditions ?? null)

const def = computed(() => (selectedElement.value ? ELEMENTS[selectedElement.value.type] : null))
const hasContent = computed(() => def.value?.defaultContent !== undefined)
const isMedia = computed(() => ['image', 'video'].includes(selectedElement.value?.type ?? ''))

const EFFECTS = [
  { label: 'Hide when…', value: 'hide' },
  { label: 'Show when…', value: 'show' },
  { label: 'Swap when…', value: 'swap' },
]

const SOURCES = computed(() => [
  { label: 'Field', value: 'field' },
  { label: 'Context', value: 'context' },
  { label: 'Runtime', value: 'runtime' },
])

// runtime rules ship to the published site (site.js) — the editor canvas
// treats them as matching
const RUNTIME_PATHS = [
  { label: 'Viewport width', value: 'viewport' },
  { label: 'Date', value: 'date' },
  { label: 'Query param', value: 'query' },
]
const runtimeKind = (rule: ConditionRule) =>
  rule.path.startsWith('query.') || rule.path === 'query' ? 'query' : rule.path
const queryParam = (rule: ConditionRule) =>
  rule.path.startsWith('query.') ? rule.path.slice(6) : ''
function setRuntimeKind(rule: ConditionRule, kind: string) {
  rule.path = kind === 'query' ? 'query.' : kind
  if (kind === 'viewport') rule.op = 'lt'
  if (kind === 'date') rule.op = 'gt'
}

const CONTEXT_PATHS = [
  { label: 'Locale', value: 'locale' },
  { label: 'Page', value: 'page' },
  { label: 'Position', value: 'index' },
  { label: 'First in list', value: 'first' },
  { label: 'Last in list', value: 'last' },
]

const OPS = [
  { label: 'is', value: 'eq' },
  { label: 'is not', value: 'neq' },
  { label: 'contains', value: 'contains' },
  { label: 'is empty', value: 'empty' },
  { label: 'is set', value: 'notEmpty' },
  { label: '>', value: 'gt' },
  { label: '<', value: 'lt' },
]

// entry fields plus one-hop reference paths ('author.name')
const fieldPaths = computed(() => {
  const options: { label: string; value: string }[] = []
  for (const f of activeCollection.value?.fields ?? []) {
    options.push({ label: f.name, value: f.name })
    if (f.type === 'reference' && f.refCollectionId) {
      const ref = collectionById(f.refCollectionId)
      for (const rf of ref?.fields ?? []) {
        if (rf.type === 'reference' || rf.type === 'multi-reference') continue
        options.push({ label: `${f.name}.${rf.name}`, value: `${f.name}.${rf.name}` })
      }
    }
  }
  return options
})

const pathOptions = (rule: ConditionRule) =>
  rule.source === 'context' ? CONTEXT_PATHS : fieldPaths.value

const newRule = (): ConditionRule => ({
  id: crypto.randomUUID(),
  source: activeCollection.value ? 'field' : 'context',
  path: activeCollection.value?.fields[0]?.name ?? 'locale',
  op: 'notEmpty',
  value: '',
})

function addSpec() {
  if (!target.value) return
  target.value.conditions = { rules: [newRule()], effect: 'hide' }
}

function addRule() {
  spec.value?.rules.push(newRule())
}

function removeRule(rule: ConditionRule) {
  const s = spec.value
  if (!s || !target.value) return
  s.rules = s.rules.filter((r) => r.id !== rule.id)
  if (!s.rules.length) delete target.value.conditions
}

function removeSpec() {
  if (target.value) delete target.value.conditions
}

function setSource(rule: ConditionRule, source: ConditionRule['source']) {
  rule.source = source
  rule.path =
    source === 'context'
      ? 'locale'
      : source === 'runtime'
        ? 'viewport'
        : (fieldPaths.value[0]?.value ?? '')
  if (source === 'runtime') rule.op = 'lt'
}

// first/last read as 'true'/'false' — pin the row to a yes/no check
function setPath(rule: ConditionRule, path: string) {
  rule.path = path
  if (path === 'first' || path === 'last') {
    rule.op = 'eq'
    rule.value = 'true'
  }
}

const needsValue = (rule: ConditionRule) =>
  !['empty', 'notEmpty'].includes(rule.op) && !['first', 'last'].includes(rule.path)

function setEffect(effect: ConditionSpec['effect']) {
  const s = spec.value
  if (!s) return
  s.effect = effect
  if (effect !== 'swap') {
    delete s.swapContent
    delete s.swapSrc
  }
}

const swapContent = computed({
  get: () => spec.value?.swapContent ?? '',
  set: (v: string) => {
    if (spec.value) {
      if (v) spec.value.swapContent = v
      else delete spec.value.swapContent
    }
  },
})

const swapSrc = computed({
  get: () => spec.value?.swapSrc ?? '',
  set: (v: string) => {
    if (spec.value) {
      if (v) spec.value.swapSrc = v
      else delete spec.value.swapSrc
    }
  },
})
</script>

<template>
  <GroupPopover label="Conditions">
    <template v-if="spec">
      <RowUI label="Effect">
        <SelectUI
          :model-value="spec.effect"
          :options="EFFECTS"
          @update:model-value="(v) => v && setEffect(v as never)"
        />
      </RowUI>

      <div v-for="rule in spec.rules" :key="rule.id" class="flex flex-col gap-1 rounded-lg border border-input p-2">
        <div class="flex items-center gap-1.5">
          <SelectUI
            :model-value="rule.source"
            :options="SOURCES"
            class="w-20"
            @update:model-value="(v) => v && setSource(rule, v as never)"
          />
          <SelectUI
            v-if="rule.source === 'runtime'"
            :model-value="runtimeKind(rule)"
            :options="RUNTIME_PATHS"
            @update:model-value="(v) => v && setRuntimeKind(rule, v)"
          />
          <SelectUI
            v-else
            :model-value="rule.path"
            :options="pathOptions(rule)"
            @update:model-value="(v) => v != null && setPath(rule, v)"
          />
          <ButtonUI
            variant="icon"
            size="sm"
            :icon="X"
            tooltip="Remove rule"
            class="w-6 shrink-0 text-muted-foreground"
            @click="removeRule(rule)"
          />
        </div>
        <InputUI
          v-if="rule.source === 'runtime' && runtimeKind(rule) === 'query'"
          :model-value="queryParam(rule)"
          placeholder="param name (e.g. promo)"
          class="font-mono"
          @update:model-value="(v) => (rule.path = `query.${v}`)"
        />
        <div v-if="!['first', 'last'].includes(rule.path)" class="flex items-center gap-1.5">
          <SelectUI v-model="rule.op" :options="OPS" class="w-24" />
          <InputUI v-if="needsValue(rule)" v-model="rule.value" placeholder="value" />
        </div>
      </div>

      <p v-if="spec.rules.some((r) => r.source === 'runtime')" class="text-[10px] text-muted-foreground">
        Runtime rules evaluate in the visitor's browser. Hidden content still ships in the page HTML.
      </p>

      <template v-if="spec.effect === 'swap'">
        <RowUI v-if="hasContent" label="Text">
          <InputUI v-model="swapContent" placeholder="Alternate text" />
        </RowUI>
        <template v-if="isMedia">
          <p class="text-[10px] text-muted-foreground">Alternate media while matching:</p>
          <MediaPickerControl
            v-model="swapSrc"
            :kind="selectedElement?.type === 'video' ? 'video' : 'image'"
          />
        </template>
      </template>

      <div class="flex gap-1.5">
        <ButtonUI variant="outline" size="sm" :icon="Plus" class="flex-1" @click="addRule">
          Rule
        </ButtonUI>
        <ButtonUI
          variant="outline"
          size="sm"
          :icon="Trash2"
          tooltip="Remove all conditions"
          class="text-danger"
          @click="removeSpec"
        />
      </div>

      <RowUI label="Preview">
        <ToggleUI v-model="previewConditions" />
      </RowUI>
      <p class="text-[10px] text-muted-foreground">
        Preview hides matching elements on the canvas like the published site.
      </p>
    </template>

    <ButtonUI v-else variant="outline" size="sm" :icon="Plus" class="w-full" @click="addSpec">
      Add condition
    </ButtonUI>
  </GroupPopover>
</template>
