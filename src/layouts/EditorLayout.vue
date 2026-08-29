<script setup lang="ts"></script>

<template>
  <div class="grid h-screen grid-rows-[auto_1fr] overflow-hidden">
    <header class="flex items-center p-2">
      <slot name="header" />
    </header>

    <div class="grid grid-cols-[16rem_1fr_auto] overflow-hidden">
      <aside class="overflow-y-auto">
        <slot name="left" />
      </aside>

      <main class="overflow-y-auto bg-muted/25 rounded-xl mb-2 border border-accent/50">
        <slot />
      </main>

      <aside>
        <slot name="right" />
      </aside>
    </div>
  </div>
</template>
