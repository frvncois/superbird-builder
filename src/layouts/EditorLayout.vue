<script setup lang="ts">
// `column` names which docked column holds the single 16rem track beside the
// rail — pages, code or components, or none for the bare canvas. One prop
// rather than three booleans so the rendered aside and the grid track can
// never disagree; `useViewMode` owns which one it is.
// `framed` gives the centre the Build canvas chrome (inset rounded card);
// full-site Preview wants a plain full-bleed pane.
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{ column?: 'pages' | 'code' | 'components' | null; framed?: boolean }>(),
  { column: null, framed: true },
)

const columns = computed(() =>
  props.column ? 'grid-cols-[auto_16rem_1fr_auto]' : 'grid-cols-[auto_1fr_auto]',
)
</script>

<template>
  <div class="grid h-screen overflow-hidden" :class="columns">
    <aside>
      <slot name="rail" />
    </aside>

    <!-- The rail draws no right border — whatever opens beside it owns the
         divider instead. The drawers scroll their own panes, so they only
         need to hold their height; the code column scrolls as one. -->
    <aside v-if="column === 'pages'" class="min-h-0 border-l border-input">
      <slot name="pages" />
    </aside>

    <aside v-else-if="column === 'components'" class="min-h-0 border-l border-input">
      <slot name="components" />
    </aside>

    <aside v-else-if="column === 'code'" class="relative overflow-y-auto border-l border-input">
      <slot name="code" />
    </aside>

    <!-- Build gets the framed canvas surface; Preview is a plain full-bleed pane -->
    <main
      class="overflow-y-auto"
      :class="framed ? 'bg-muted/25 rounded-2xl my-2 border border-accent/50' : ''"
    >
      <slot />
    </main>

    <aside>
      <slot name="right" />
    </aside>
  </div>
</template>
