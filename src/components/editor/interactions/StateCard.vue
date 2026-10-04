<script setup lang="ts">
// A STATE this element can be in: one effect that some trigger — this element's
// own or another's — puts it into. The modal/menu/accordion half of the panel.
//
// Why it exists. An effect's on/off state belongs to the EFFECT, identified by
// (effect, target) — never to the binding that fires it — which is what lets an
// open button, a close button and an overlay agree. Dismissal, the exclusive
// group and a remembered dismissal are properties of THAT, and both runtimes
// already fold them per (interaction, target) whichever binding declares them
// (`useInteraction.effectOptions`, `site-runtime.js`'s `closeOnFor` /
// `groupFor` / `onceFor`). Before this they were edited per trigger, so "close
// on Escape" set on the close button read as something about the button, and
// setting it twice looked like two different settings.
//
// So: read them as the UNION over every binding driving this state, write them
// to ONE canonical binding, and clear the others. Nothing new is stored and no
// runtime changes — the data just gains a single author.
//
// A TIMELINE can be a state too (a click play is keyed per (animation, target)
// as well), and a MIXED effect is one state wearing both. Dismissal belongs to
// the class half, so those three controls appear only when there is one.
//
// What the card IS — its name, its summary, which drivers are class changes —
// is resolved by the panel and passed in, so this file holds the editing rules
// and nothing about how an effect is put together.
import { computed } from 'vue'
import { ArrowUpRight, Pencil } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import MenuUI from '@/components/ui/MenuUI.vue'
import RowUI from '@/components/ui/RowUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import { useElement } from '@/composables/useElement'
import { useComponents } from '@/composables/useComponents'
import { useEffectsDrawer, type DrawerKind } from '@/composables/useEffectsDrawer'
import type { Driver } from '@/composables/useInteraction'

const props = defineProps<{
  /** the node the state lands on — this panel's element */
  nodeId: string
  /** what "Edit effect" opens the drawer on */
  drawerKind: DrawerKind
  drawerId: string
  name: string
  /** the class half's classes, when it has one — what the state looks like */
  summary: string
  /** the class-change bindings driving it: where dismissal is read and written */
  classDrivers: Driver[]
  /** the node declaring each driving binding, both engines, in document order */
  driverOwnerIds: string[]
}>()

const { getElement, selectElement, highlightElement } = useElement()
const { findMasterNode } = useComponents()
const { openEffect } = useEffectsDrawer()

const MENU_ITEM =
  'flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs outline-none hover:bg-accent/30 focus-visible:bg-accent/30'

/** dismissal, the group and the memory are CLASS-change state: a timeline has
 *  none of them, so a motion-only state shows what it is and who drives it
 *  rather than three controls that would write nothing */
const hasClassHalf = computed(() => props.classDrivers.length > 0)

/**
 * The one binding the options are stored on. Document order (the page walk,
 * then the masters), so the choice is stable across reloads and does not depend
 * on which row the author opened.
 */
const canonical = computed(() => props.classDrivers[0]?.binding ?? null)

/** every other binding — cleared on write, so there is one author */
function others() {
  return props.classDrivers.slice(1).map((d) => d.binding)
}

// --- dismissal: the union, because that is what the runtimes resolve ---

function isDismissOn(mode: 'outside' | 'escape'): boolean {
  return props.classDrivers.some((d) => d.binding.closeOn?.includes(mode))
}

function toggleDismiss(mode: 'outside' | 'escape') {
  const target = canonical.value
  if (!target) return
  const next = new Set<string>()
  for (const d of props.classDrivers) for (const m of d.binding.closeOn ?? []) next.add(m)
  if (next.has(mode)) next.delete(mode)
  else next.add(mode)
  // omitted when empty so untouched bindings stay byte-identical for merge
  target.closeOn = next.size ? ([...next] as ('outside' | 'escape')[]) : undefined
  for (const b of others()) b.closeOn = undefined
}

