<script setup lang="ts">
import { computed } from 'vue'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import TextareaUI from '@/components/ui/TextareaUI.vue'
import { usePage } from '@/composables/usePage'

const { activePage } = usePage()

// per-page JS bodies; empty prunes the field so untouched pages stay
// byte-identical (same discipline as the SEO/locale overrides)
function codeField(key: 'head' | 'body') {
  return computed<string>({
    get: () => activePage.value.customCode?.[key] ?? '',
    set: (value: string) => {
      const page = activePage.value
      const trimmed = value.trim()
      if (trimmed) {
        ;(page.customCode ??= {})[key] = value
      } else if (page.customCode) {
        delete page.customCode[key]
        if (!Object.keys(page.customCode).length) delete page.customCode
      }
    },
  })
}

const headCode = codeField('head')
const bodyCode = codeField('body')
</script>

<template>
  <GroupPopover label="Head">
    <TextareaUI v-model="headCode" :rows="6" class="font-mono" placeholder="// runs at the top of the page" />
  </GroupPopover>

  <GroupPopover label="Body">
    <TextareaUI v-model="bodyCode" :rows="6" class="font-mono" placeholder="// runs before </body>" />
  </GroupPopover>

  <GroupPopover>
    <p class="text-[10px] text-muted-foreground">
      Wrapped in &lt;script&gt; and injected into this page's export only — it does not run in the
      editor preview.
    </p>
  </GroupPopover>
</template>
