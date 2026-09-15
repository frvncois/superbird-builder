<script setup lang="ts">
// `left` toggles the 16rem code/left column: Build shows it, full-site Preview
// drops it so the center gets the width.
withDefaults(defineProps<{ left?: boolean }>(), { left: true })
</script>

<template>
  <div
    class="grid h-screen overflow-hidden"
    :class="left ? 'grid-cols-[auto_16rem_1fr_auto]' : 'grid-cols-[auto_1fr_auto]'"
  >
    <aside>
      <slot name="rail" />
    </aside>

    <!-- relative so the pages drawer can overlay this pane -->
    <aside v-if="left" class="relative overflow-y-auto">
      <slot name="left" />
    </aside>

    <!-- Build gets the framed canvas surface; Preview is a plain full-bleed pane -->
    <main
      class="overflow-y-auto"
      :class="left ? 'bg-muted/25 rounded-2xl my-2 border border-accent/50' : ''"
    >
      <slot />
    </main>

    <aside>
      <slot name="right" />
    </aside>
  </div>
</template>
