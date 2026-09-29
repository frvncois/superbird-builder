<script setup lang="ts">
// `left` toggles the 16rem code column — it is now a toggle on the Build
// surface rather than the surface itself, so it is independent of `framed`.
// `pages` toggles the 16rem pages column the same way. They share the one
// track beside the rail — `useViewMode` never opens both at once.
// `framed` gives the centre the Build canvas chrome (inset rounded card);
// full-site Preview wants a plain full-bleed pane.
import { computed } from 'vue'

const props = withDefaults(defineProps<{ left?: boolean; pages?: boolean; framed?: boolean }>(), {
  left: true,
  pages: false,
  framed: true,
})

// one 16rem track between the rail and the centre, whichever column holds it
const columns = computed(() =>
  props.pages || props.left ? 'grid-cols-[auto_16rem_1fr_auto]' : 'grid-cols-[auto_1fr_auto]',
)
</script>

<template>
  <div class="grid h-screen overflow-hidden" :class="columns">
    <aside>
      <slot name="rail" />
    </aside>

    <!-- The rail draws no right border — whatever opens beside it owns the
         divider instead. The pages column scrolls its own panes, so it only
         needs to hold its height. -->
    <aside v-if="pages" class="min-h-0 border-l border-input">
      <slot name="pages" />
    </aside>

    <aside v-else-if="left" class="relative overflow-y-auto border-l border-input">
      <slot name="left" />
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
