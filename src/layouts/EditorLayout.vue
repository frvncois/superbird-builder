<script setup lang="ts">
// `left` toggles the 16rem code column — it is now a toggle on the Build
// surface rather than the surface itself, so it is independent of `framed`.
// `framed` gives the centre the Build canvas chrome (inset rounded card);
// full-site Preview wants a plain full-bleed pane.
withDefaults(defineProps<{ left?: boolean; framed?: boolean }>(), {
  left: true,
  framed: true,
})
</script>

<template>
  <div
    class="grid h-screen overflow-hidden"
    :class="left ? 'grid-cols-[auto_16rem_1fr_auto]' : 'grid-cols-[auto_1fr_auto]'"
  >
    <aside>
      <slot name="rail" />
    </aside>

    <!-- relative so the pages drawer can overlay this pane. The rail draws no
         right border — whatever opens beside it owns the divider instead. -->
    <aside v-if="left" class="relative overflow-y-auto border-l border-input">
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
