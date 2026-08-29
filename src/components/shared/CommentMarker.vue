<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Check, CornerDownLeft, MessageCircle, Trash2 } from 'lucide-vue-next'
import HostPopover from '@/components/popover/HostPopover.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import { useComments } from '@/composables/useComments'
import { timeAgo } from '@/lib/time'
import type { Comment } from '@/types/editor'

const props = defineProps<{
  comment: Comment
  /** canvas zoom, countered so pins keep a constant screen size */
  zoom: number
}>()

const { activeCommentId, openComment, removeComment, toggleResolved, reply } = useComments()

const open = computed(() => activeCommentId.value === props.comment.id)
const draft = ref('')

function submit() {
  if (!draft.value.trim()) return
  // the first message becomes the comment itself, the rest are replies
  if (!props.comment.text) props.comment.text = draft.value.trim()
  else reply(props.comment.id, draft.value)
  draft.value = ''
}

function close() {
  // discard pins that never got any text
  if (!props.comment.text && !props.comment.replies.length) removeComment(props.comment.id)
  else openComment(null)
}

function toggle() {
  if (open.value) close()
  else openComment(props.comment.id)
}

// Escape closes the open thread. Only the open marker reacts, and it stops
// propagation so a single Escape doesn't also trip other handlers.
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) {
    e.stopPropagation()
    close()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    class="origin-top-left"
    :class="open ? 'relative z-20' : 'z-10'"
    :style="{ transform: `scale(${1 / zoom})` }"
    @click.stop
    @pointerdown.stop
  >
    <button
      class="flex size-7 cursor-pointer items-center justify-center rounded-full rounded-bl-none border-2 border-white shadow-md"
      :class="comment.resolved ? 'bg-muted-foreground' : 'bg-sky-500'"
      :title="comment.text || 'Comment'"
      @click="toggle"
    >
      <component :is="comment.resolved ? Check : MessageCircle" class="size-3.5 text-white" />
    </button>

    <HostPopover v-if="open" title="Comment" class="absolute top-0 left-9" @close="close">
      <div class="flex flex-col gap-3 p-3">
        <div v-if="comment.text" class="flex flex-col gap-0.5">
          <p class="text-xs font-medium">{{ comment.author }} says:</p>
          <p class="text-xs">{{ comment.text }}</p>
          <p class="text-[10px] text-muted-foreground">Posted {{ timeAgo(comment.createdAt) }}</p>
        </div>

        <div
          v-for="r in comment.replies"
          :key="r.id"
          class="flex flex-col gap-0.5 border-l-2 border-input pl-2"
        >
          <p class="text-xs font-medium">{{ r.author }} says:</p>
          <p class="text-xs">{{ r.text }}</p>
          <p class="text-[10px] text-muted-foreground">Posted {{ timeAgo(r.createdAt) }}</p>
        </div>

        <div class="relative">
          <InputUI
            v-model="draft"
            class="!pr-7"
            :placeholder="comment.text ? 'Reply…' : 'Add a comment…'"
            @keydown.enter="submit"
          />
          <button
            class="absolute top-1/2 right-1.5 -translate-y-1/2 cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
            title="Press Enter to post"
            @click="submit"
          >
            <CornerDownLeft class="size-3.5" />
          </button>
        </div>

        <div class="flex items-center gap-1">
          <ButtonUI
            variant="outline"
            size="sm"
            :icon="Check"
            class="flex-1"
            @click="toggleResolved(comment.id)"
          >
            {{ comment.resolved ? 'Unresolve' : 'Resolve' }}
          </ButtonUI>
          <ButtonUI
            variant="outline"
            size="sm"
            :icon="Trash2"
            class="flex-1"
            @click="removeComment(comment.id)"
          >
            Delete
          </ButtonUI>
        </div>
      </div>
    </HostPopover>
  </div>
</template>
