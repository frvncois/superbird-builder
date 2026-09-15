<script setup lang="ts">
import { computed } from 'vue'
import { TAILWIND_COLORS, TAILWIND_SHADES, colorHex } from '@/lib/colors'
import { useDropdown } from '@/composables/useDropdown'

/** model is a color value: 'slate-100', 'white', 'transparent', or '#hex' */
const model = defineModel<string>({ default: 'slate-500' })

withDefaults(
  defineProps<{
    /** 'sm' is the compact swatch embedded inside a value field */
    size?: 'default' | 'sm'
    /** which edge of the trigger the palette aligns to */
    align?: 'left' | 'right'
  }>(),
  { size: 'default', align: 'right' },
)

// outside-click close; Escape is local so it can't also close a host panel
const { open, root, toggle, close } = useDropdown()
const hex = computed(() => colorHex(model.value))

function pick(value: string) {
  model.value = value
  close()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) {
    e.stopPropagation()
    close()
  }
}
</script>

<template>
  <div ref="root" class="relative shrink-0">
    <button
      v-tooltip="model"
      type="button"
      class="shrink-0 cursor-pointer rounded-md border border-input outline-none focus-visible:ring-2 focus-visible:ring-accent"
      :class="size === 'sm' ? 'size-5' : 'size-6'"
      :style="{ backgroundColor: hex }"
      @click="toggle"
      @keydown="onKeydown"
    />

    <div
      v-if="open"
      class="absolute top-full z-30 mt-1 rounded-md border border-input bg-background p-2 shadow-md"
      :class="align === 'left' ? 'left-0' : 'right-0'"
      @keydown="onKeydown"
    >
      <div class="flex max-h-44 flex-col gap-0.5 overflow-y-auto pr-1">
        <div v-for="(hexes, name) in TAILWIND_COLORS" :key="name" class="flex gap-0.5">
          <button
            v-for="(swatch, i) in hexes"
            :key="swatch"
            v-tooltip="`${name}-${TAILWIND_SHADES[i]}`"
            type="button"
            class="size-4 shrink-0 cursor-pointer rounded-sm hover:scale-125"
            :style="{ backgroundColor: swatch }"
            @click="pick(`${name}-${TAILWIND_SHADES[i]}`)"
          />
        </div>
      </div>

      <div class="mt-2 flex items-center gap-1.5">
        <button
          v-tooltip="'white'"
          type="button"
          class="size-4 cursor-pointer rounded-sm border border-input bg-white"
          @click="pick('white')"
        />
        <button
          v-tooltip="'black'"
          type="button"
          class="size-4 cursor-pointer rounded-sm border border-input bg-black"
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
