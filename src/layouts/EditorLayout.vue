<script setup lang="ts"></script>

<template>
  <div class="grid h-screen grid-cols-[auto_16rem_1fr_auto] overflow-hidden">
    <aside>
      <slot name="rail" />
    </aside>

    <!-- relative so the pages drawer can overlay this pane -->
    <aside class="relative overflow-y-auto">
      <slot name="left" />
    </aside>

    <main class="overflow-y-auto bg-muted/25 rounded-2xl my-2 border border-accent/50">
      <slot />
    </main>

    <aside>
      <slot name="right" />
    </aside>
  </div>
</template>
