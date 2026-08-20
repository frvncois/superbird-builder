<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Code,
  Globe,
  LogOut,
  Mail,
  Palette,
  Plus,
  Rocket,
  Search,
  Settings2,
  Trash2,
  Type,
} from 'lucide-vue-next'
import TabsUI from '@/components/tabs/TabsUI.vue'
import TabUI from '@/components/tabs/TabUI.vue'
import TabPanelUI from '@/components/tabs/TabPanelUI.vue'
import GroupPopover from '@/components/popover/GroupPopover.vue'
import RowUI from '@/components/ui/RowUI.vue'
import InputUI from '@/components/ui/InputUI.vue'
import SelectUI from '@/components/ui/SelectUI.vue'
import TextareaUI from '@/components/ui/TextareaUI.vue'
import UploadUI from '@/components/ui/UploadUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import BadgeUI from '@/components/ui/BadgeUI.vue'
import ColorPickerUI from '@/components/ui/ColorPickerUI.vue'
import { useProject } from '@/composables/useProject'
import { useSettings } from '@/composables/useSettings'
import { useLocale } from '@/composables/useLocale'
import { usePage } from '@/composables/usePage'
import { usePublish } from '@/composables/usePublish'
import { useAuth } from '@/composables/useAuth'
import { FONT_STACKS, tokenNameError } from '@/lib/settings'
import { timeAgo } from '@/lib/time'

const { project, renameProject } = useProject()
const { settings, addToken, removeToken } = useSettings()
const { locales, defaultLocale, addLocale, removeLocale, setDefaultLocale } = useLocale()
const { pages, activePage } = usePage()
const { publishedInfo, markPublished } = usePublish()
const { email: authEmail, logout } = useAuth()

// --- modal open/close (controlled by the parent; Esc + backdrop close) ---

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

function onKeydown(e: KeyboardEvent) {
  if (props.open && e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

const active = ref('general')

const TABS = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'seo', label: 'SEO', icon: Search },
  { id: 'tokens', label: 'Tokens', icon: Palette },
  { id: 'fonts', label: 'Fonts', icon: Type },
  { id: 'code', label: 'Code', icon: Code },
  { id: 'domain', label: 'Domain', icon: Globe },
  { id: 'smtp', label: 'SMTP', icon: Mail },
  { id: 'publishing', label: 'Publishing', icon: Rocket },
]

// --- general ---

const projectName = computed({
  get: () => project.value.name,
  set: (v: string) => renameProject(v),
})

const favicon = computed({
  get: () => settings.value.favicon ?? '',
  set: (v: string) => (settings.value.favicon = v || undefined),
})

const newLocale = ref('')
function onAddLocale() {
  if (addLocale(newLocale.value)) newLocale.value = ''
}

const localeOptions = computed(() => locales.value.map((l) => ({ label: l, value: l })))

// --- seo ---

const ogImage = computed({
  get: () => settings.value.seo.ogImage ?? '',
  set: (v: string) => (settings.value.seo.ogImage = v || undefined),
})

const seoPageId = ref(activePage.value.id)
const seoPage = computed(() => pages.value.find((p) => p.id === seoPageId.value))
const pageOptions = computed(() => pages.value.map((p) => ({ label: p.name, value: p.id })))

// per-page overrides: empty values delete keys so untouched pages stay
// byte-identical (same discipline as locale overrides)
function pageSeoField(key: 'title' | 'description') {
  return computed({
    get: () => seoPage.value?.seo?.[key] ?? '',
    set: (v: string) => {
      const page = seoPage.value
      if (!page) return
      if (v) {
        ;(page.seo ??= {})[key] = v
      } else if (page.seo) {
        delete page.seo[key]
        if (!Object.keys(page.seo).length) delete page.seo
      }
    },
  })
}
const pageSeoTitle = pageSeoField('title')
const pageSeoDescription = pageSeoField('description')

// --- tokens ---

const tokenError = (id: string, name: string) =>
  tokenNameError(
    name,
    settings.value.tokens.filter((t) => t.id !== id),
  )

// --- fonts ---

const fontOptions = [{ label: 'Default', value: '' }, ...FONT_STACKS]

