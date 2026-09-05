<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Plus, X } from 'lucide-vue-next'
import { usePage } from '@/composables/usePage'
import { useProject, MIN_BREAKPOINTS } from '@/composables/useProject'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import ElementRenderer from '@/components/editor/canvas/ElementRenderer.vue'
import FrameScope from '@/components/editor/canvas/FrameScope.vue'
import EntryScope from '@/components/shared/EntryScope.vue'
import CommentMarker from '@/components/shared/CommentMarker.vue'
import CommentLayer from '@/components/site/CommentLayer.vue'
import { anchorFromPoint, anchorScreenPos } from '@/lib/commentAnchor'
import InsertDock from '@/components/editor/canvas/InsertDock.vue'
import { useCollections } from '@/composables/useCollections'
import { useShortcut, useKeymap } from '@/composables/useShortcut'
import { useComments } from '@/composables/useComments'
import { useCommentMode } from '@/composables/useCommentMode'
import { useInteraction } from '@/composables/useInteraction'
import { useSettings } from '@/composables/useSettings'
import { useThemeTokens } from '@/composables/useThemeTokens'
import type { Breakpoint } from '@/types/editor'

void import('@tailwindcss/browser')

const { activePage } = usePage()
const { breakpoints, canAddBreakpoint, addBreakpoint, removeBreakpoint, setActiveBreakpoint } = useProject()

const canRemoveBreakpoint = computed(() => breakpoints.value.length > MIN_BREAKPOINTS)
const { visibleComments, addComment, activeComment, focusTick } = useComments()
const { pickingFor } = useInteraction()
const { activeCollection, activeEntry } = useCollections()
const { settings } = useSettings()
useThemeTokens() 

const camera = ref({ x: 80, y: 60, zoom: 0.3 })
const MIN_ZOOM = 0.15
const MAX_ZOOM = 4

const viewport = ref<HTMLElement>()
const worldEl = ref<HTMLElement>()
const space = useShortcut('Space')
const { commentMode } = useCommentMode()

const panning = ref(false)
let last = { x: 0, y: 0 }

let gesturing = false
let gestureScale = 1

const PAN_MARGIN = 120

function clampCamera(cam: { x: number; y: number; zoom: number }) {
  const rect = viewport.value?.getBoundingClientRect()
  const world = worldEl.value
  if (!rect || !world) return cam
  const worldW = world.offsetWidth * cam.zoom
  const worldH = world.offsetHeight * cam.zoom
  cam.x = Math.min(rect.width - PAN_MARGIN, Math.max(PAN_MARGIN - worldW, cam.x))
  cam.y = Math.min(rect.height - PAN_MARGIN, Math.max(PAN_MARGIN - worldH, cam.y))
  return cam
}

function onPointerDown(e: PointerEvent) {
  if (!space.pressed.value) return
  panning.value = true
  last = { x: e.clientX, y: e.clientY }
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!panning.value) return
  camera.value = clampCamera({
    zoom: camera.value.zoom,
    x: camera.value.x + (e.clientX - last.x),
    y: camera.value.y + (e.clientY - last.y),
  })
  last = { x: e.clientX, y: e.clientY }
}

function onPointerUp() {
  panning.value = false
}

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

function zoomAt(next: number, cx: number, cy: number) {
  const { x, y, zoom } = camera.value
  const z = clampZoom(next)
  camera.value = clampCamera({ zoom: z, x: cx - (cx - x) * (z / zoom), y: cy - (cy - y) * (z / zoom) })
}

function onWheel(e: WheelEvent) {
  if (gesturing) return 
  const rect = viewport.value?.getBoundingClientRect()
  if (!rect) return
  if (e.ctrlKey || e.metaKey) {
    zoomAt(camera.value.zoom * Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top)
  } else {
    camera.value = clampCamera({
      zoom: camera.value.zoom,
      x: camera.value.x - e.deltaX,
      y: camera.value.y - e.deltaY,
    })
  }
}

