<script setup lang="ts">
import { Rocket } from 'lucide-vue-next'
import BadgeUI from '@/components/ui/BadgeUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import PublishDialog from '@/components/shared/PublishDialog.vue'
import { usePersistence, SAVE_STATES } from '@/composables/usePersistence'
import { usePublish } from '@/composables/usePublish'
import { useModal } from '@/composables/useModal'
import { usePopover } from '@/composables/usePopover'

const { status, saveNow } = usePersistence()
const { hasUnpublishedChanges } = usePublish()
const { openModal } = useModal()
const { closePopover } = usePopover()

// the popover closes before the dialog opens — one floating layer at a time
function publish() {
  closePopover()
  openModal(PublishDialog)
}
</script>

<template>
  <div class="flex w-56 flex-col gap-2">
    <div class="flex flex-wrap items-center gap-1.5">
      <BadgeUI v-tooltip="SAVE_STATES[status].label">
        <span class="size-1.5 rounded-full" :class="SAVE_STATES[status].dot" />
        {{ SAVE_STATES[status].short }}
      </BadgeUI>
      <BadgeUI
        v-tooltip="hasUnpublishedChanges ? 'Main has unpublished changes' : 'Everything is published'"
      >
        <span
          class="size-1.5 rounded-full"
          :class="hasUnpublishedChanges ? 'bg-pending' : 'bg-success'"
        />
        {{ hasUnpublishedChanges ? 'Unpublished changes' : 'Published' }}
      </BadgeUI>
      <ButtonUI
        v-if="status === 'error'"
        variant="outline" size="sm"
        class="ml-auto"
        @click="saveNow"
      >
        Retry
      </ButtonUI>
    </div>
    <ButtonUI
      variant="default" size="sm" :icon="Rocket"
      class="w-full justify-center"
      @click="publish"
    >
      Publish
    </ButtonUI>
  </div>
</template>
