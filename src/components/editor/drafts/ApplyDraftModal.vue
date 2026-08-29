<script setup lang="ts">
// Review-and-apply flow for a draft: change summary, side-by-side conflict
// choices, then a success state offering to keep or delete the draft.
import { computed, onMounted, ref } from 'vue'
import { Check, CircleCheck, LoaderCircle } from 'lucide-vue-next'
import ModalDialog from '@/components/modal/ModalDialog.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import { useBranches } from '@/composables/useBranches'
import { changeSummaryLabel, hasChanges } from '@/lib/merge'
import type { ChangeSummary, MergeConflict, Resolution } from '@/lib/merge'
import type { BranchMeta } from '@/composables/useBranches'

const props = defineProps<{ branch: BranchMeta }>()
const emit = defineEmits<{ close: [] }>()

const { previewMerge, mergeIntoMain, deleteBranch, draftStatus, invalidateDraftStatus } =
  useBranches()

type Stage = 'loading' | 'review' | 'applying' | 'done'
const stage = ref<Stage>('loading')

const conflicts = ref<MergeConflict[]>([])
const choices = ref<Record<string, Resolution>>({})
const summary = ref<ChangeSummary | null>(null)

const summaryLabel = computed(() => (summary.value ? changeSummaryLabel(summary.value) : ''))
const isEmpty = computed(() => !!summary.value && !hasChanges(summary.value))

onMounted(async () => {
  const [result, status] = await Promise.all([
    previewMerge(props.branch.id),
    draftStatus(props.branch.id, { fresh: true }),
  ])
  if (!result) {
    emit('close')
    return
  }
  conflicts.value = result.conflicts
  // every conflict starts on the live site's side — the merge default
  choices.value = Object.fromEntries(result.conflicts.map((c) => [c.key, 'mine' as Resolution]))
  summary.value = status?.summary ?? null
  stage.value = 'review'
})

/** what picking each side of a conflict means, in draft language */
function sideHints(conflict: MergeConflict): { mine: string; theirs: string } {
  switch (conflict.kind) {
    case 'changed':
      return { mine: 'Keep the live version', theirs: 'Use the draft version' }
    case 'deleted-in-branch':
      return { mine: 'Keep it on the site', theirs: 'Delete it from the site' }
    case 'deleted-in-main':
      return { mine: 'Leave it deleted', theirs: 'Restore the draft version' }
  }
}

function conflictHint(conflict: MergeConflict): string {
  switch (conflict.kind) {
    case 'changed':
      return 'Edited in the draft and on the live site'
    case 'deleted-in-branch':
      return 'Deleted in the draft, edited on the live site'
    case 'deleted-in-main':
      return 'Deleted on the live site, edited in the draft'
  }
}

async function apply() {
  stage.value = 'applying'
  // apply with keep — the success step decides whether the draft survives
  const ok = await mergeIntoMain(props.branch.id, choices.value, { keep: true })
  if (!ok) {
    emit('close')
    return
  }
  stage.value = 'done'
}

async function deleteDraft() {
  await deleteBranch(props.branch.id)
  invalidateDraftStatus(props.branch.id)
  emit('close')
}
</script>

<template>
  <ModalDialog
    :title="stage === 'done' ? 'Draft merged' : `Merge “${branch.name}” into the site`"
    size="lg"
    @close="emit('close')"
  >
    <!-- loading -->
    <div v-if="stage === 'loading' || stage === 'applying'" class="flex items-center gap-2 py-6">
      <LoaderCircle class="size-4 animate-spin text-muted-foreground" />
      <p class="text-xs text-muted-foreground">
        {{ stage === 'applying' ? 'Merging the draft…' : 'Comparing with the live site…' }}
      </p>
    </div>

    <!-- review -->
    <template v-else-if="stage === 'review'">
      <div class="flex flex-col gap-1">
        <p class="text-xs text-muted-foreground">
          {{
            isEmpty
              ? 'This draft has no changes — merging it won’t modify the live site.'
              : 'These changes will be merged into the live site:'
          }}
        </p>
        <p v-if="summaryLabel" class="text-xs font-medium">{{ summaryLabel }}</p>
      </div>

      <template v-if="conflicts.length">
        <p class="mt-2 text-xs text-muted-foreground">
          {{ conflicts.length === 1 ? 'One item was' : `${conflicts.length} items were` }}
          edited in both places — choose which version to keep:
        </p>
        <div v-for="conflict in conflicts" :key="conflict.key" class="flex flex-col gap-1.5">
          <div class="flex flex-col">
            <p class="text-xs font-medium">{{ conflict.label }}</p>
            <p class="text-[10px] text-muted-foreground">{{ conflictHint(conflict) }}</p>
          </div>
          <div class="grid grid-cols-2 gap-1.5">
            <button
              v-for="side in ['mine', 'theirs'] as const"
              :key="side"
              class="flex cursor-pointer flex-col gap-0.5 rounded-lg border p-2.5 text-left transition-colors"
              :class="
                choices[conflict.key] === side
                  ? 'border-accent bg-accent/10'
                  : 'border-input hover:bg-muted/40'
              "
              @click="choices[conflict.key] = side"
            >
              <span class="flex items-center gap-1.5 text-xs font-medium">
                <Check
                  class="size-3 shrink-0"
                  :class="choices[conflict.key] === side ? 'opacity-100' : 'opacity-0'"
                />
                {{ side === 'mine' ? 'Live site' : 'This draft' }}
              </span>
              <span class="pl-4.5 text-[10px] text-muted-foreground">
                {{ sideHints(conflict)[side] }}
              </span>
            </button>
          </div>
        </div>
      </template>
    </template>

    <!-- success -->
    <template v-else-if="stage === 'done'">
      <div class="flex flex-col gap-2 py-2">
        <p class="flex items-center gap-1.5 text-xs font-medium text-success">
          <CircleCheck class="size-4" />
          “{{ branch.name }}” is now live.
        </p>
        <p class="text-xs text-muted-foreground">
          You’re back on the live site. Keep the draft to continue working in it, or delete it if
          you’re done.
        </p>
      </div>
    </template>

    <template #actions>
      <template v-if="stage === 'review'">
        <ButtonUI variant="outline" size="sm" @click="emit('close')">Cancel</ButtonUI>
        <ButtonUI variant="default" size="sm" @click="apply">Merge</ButtonUI>
      </template>
      <template v-else-if="stage === 'done'">
        <ButtonUI variant="outline" size="sm" @click="deleteDraft">Delete draft</ButtonUI>
        <ButtonUI variant="default" size="sm" @click="emit('close')">Keep draft</ButtonUI>
      </template>
    </template>
  </ModalDialog>
</template>