function onGestureStart(e: Event) {
  e.preventDefault()
  gesturing = true
  gestureScale = (e as unknown as { scale: number }).scale || 1
}
function onGestureChange(e: Event) {
  e.preventDefault()
  const rect = viewport.value?.getBoundingClientRect()
  const ev = e as unknown as { scale: number; clientX: number; clientY: number }
  if (!rect || !gestureScale) return
  const factor = ev.scale / gestureScale
  gestureScale = ev.scale
  zoomAt(camera.value.zoom * factor, ev.clientX - rect.left, ev.clientY - rect.top)
}
function onGestureEnd() {
  gesturing = false
}
onMounted(() => {
  const el = viewport.value as unknown as HTMLElement | null
  el?.addEventListener('gesturestart', onGestureStart)
  el?.addEventListener('gesturechange', onGestureChange)
  el?.addEventListener('gestureend', onGestureEnd)
})
onBeforeUnmount(() => {
  const el = viewport.value as unknown as HTMLElement | null
  el?.removeEventListener('gesturestart', onGestureStart)
  el?.removeEventListener('gesturechange', onGestureChange)
  el?.removeEventListener('gestureend', onGestureEnd)
})

const worldStyle = computed(() => ({
  transform: `translate(${camera.value.x}px, ${camera.value.y}px) scale(${camera.value.zoom})`,
}))

const INITIAL_CAMERA = { x: 80, y: 60, zoom: 0.3 }

function zoomBy(factor: number) {
  const rect = viewport.value?.getBoundingClientRect()
  if (!rect) return
  zoomAt(camera.value.zoom * factor, rect.width / 2, rect.height / 2)
}

useKeymap([
  { key: ['=', '+'], mod: true, allowInInput: true, handler: () => zoomBy(1.2) },
  { key: '-', mod: true, allowInInput: true, handler: () => zoomBy(1 / 1.2) },
  { key: '0', mod: true, allowInInput: true, handler: () => (camera.value = { ...INITIAL_CAMERA }) },
])

const pageComments = computed(() => visibleComments(activePage.value.id))

const frameEls: Record<string, HTMLElement> = {}
function setFrameEl(id: string) {
  return (el: unknown) => {
    if (el instanceof HTMLElement) frameEls[id] = el
  }
}

function placeComment(e: MouseEvent) {
  if (!commentMode.value || !viewport.value) return
  const anchor = anchorFromPoint(e.clientX, e.clientY, viewport.value)
  if (anchor) addComment({ pageId: activePage.value.id, anchor })
}

function onFrameClick(bp: Breakpoint, e: MouseEvent) {
  // clicking a frame makes it the breakpoint the Style panel edits
  setActiveBreakpoint(bp.id)
  if (!commentMode.value) return
  e.stopPropagation()
  placeComment(e)
}
const onCanvasClick = placeComment

watch(focusTick, async () => {
  await nextTick()
  const comment = activeComment.value
  if (!comment || !viewport.value) return
  const { zoom } = camera.value
  const rect = viewport.value.getBoundingClientRect()

  if (comment.anchor && worldEl.value) {
    const pos = anchorScreenPos(comment.anchor, worldEl.value)
    if (!pos) return
    const wx = (pos.x - rect.left - camera.value.x) / zoom
    const wy = (pos.y - rect.top - camera.value.y) / zoom
    camera.value = clampCamera({ zoom, x: rect.width / 2 - wx * zoom, y: rect.height / 2 - wy * zoom })
    return
  }

  if (comment.x === undefined || comment.y === undefined) return
  let x = comment.x
  let y = comment.y
  if (comment.breakpointId) {
    const frame = frameEls[comment.breakpointId]
    if (!frame) return
    x += frame.offsetLeft
    y += frame.offsetTop
  }
  camera.value = { zoom, x: rect.width / 2 - x * zoom, y: rect.height / 2 - y * zoom }
})
</script>

