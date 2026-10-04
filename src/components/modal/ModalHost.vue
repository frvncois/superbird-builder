<script setup lang="ts">
type Size = 'sm' | 'default' | 'lg' | 'xl' | 'full'

withDefaults(
  defineProps<{
    size?: Size
  }>(),
  { size: 'default' },
)

const emit = defineEmits<{
  close: []
}>()

const sizes: Record<Size, string> = {
  sm: 'w-80',
  default: 'w-[28rem]',
  lg: 'w-[40rem]',
  // xl is a fixed-size, two-pane dialog that manages its own inner scrolling
  xl: 'w-[840px] h-[660px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)]',
  // full is a near-viewport surface (media library) that manages its own inner scrolling
  full: 'w-[min(92vw,1200px)] h-[88vh]',
}

// Escape is handled centrally by ModalStackHost (top-of-stack only)
</script>

<template>
  <div
    class="fixed inset-0 z-100 flex items-center justify-center bg-accent/25 backdrop-blur-sm"
    @click.self="$emit('close')"
  >
    <div
      class="modal-panel rounded-2xl bg-background shadow-lg"
      :class="[
        sizes[size],
        size === 'xl' || size === 'full' ? 'overflow-auto' : 'max-h-[85vh] overflow-y-auto',
      ]"
    >
      <slot />
    </div>
  </div>
</template>

<!-- unscoped on purpose: the transition classes are applied by the stack
     host's TransitionGroup to this component's ROOT, and a scoped rule could
     not reach the panel inside it. Same curve as the popover's pop. -->
<style>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.18s ease;
}
.modal-enter-active .modal-panel,
.modal-leave-active .modal-panel {
  transition:
    transform 0.22s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.18s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .modal-panel,
.modal-leave-to .modal-panel {
  transform: scale(0.96) translateY(6px);
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .modal-enter-active,
  .modal-leave-active,
  .modal-enter-active .modal-panel,
  .modal-leave-active .modal-panel {
    transition: none;
  }
}
</style>
