<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { Loader2, Send, Sparkles, Wrench } from 'lucide-vue-next'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { useAgent } from '@/composables/useAgent'
import { useBranches } from '@/composables/useBranches'

// The assistant pane — swaps in for the code editor via the Build view toggle.
// Chat drives POST /api/agent (see useAgent); tool activity renders as small
// progress rows between assistant messages.

const { items, busy, configured, checkConfigured, send } = useAgent()
const { activeBranch, onMain } = useBranches()

const draft = ref('')
const list = ref<HTMLElement | null>(null)

onMounted(() => {
  if (configured.value === null) checkConfigured()
})

// keep the newest message in view
watch(
  () => items.value.length,
  () => nextTick(() => list.value?.scrollTo({ top: list.value.scrollHeight })),
)

function submit() {
  const text = draft.value
  draft.value = ''
  send(text)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- not configured: point at Settings -->
    <div
      v-if="configured === false"
      class="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center"
    >
      <Sparkles class="size-5 text-muted-foreground" />
      <p class="text-xs font-medium">Assistant not set up</p>
      <p class="text-[10px] leading-relaxed text-muted-foreground">
        Add an Anthropic API key in<br />Settings → Access → AI assistant.
      </p>
    </div>

    <template v-else>
      <!-- conversation -->
      <div ref="list" class="flex-1 overflow-y-auto">
        <div class="flex flex-col gap-2 p-2">
          <p
            v-if="!items.length"
            class="px-2 pt-4 text-[10px] leading-relaxed text-muted-foreground"
          >
            Describe a change and the assistant edits the site with the same rules as the
            editor. Working on <span class="font-medium">{{ activeBranch.name }}</span
            ><template v-if="onMain"> — create a draft first if you want a safe sandbox</template>.
          </p>

          <template v-for="(item, i) in items" :key="i">
            <div
              v-if="item.kind === 'user'"
              class="ml-4 rounded-xl rounded-br-sm bg-primary px-3 py-2 text-xs text-primary-foreground"
            >
              {{ item.text }}
            </div>
            <div
              v-else-if="item.kind === 'assistant'"
              class="mr-2 rounded-xl rounded-bl-sm bg-accent/30 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap"
            >
              {{ item.text }}
            </div>
            <p
              v-else-if="item.kind === 'tool'"
              class="flex items-center gap-1.5 px-2 text-[10px] text-muted-foreground"
            >
              <Wrench class="size-3 shrink-0" /> {{ item.label }}
            </p>
            <p v-else class="px-2 text-[10px] text-danger">{{ item.text }}</p>
          </template>

          <p v-if="busy" class="flex items-center gap-1.5 px-2 text-[10px] text-muted-foreground">
            <Loader2 class="size-3 shrink-0 animate-spin" /> Working…
          </p>
        </div>
      </div>

      <!-- composer -->
      <div class="border-t border-input p-2">
        <div class="flex items-end gap-1.5">
          <textarea
            v-model="draft"
            rows="2"
            placeholder="Ask for a change…"
            class="flex-1 resize-none rounded-xl border border-input bg-transparent px-3 py-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-accent"
            :disabled="busy"
            @keydown="onKeydown"
          />
          <ButtonUI variant="icon" size="sm" :icon="Send" :disabled="busy || !draft.trim()" tooltip="Send" @click="submit" />
        </div>
      </div>
    </template>
  </div>
</template>