<template>
  <div
    ref="viewport"
    class="relative h-full w-full touch-none overflow-hidden bg-secondary"
    :class="
      panning
        ? 'cursor-grabbing'
        : space.pressed.value
          ? 'cursor-grab'
          : commentMode || pickingFor
            ? 'cursor-crosshair'
            : ''
    "
    @wheel.prevent="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @click="onCanvasClick"
  >
    <div ref="worldEl" class="absolute left-0 top-0 origin-top-left" :style="worldStyle">
      <div class="flex w-max items-stretch">
        <template v-for="(bp, i) in breakpoints" :key="bp.id">
          <div class="group flex w-40 items-center justify-center" @click.stop>
            <div v-if="canAddBreakpoint(i)" :style="{ transform: `scale(${1 / camera.zoom})` }">
              <ButtonUI
                variant="ghost"
                size="sm"
                :icon="Plus"
                tooltip="Add breakpoint"
                class="size-8 rounded-full bg-background opacity-50 shadow-md transition-opacity group-hover:opacity-100"
                @click="addBreakpoint(i)"
              />
            </div>
          </div>

          <div class="group/frame">
            <div
              class="mb-3 flex origin-bottom-left items-center text-[10px] gap-2 text-muted-foreground select-none"
              :style="{ transform: `scale(${1 / camera.zoom})` }"
            >
              {{ bp.name }} · {{ bp.width }}
              <button
                v-if="canRemoveBreakpoint"
                v-tooltip="'Delete breakpoint'"
                class="cursor-pointer opacity-0 transition-opacity group-hover/frame:opacity-100 hover:text-foreground"
                @click.stop="removeBreakpoint(bp.id)"
              >
                <X class="size-3" />
              </button>
            </div>

          <div :ref="setFrameEl(bp.id)" class="relative">
            <div
              data-frame-drop
              class="flex flex-col overflow-hidden bg-white text-black shadow-lg"
              :style="{
                width: `${bp.width}px`,
                minHeight: `${bp.height}px`,
                fontFamily: settings.fonts.family || undefined,
              }"
              @click.capture="onFrameClick(bp, $event)"
            >

              <FrameScope :breakpoint-id="bp.id">
                <EntryScope
                  v-if="activeCollection"
                  :collection="activeCollection"
                  :entry="activeEntry"
                >
                  <ElementRenderer
                    v-for="node in activePage.elements"
                    :key="node.id"
                    :node="node"
                  />
                </EntryScope>
                <template v-else>
                  <ElementRenderer
                    v-for="node in activePage.elements"
                    :key="node.id"
                    :node="node"
                  />
                </template>
              </FrameScope>
            </div>
            <div
              v-for="comment in pageComments.filter((c) => c.breakpointId === bp.id)"
              :key="comment.id"
              class="absolute"
              :style="{ left: `${comment.x}px`, top: `${comment.y}px` }"
            >
              <CommentMarker :comment="comment" :zoom="camera.zoom" />
            </div>
          </div>
          </div>
        </template>

        <div class="group flex w-40 items-center justify-center" @click.stop>
          <div
            v-if="canAddBreakpoint(breakpoints.length)"
            :style="{ transform: `scale(${1 / camera.zoom})` }"
          >
            <ButtonUI
              variant="outline"
              size="sm"
              :icon="Plus"
              tooltip="Add breakpoint"
              class="size-8 rounded-full bg-background opacity-0 shadow-md transition-opacity group-hover:opacity-100"
              @click="addBreakpoint(breakpoints.length)"
            />
          </div>
        </div>
      </div>

      <div
        v-for="comment in pageComments.filter((c) => !c.breakpointId && !c.anchor)"
        :key="comment.id"
        class="absolute"
        :style="{ left: `${comment.x}px`, top: `${comment.y}px` }"
      >
        <CommentMarker :comment="comment" :zoom="camera.zoom" />
      </div>
    </div>

    <CommentLayer :root="viewport ?? null" />

    <InsertDock />
  </div>
</template>
