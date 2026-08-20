<script setup lang="ts">
import { ref } from 'vue'
import { Check, GitBranch, GitMerge, Plus, Trash2 } from 'lucide-vue-next'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import { useBranches, MAIN_ID } from '@/composables/useBranches'
import type { MergeConflict, Resolution } from '@/lib/merge'

const { branches, activeBranch, activeBranchId, createBranch, switchBranch, deleteBranch, previewMerge, mergeIntoMain } =
  useBranches()

const newName = ref('')

const merging = ref<{
  id: string
  name: string
  conflicts: MergeConflict[]
  choices: Record<string, Resolution>
} | null>(null)

const RESOLUTIONS = [
  { label: 'Keep Main', value: 'mine' },
  { label: 'Take branch', value: 'theirs' },
]

function create() {
  if (!newName.value.trim()) return
  createBranch(newName.value)
  newName.value = ''
}

async function startMerge(id: string, name: string) {
  const result = await previewMerge(id)
  if (!result) return
  if (!result.conflicts.length) {
    await mergeIntoMain(id, {})
    return
  }
  merging.value = {
    id,
    name,
    conflicts: result.conflicts,
    choices: Object.fromEntries(result.conflicts.map((c) => [c.key, 'mine' as Resolution])),
  }
}

async function applyMerge() {
  if (!merging.value) return
  await mergeIntoMain(merging.value.id, merging.value.choices)
  merging.value = null
}

function conflictHint(conflict: MergeConflict): string {
  switch (conflict.kind) {
    case 'changed':
      return 'Edited on both sides'
    case 'deleted-in-branch':
      return 'Deleted in branch, edited on Main'
    case 'deleted-in-main':
      return 'Deleted on Main, edited in branch'
  }
}
</script>

<template>
  <template v-if="!merging">
    <GroupPopover label="Current branch">
      <p class="flex items-center gap-1.5 text-xs font-medium">
        <GitBranch class="size-3.5 text-muted-foreground" />
        {{ activeBranch.name }}
      </p>
      <div class="flex items-center gap-1.5">
        <InputUI v-model="newName" placeholder="New branch name…" @keydown.enter="create" />
        <ButtonUI
          variant="outline"
          size="sm"
          :icon="Plus"
          title="Branch from here"
          :disabled="!newName.trim()"
          @click="create"
        />
      </div>
    </GroupPopover>

    <GroupPopover label="Branches">
      <div
        v-for="branch in branches"
        :key="branch.id"
        class="flex items-center gap-1 rounded-md border p-1.5 pl-2"
        :class="branch.id === activeBranchId ? 'border-accent' : 'border-input'"
      >
        <span class="min-w-0 flex-1 truncate text-xs font-medium">{{ branch.name }}</span>
        <Check v-if="branch.id === activeBranchId" class="size-3.5 shrink-0 text-muted-foreground" />
        <ButtonUI
          v-else
          variant="ghost"
          size="sm"
          class="h-6 px-1.5"
          @click="switchBranch(branch.id)"
        >
          Switch
        </ButtonUI>
        <ButtonUI
          v-if="branch.id !== MAIN_ID"
          variant="icon"
          size="sm"
          :icon="GitMerge"
          title="Merge into Main"
          class="w-6 text-muted-foreground"
          @click="startMerge(branch.id, branch.name)"
        />
        <ButtonUI
          v-if="branch.id !== MAIN_ID"
          variant="icon"
          size="sm"
          :icon="Trash2"
          title="Delete branch"
          class="w-6 text-muted-foreground"
          @click="deleteBranch(branch.id)"
        />
      </div>
    </GroupPopover>
  </template>

  <template v-else>
    <GroupPopover :label="`Merging ${merging.name} into Main`">
      <p class="text-xs text-muted-foreground">
        These changed on both sides — pick which version to keep.
      </p>
      <div v-for="conflict in merging.conflicts" :key="conflict.key" class="flex flex-col gap-1">
        <p class="text-xs font-medium">{{ conflict.label }}</p>
        <p class="text-[10px] text-muted-foreground">{{ conflictHint(conflict) }}</p>
        <SelectUI v-model="merging.choices[conflict.key]" :options="RESOLUTIONS" />
      </div>
      <div class="flex items-center gap-1.5 pt-1">
        <ButtonUI variant="default" size="sm" :icon="GitMerge" class="flex-1" @click="applyMerge">
          Merge
        </ButtonUI>
        <ButtonUI variant="outline" size="sm" class="flex-1" @click="merging = null">
          Cancel
        </ButtonUI>
      </div>
    </GroupPopover>
  </template>
</template>
