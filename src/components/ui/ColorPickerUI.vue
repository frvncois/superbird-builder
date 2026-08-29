<script setup lang="ts">
import { computed, ref } from 'vue'
import { TAILWIND_COLORS, TAILWIND_SHADES, colorHex } from '@/lib/colors'

/** model is a color value: 'slate-100', 'white', 'transparent', or '#hex' */
const model = defineModel<string>({ default: 'slate-500' })

const open = ref(false)
const hex = computed(() => colorHex(model.value))

function pick(value: string) {
  model.value = value
  open.value = false
}
</script>

<template>
  <div class="relative shrink-0">
    <button
      class="size-6 shrink-0 cursor-pointer rounded-md border border-input"
      :style="{ backgroundColor: hex }"
      :title="model"
      @click="open = !open"
    />

    <div
      v-if="open"
      class="absolute top-full right-0 z-30 mt-1 rounded-md border border-input bg-background p-2 shadow-md"
    >
      <div class="flex max-h-44 flex-col gap-0.5 overflow-y-auto pr-1">
        <div v-for="(hexes, name) in TAILWIND_COLORS" :key="name" class="flex gap-0.5">
          <button
            v-for="(swatch, i) in hexes"
            :key="swatch"
            class="size-4 shrink-0 cursor-pointer rounded-sm hover:scale-125"
            :style="{ backgroundColor: swatch }"
            :title="`${name}-${TAILWIND_SHADES[i]}`"
            @click="pick(`${name}-${TAILWIND_SHADES[i]}`)"
          />
        </div>
      </div>

      <div class="mt-2 flex items-center gap-1.5">
        <button
          class="size-4 cursor-pointer rounded-sm border border-input bg-white"
          title="white"
          @click="pick('white')"
        />
        <button
          class="size-4 cursor-pointer rounded-sm border border-input bg-black"
          title="black"
          @click="pick('black')"
        />
        <label class="ml-auto flex cursor-pointer items-center gap-1">
          <input
            :value="hex.startsWith('#') ? hex : '#888888'"
            type="color"
            class="size-5 cursor-pointer rounded-sm border border-input bg-transparent p-0"
            @input="pick(($event.target as HTMLInputElement).value)"
          />
          <span class="text-[10px] text-muted-foreground">Custom</span>
        </label>
      </div>
    </div>
  </div>
</template>
