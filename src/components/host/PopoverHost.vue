<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, toValue, unref, watch } from 'vue'
import HostPopover from '@/components/popover/HostPopover.vue'
import { usePopover } from '@/composables/usePopover'
import { useModal } from '@/composables/useModal'
import { useInsertDrag } from '@/composables/useInsertDrag'
import { computeFloatingPosition } from '@/lib/floating'

const { current, closePopover } = usePopover()
const { stack: modalStack } = useModal()
const { payload: insertDrag, suppressNextClick } = useInsertDrag()

const panelEl = ref<HTMLElement>()
const style = ref<{ left: string; top: string; visibility: 'hidden' | 'visible' }>({
  left: '0px',
  top: '0px',
  visibility: 'hidden',
})

// rAF loop: the anchor moves under us (canvas pan/zoom, scrolling), so track
// its live rect every frame and only write style when the position changes
// (CommentLayer pattern). getBoundingClientRect is immune to ancestor
// transforms, so zoomed-canvas anchors need no special math.
let raf = 0
let last = ''
function track() {
  raf = 0
  const state = current.value
  const el = panelEl.value
  if (!state) return
  if (!state.anchor.isConnected) {
    closePopover()
    return
  }
  if (el) {
    const { left, top } = computeFloatingPosition(
      state.anchor.getBoundingClientRect(),
      { width: el.offsetWidth, height: el.offsetHeight },
      { placement: state.placement, offset: 8 },
    )
    const key = `${left},${top}`
    if (key !== last) {
      last = key
      style.value = { left: `${left}px`, top: `${top}px`, visibility: 'visible' }
    }
  }
  raf = requestAnimationFrame(track)
}

watch(current, async (state) => {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  last = ''
  if (!state) return
  // render hidden for one frame so the panel can be measured before placing
  style.value = { left: '0px', top: '0px', visibility: 'hidden' }
  await nextTick()
  track()
})

// Escape closes the popover unless a modal is above it, a palette drag is
// being cancelled, or the popover opted out (the sidebar panel owns its own
// Escape → close + refocus-editor flow)
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  const state = current.value
  if (!state || state.closeOnEscape === false) return
  if (modalStack.value.length || insertDrag.value) return
  closePopover()
}

// outside-click close is opt-in; the release click of a palette drag never counts
function onDocClick(e: MouseEvent) {
  const state = current.value
  if (!state?.closeOnOutside) return
  if (suppressNextClick.value) return
  const t = e.target as Node
  if (panelEl.value?.contains(t) || state.anchor.contains(t)) return
  closePopover()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('click', onDocClick)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('click', onDocClick)
  if (raf) cancelAnimationFrame(raf)
})
</script>

<template>
  <div v-if="current" ref="panelEl" class="fixed z-50" :style="style">
    <!-- icon resolves via unref, not toValue — a lucide icon is a bare
         function and toValue would call it (→ "slots of undefined" crash) -->
    <HostPopover :title="toValue(current.title)" :icon="unref(current.icon)" @close="closePopover()">
      <component :is="current.component" v-bind="current.props" />
    </HostPopover>
  </div>
</template>
