<script setup lang="ts">
import { FileText, Film, Music, Type } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { MediaAsset, MediaKind } from '@/types/media'
import { useMedia } from '@/composables/useMedia'
import { formatBytes } from '@/lib/media'

defineProps<{
  assets: MediaAsset[]
  selectedId: string | null
  /** appended to preview URLs so replace-in-place busts the browser cache */
  version: number
}>()

const emit = defineEmits<{ select: [asset: MediaAsset]; pick: [asset: MediaAsset] }>()

const { thumbUrl, mediaUrl } = useMedia()

/** tiles drag onto sidebar folders — the id travels in a custom type so
 *  file-drops (which use the Files type) can't be confused with tile moves */
function onDragStart(e: DragEvent, asset: MediaAsset) {
  e.dataTransfer?.setData('application/x-guano-asset', asset.id)
}

const KIND_ICONS: Partial<Record<MediaKind, Component>> = {
  video: Film,
  audio: Music,
  document: FileText,
  font: Type,
}

/** images always preview (thumb or the original for SVG); video shows a
 *  poster frame; the rest get a kind icon */
const previewSrc = (asset: MediaAsset, version: number) =>
  asset.kind === 'image' ? `${thumbUrl(asset)}?v=${version}` : null
</script>

<template>
  <div class="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
    <button
      v-for="asset in assets"
      :key="asset.id"
      type="button"
      class="group flex flex-col gap-1.5 rounded-xl p-1.5 text-left outline-none transition-colors hover:bg-accent/20 focus-visible:ring-2 focus-visible:ring-accent"
      :class="selectedId === asset.id && 'bg-accent/30'"
      draggable="true"
      @dragstart="onDragStart($event, asset)"
      @click="emit('select', asset)"
      @dblclick="emit('pick', asset)"
    >
      <div
        class="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-muted/60"
      >
        <img
          v-if="previewSrc(asset, version)"
          :src="previewSrc(asset, version)!"
          :alt="asset.alt ?? asset.name"
          loading="lazy"
          class="size-full object-cover"
        />
        <video
          v-else-if="asset.kind === 'video'"
          :src="`${mediaUrl(asset)}?v=${version}`"
          preload="metadata"
          muted
          class="size-full object-cover"
        />
        <component
          :is="KIND_ICONS[asset.kind] ?? FileText"
          v-else
          class="size-8 text-muted-foreground"
        />
      </div>
      <div class="flex flex-col px-0.5">
        <span class="truncate text-xs text-foreground">{{ asset.name }}</span>
        <span class="text-[10px] text-muted-foreground">{{ formatBytes(asset.size) }}</span>
      </div>
    </button>
  </div>
</template>
