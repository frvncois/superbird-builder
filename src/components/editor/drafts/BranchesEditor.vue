<script setup lang="ts">
// The Drafts panel: create/switch/discard drafts and launch the apply flow.
// A draft is a private copy of the project (a branch internally); applying
// it merges into Main via ApplyDraftModal.
import { onMounted, reactive, ref, watch } from 'vue'
import { GitBranch, Plus, TriangleAlert } from 'lucide-vue-next'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import ConfirmModal from '@/components/modal/ConfirmModal.vue'
import ApplyDraftModal from '@/components/editor/drafts/ApplyDraftModal.vue'
import { useBranches, MAIN_ID } from '@/composables/useBranches'
import { useDocumentation } from '@/composables/useDocumentation'
import { changeSummaryLabel, hasChanges } from '@/lib/merge'
import type { BranchMeta, DraftStatus } from '@/composables/useBranches'

const {
  branches,
  activeBranch,
  activeBranchId,
  onMain,
  createBranch,
  switchBranch,
  deleteBranch,
  draftStatus,
  invalidateDraftStatus,
} = useBranches()

const drafts = () => branches.value.filter((b) => b.id !== MAIN_ID)

// --- create form ---

const creating = ref(false)
const newName = ref('')

function create() {
  if (!newName.value.trim()) return
  createBranch(newName.value)
  newName.value = ''
  creating.value = false
}

// --- per-draft status (change summary + conflict count), loaded lazily ---

const statuses = reactive(new Map<string, DraftStatus>())

async function loadStatuses(fresh = false) {
  for (const draft of drafts()) {
    const status = await draftStatus(draft.id, { fresh })
    if (status) statuses.set(draft.id, status)
  }
}

onMounted(() => loadStatuses(true))
// switching drafts changes what "changed vs base" means for the one we left
watch(activeBranchId, () => loadStatuses(true))

function statusLine(id: string): string {
  const status = statuses.get(id)
  if (!status) return ''
  if (!hasChanges(status.summary)) return 'No changes yet'
  return `${changeSummaryLabel(status.summary)} changed`
}

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

// --- apply / discard flows ---

const applying = ref<BranchMeta | null>(null)
const discarding = ref<BranchMeta | null>(null)

function discardMessage(draft: BranchMeta): string {
  const status = statuses.get(draft.id)
  const changes =
    status && hasChanges(status.summary) ? ` and its changes (${changeSummaryLabel(status.summary)})` : ''
  return `This deletes “${draft.name}”${changes}. The live site is not affected.`
}

async function confirmDiscard() {
  if (!discarding.value) return
  await deleteBranch(discarding.value.id)
  invalidateDraftStatus(discarding.value.id)
  statuses.delete(discarding.value.id)
  discarding.value = null
}

function closeApply() {
  applying.value = null
  loadStatuses(true)
}
</script>

<template>
  <!-- where you are -->
  <GroupPopover>
    <div class="flex items-center gap-2">
      <GitBranch class="size-3.5 shrink-0" :class="onMain ? 'text-muted-foreground' : 'text-pending'" />
      <div class="min-w-0 flex-1">
        <p class="truncate text-xs font-medium">
          {{ onMain ? 'You’re on the live site' : `Editing “${activeBranch.name}”` }}
        </p>
        <p class="text-[10px] text-muted-foreground">
          {{ onMain ? 'Changes here go live when you publish.' : 'Changes stay private until you apply them.' }}
        </p>
      </div>
      <ButtonUI v-if="!onMain" variant="outline" size="sm" @click="switchBranch(MAIN_ID)">
        Back to site
      </ButtonUI>
    </div>
  </GroupPopover>

  <!-- drafts -->
  <GroupPopover v-if="drafts().length" label="Drafts">
    <div
      v-for="draft in drafts()"
      :key="draft.id"
      class="flex flex-col gap-1.5 rounded-md border p-2"
      :class="draft.id === activeBranchId ? 'border-accent' : 'border-input'"
    >
      <div class="flex flex-col gap-0.5">
        <div class="flex items-baseline justify-between gap-2">
          <span class="min-w-0 truncate text-xs font-medium">{{ draft.name }}</span>
          <span class="shrink-0 text-[10px] text-muted-foreground">{{ timeAgo(draft.createdAt) }}</span>
        </div>
        <p v-if="draft.description" class="text-[10px] text-muted-foreground">
          {{ draft.description }}
        </p>
        <p v-if="statusLine(draft.id)" class="text-[10px] text-muted-foreground">
          {{ statusLine(draft.id) }}
        </p>
        <p
          v-if="(statuses.get(draft.id)?.conflictCount ?? 0) > 0"
          class="flex items-center gap-1 text-[10px] text-pending"
        >
          <TriangleAlert class="size-3 shrink-0" />
          {{ statuses.get(draft.id)!.conflictCount }}
          {{ statuses.get(draft.id)!.conflictCount === 1 ? 'conflict' : 'conflicts' }} with the live site
        </p>
      </div>
      <div class="flex items-center gap-1.5">
        <ButtonUI
          v-if="draft.id !== activeBranchId"
          variant="outline"
          size="sm"
          class="flex-1"
          @click="switchBranch(draft.id)"
        >
          Open
        </ButtonUI>
        <ButtonUI variant="default" size="sm" class="flex-1" @click="applying = draft">
          Merge
        </ButtonUI>
        <ButtonUI
          variant="ghost"
          size="sm"
          class="text-muted-foreground hover:text-danger"
          @click="discarding = draft"
        >
          Discard
        </ButtonUI>
      </div>
    </div>
  </GroupPopover>

  <!-- empty state -->
  <GroupPopover v-else>
    <div class="flex flex-col items-center gap-2 py-4 text-center">
      <span class="flex size-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
        <GitBranch class="size-4" />
      </span>
      <p class="text-xs font-medium">No drafts yet</p>
      <p class="max-w-52 text-[10px] leading-4 text-muted-foreground">
        Drafts are private copies of the site. Try a redesign or prepare content, then apply it to
        the live site when it’s ready.
      </p>
      <ButtonUI
        variant="ghost"
        size="sm"
        class="text-muted-foreground"
        @click="useDocumentation().open('branches')"
      >
        Learn more
      </ButtonUI>
    </div>
  </GroupPopover>

  <!-- create: one inline row — name + confirm -->
  <GroupPopover>
    <ButtonUI
      v-if="!creating"
      variant="outline"
      size="sm"
      :icon="Plus"
      class="w-full"
      @click="creating = true"
    >
      New draft
    </ButtonUI>
    <div v-else class="flex items-center gap-1.5">
      <InputUI v-model="newName" placeholder="Draft name" @keydown.enter="create" />
      <ButtonUI variant="default" size="sm" :disabled="!newName.trim()" @click="create">
        Create
      </ButtonUI>
    </div>
  </GroupPopover>

  <ApplyDraftModal v-if="applying" :branch="applying" @close="closeApply" />
  <ConfirmModal
    v-if="discarding"
    title="Discard draft"
    :message="discardMessage(discarding)"
    confirm-label="Discard"
    @confirm="confirmDiscard"
    @close="discarding = null"
  />
</template>