// --- exclusive group ---

const group = computed(() => props.classDrivers.find((d) => d.binding.group)?.binding.group ?? '')

function setGroup(value: string) {
  const target = canonical.value
  if (!target) return
  target.group = value.trim() || undefined
  for (const b of others()) b.group = undefined
}

// --- remembered dismissal ---

const ONCE_OPTIONS = [
  { label: 'Always', value: '' },
  { label: 'Once per session', value: 'session' },
  { label: 'Once per browser', value: 'local' },
]
const once = computed(() => props.classDrivers.find((d) => d.binding.once)?.binding.once ?? '')

function setOnce(value: string) {
  const target = canonical.value
  if (!target) return
  target.once = value ? (value as 'session' | 'local') : undefined
  for (const b of others()) b.once = undefined
}

// --- driven by ---

/** the elements that can put this one into this state, deduped, each clickable
 *  — "why did my modal open?" answered without reading every element */
const driverNodes = computed(() => {
  const seen = new Set<string>()
  const list: { id: string; label: string }[] = []
  for (const ownerId of props.driverOwnerIds) {
    if (seen.has(ownerId)) continue
    seen.add(ownerId)
    const node = getElement(ownerId) ?? findMasterNode(ownerId)
    if (!node) continue
    list.push({ id: ownerId, label: node.ref ? `#${node.ref}` : node.type })
  }
  return list
})

function jumpTo(id: string) {
  // a master node is selected the same way a page node is: the panel follows
  // the selection, and the board's own scope resolves it
  selectElement(id)
  highlightElement(null)
}
</script>

<template>
  <div data-state-card :data-state-for="nodeId" class="flex flex-col rounded-xl border border-input">
    <div class="flex h-8 items-center gap-1.5 pr-1 pl-2.5">
      <button
        type="button"
        class="min-w-0 flex-1 truncate rounded text-left text-xs font-medium outline-none hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-accent"
        @click="openEffect(drawerKind, drawerId)"
      >
        {{ name }}
      </button>
      <span v-if="summary" class="max-w-28 shrink-0 truncate font-mono text-[10px] text-muted-foreground">
        {{ summary }}
      </span>
      <MenuUI width="w-44" label="State options">
        <template #default="{ close }">
          <button
            type="button"
            :class="MENU_ITEM"
            @click="(openEffect(drawerKind, drawerId), close())"
          >
            <Pencil class="size-3.5" /> Edit effect
          </button>
        </template>
      </MenuUI>
    </div>

    <div class="flex flex-col gap-1 border-t border-input/60 pb-1.5 pt-1">
      <RowUI v-if="hasClassHalf" label="Closes on">
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

      <RowUI v-if="hasClassHalf" label="One at a time">
        <InputUI
          placeholder="group name — e.g. faq"
          :model-value="group"
          @update:model-value="setGroup"
        />
      </RowUI>

      <RowUI v-if="hasClassHalf" label="Remember">
        <SelectUI :model-value="once" :options="ONCE_OPTIONS" @update:model-value="(v) => setOnce(v ?? '')" />
      </RowUI>
      <p v-if="once" class="px-2.5 text-[10px] text-muted-foreground">
        Remembered on the published site only — the editor always shows the element.
      </p>

      <RowUI v-if="driverNodes.length" label="Driven by">
        <div class="flex flex-1 flex-wrap justify-end gap-1">
          <button
            v-for="d in driverNodes"
            :key="d.id"
            type="button"
            class="inline-flex items-center gap-0.5 rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-secondary-foreground outline-none hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-accent"
            @click="jumpTo(d.id)"
            @mouseenter="highlightElement(d.id)"
            @mouseleave="highlightElement(null)"
          >
            {{ d.label }}
            <ArrowUpRight class="size-2.5 opacity-60" />
          </button>
        </div>
      </RowUI>
    </div>
  </div>
</template>