const googleFontsUrl = computed({
  get: () => settings.value.fonts.googleFontsUrl ?? '',
  set: (v: string) => (settings.value.fonts.googleFontsUrl = v.trim() || undefined),
})

// --- domain ---

function normalizeDomain() {
  settings.value.domain = settings.value.domain
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
}

// --- publishing ---

const republishing = ref(false)
const republishError = ref<string | null>(null)
async function republish() {
  republishing.value = true
  republishError.value = null
  try {
    await markPublished()
  } catch (e) {
    republishError.value = e instanceof Error ? e.message : 'Publish failed'
  } finally {
    republishing.value = false
  }
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-100 flex items-center justify-center bg-black/50"
    @click.self="emit('close')"
  >
    <div
      class="flex h-[460px] w-[640px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-input bg-background shadow-lg"
    >
      <TabsUI v-model:active="active" class="flex h-full min-w-0 flex-1 !flex-row !gap-0">
        <!-- left sidebar: vertical tab nav -->
        <div class="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-input p-2">
          <div class="px-1 pb-1 text-xs font-medium text-foreground">Settings</div>
          <TabUI v-for="tab in TABS" :key="tab.id" :id="tab.id" class="!w-full">
            <span class="flex items-center gap-2">
              <component :is="tab.icon" class="size-3.5 shrink-0" />
              {{ tab.label }}
            </span>
          </TabUI>
        </div>

        <!-- right pane: panel content -->
        <div class="min-w-0 flex-1 overflow-y-auto p-1">
          <TabPanelUI id="general">
            <GroupPopover label="Project">
              <RowUI label="Name">
                <InputUI v-model="projectName" placeholder="Untitled project" />
              </RowUI>
              <RowUI label="Favicon">
                <UploadUI v-model="favicon" accept="image/png,image/svg+xml,image/x-icon" />
              </RowUI>
            </GroupPopover>
            <GroupPopover label="Account">
              <p class="text-xs text-muted-foreground">{{ authEmail }}</p>
              <ButtonUI variant="outline" size="sm" :icon="LogOut" class="w-full" @click="logout">
                Sign out
              </ButtonUI>
            </GroupPopover>
            <GroupPopover label="Locales">
              <RowUI label="Default">
                <SelectUI
                  :model-value="defaultLocale"
                  :options="localeOptions"
                  @update:model-value="(v) => v && setDefaultLocale(v)"
                />
              </RowUI>
              <p class="text-[10px] text-muted-foreground">
                Changing the default does not move content between locales.
              </p>
              <div class="flex flex-wrap gap-1">
                <BadgeUI
                  v-for="l in locales"
                  :key="l"
                  :removable="l !== defaultLocale"
                  @remove="removeLocale(l)"
                >
                  {{ l }}
                </BadgeUI>
              </div>
              <div class="flex gap-1.5">
                <InputUI v-model="newLocale" placeholder="e.g. fr" @keydown.enter="onAddLocale" />
                <ButtonUI variant="outline" size="sm" :icon="Plus" @click="onAddLocale">Add</ButtonUI>
              </div>
            </GroupPopover>
          </TabPanelUI>

          <TabPanelUI id="seo">
            <GroupPopover label="Site defaults">
              <RowUI label="Site name">
                <InputUI v-model="settings.seo.siteName" placeholder="My Site" />
              </RowUI>
              <RowUI label="Title">
                <InputUI v-model="settings.seo.titleTemplate" placeholder="%s — My Site" class="font-mono" />
              </RowUI>
              <p class="text-[10px] text-muted-foreground">%s = page name</p>
              <TextareaUI v-model="settings.seo.description" placeholder="Site description" :rows="2" />
              <RowUI label="OG image">
                <UploadUI v-model="ogImage" />
              </RowUI>
            </GroupPopover>
            <GroupPopover label="Per page">
              <RowUI label="Page">
                <SelectUI v-model="seoPageId" :options="pageOptions" />
              </RowUI>
              <RowUI label="Title">
                <InputUI v-model="pageSeoTitle" placeholder="Overrides the template" />
              </RowUI>
              <TextareaUI v-model="pageSeoDescription" placeholder="Page description" :rows="2" />
            </GroupPopover>
          </TabPanelUI>

          <TabPanelUI id="tokens">
            <GroupPopover label="Design tokens">
              <div v-for="token in settings.tokens" :key="token.id" class="flex flex-col gap-0.5">
                <div class="flex items-center gap-1.5">
                  <InputUI v-model="token.name" placeholder="brand" class="font-mono" />
                  <ColorPickerUI v-model="token.value" />
                  <ButtonUI variant="ghost" size="xs" :icon="Trash2" @click="removeToken(token.id)" />
                </div>
                <p v-if="tokenError(token.id, token.name)" class="text-[10px] text-danger">
                  {{ tokenError(token.id, token.name) }}
                </p>
              </div>
              <ButtonUI variant="outline" size="sm" :icon="Plus" class="w-full" @click="addToken()">
                Add token
              </ButtonUI>
              <p class="text-[10px] text-muted-foreground">
                Use as bg-&lt;name&gt;, text-&lt;name&gt;, border-&lt;name&gt;
              </p>
            </GroupPopover>
          </TabPanelUI>

          <TabPanelUI id="fonts">
            <GroupPopover label="Typography">
              <RowUI label="Font">
                <SelectUI v-model="settings.fonts.family" :options="fontOptions" />
              </RowUI>
              <InputUI v-model="settings.fonts.family" placeholder="font-family value" class="font-mono" />
              <RowUI label="Google">
                <InputUI v-model="googleFontsUrl" placeholder="https://fonts.googleapis.com/css2?…" class="font-mono" />
              </RowUI>
            </GroupPopover>
          </TabPanelUI>

          <TabPanelUI id="code">
            <GroupPopover label="Custom head code">
              <TextareaUI v-model="settings.customCode.head" :rows="8" class="font-mono" placeholder="Scripts, meta tags, styles…" />
              <p class="text-[10px] text-muted-foreground">
                Raw HTML injected into &lt;head&gt; of exported pages. Runs with full access to your
                published site.
              </p>
            </GroupPopover>
          </TabPanelUI>

          <TabPanelUI id="domain">
            <GroupPopover label="Domain">
              <RowUI label="Domain">
                <InputUI v-model="settings.domain" placeholder="example.com" class="font-mono" @blur="normalizeDomain" />
              </RowUI>
              <p class="text-[10px] text-muted-foreground">
                Used for canonical and social URLs in the published site.
              </p>
            </GroupPopover>
          </TabPanelUI>

          <TabPanelUI id="smtp">
            <GroupPopover label="SMTP">
              <RowUI label="Host"><InputUI v-model="settings.smtp.host" placeholder="smtp.example.com" /></RowUI>
              <RowUI label="Port"><InputUI v-model="settings.smtp.port" placeholder="587" /></RowUI>
              <RowUI label="User"><InputUI v-model="settings.smtp.user" /></RowUI>
              <RowUI label="Password"><InputUI v-model="settings.smtp.password" type="password" /></RowUI>
              <RowUI label="From"><InputUI v-model="settings.smtp.from" placeholder="hello@example.com" /></RowUI>
              <p class="text-[10px] text-muted-foreground">
                Stored with the project for future use — not verified or used yet.
              </p>
            </GroupPopover>
          </TabPanelUI>

          <TabPanelUI id="publishing">
            <GroupPopover label="Publishing">
              <template v-if="publishedInfo">
                <p class="text-xs">Last published {{ timeAgo(publishedInfo.publishedAt) }}</p>
                <p class="text-[10px] text-muted-foreground">
                  {{ publishedInfo.routes }} routes · {{ Math.round(publishedInfo.bytes / 1024) }} KB
                </p>
              </template>
              <p v-else class="text-xs text-muted-foreground">Never published yet.</p>
              <ButtonUI
                variant="outline"
                size="sm"
                :icon="Rocket"
                class="w-full"
                :disabled="republishing"
                @click="republish"
              >
                {{ republishing ? 'Publishing…' : 'Republish' }}
              </ButtonUI>
              <p v-if="republishError" class="text-[10px] text-danger">{{ republishError }}</p>
            </GroupPopover>
          </TabPanelUI>
        </div>
      </TabsUI>
    </div>
  </div>
</template>
