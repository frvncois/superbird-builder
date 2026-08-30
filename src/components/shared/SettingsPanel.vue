<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Code,
  Globe,
  LogOut,
  Palette,
  Plus,
  Rocket,
  Search,
  Settings2,
  Trash2,
  Users,
} from 'lucide-vue-next'
import ModalHost from '@/components/modal/ModalHost.vue'
import ConfirmModal from '@/components/modal/ConfirmModal.vue'
import TabsUI from '@/components/tabs/TabsUI.vue'
import TabUI from '@/components/tabs/TabUI.vue'
import TabPanelUI from '@/components/tabs/TabPanelUI.vue'
import SettingsGroup from '@/components/shared/SettingsGroup.vue'
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
import UsersSettings from '@/components/shared/UsersSettings.vue'
import { FONT_STACKS, tokenNameError } from '@/lib/settings'
import { timeAgo } from '@/lib/time'
import { formatBytes } from '@/lib/media'

const { project, renameProject } = useProject()
const { settings, addToken, removeToken } = useSettings()
const { locales, defaultLocale, addLocale, deleteLocale, setDefaultLocale } = useLocale()
const confirmingLocale = ref<string | null>(null)
const { pages, activePage } = usePage()
const { publishedInfo, markPublished } = usePublish()
const { email: authEmail, isAdmin, canBuild, logout } = useAuth()

// --- modal open/close (controlled by the parent; Esc + backdrop close
// handled by ModalHost) ---

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const active = ref('general')

// --- nav: sections under Project / Site / Admin group headings; the Admin
// group is hidden entirely for non-admins ---

const NAV = computed(() => {
  const groups = [
    {
      label: 'Project',
      items: [
        { id: 'general', label: 'General', icon: Settings2 },
        { id: 'design', label: 'Design', icon: Palette },
      ],
    },
    {
      label: 'Site',
      items: [
        { id: 'seo', label: 'SEO', icon: Search },
        { id: 'site', label: 'Site', icon: Globe },
      ],
    },
  ]
  if (isAdmin.value)
    groups.push({
      label: 'Admin',
      items: [
        { id: 'users', label: 'Users', icon: Users },
        { id: 'advanced', label: 'Advanced', icon: Code },
      ],
    })
  return groups
})

// if the active section disappears (e.g. role loads after mount), fall back
watch(NAV, (nav) => {
  if (!nav.some((g) => g.items.some((i) => i.id === active.value))) active.value = 'general'
})

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

// --- design ---

const tokenError = (id: string, name: string) =>
  tokenNameError(
    name,
    settings.value.tokens.filter((t) => t.id !== id),
  )

const fontOptions = [{ label: 'Default', value: '' }, ...FONT_STACKS]

const googleFontsUrl = computed({
  get: () => settings.value.fonts.googleFontsUrl ?? '',
  set: (v: string) => (settings.value.fonts.googleFontsUrl = v.trim() || undefined),
})

// --- site ---

function normalizeDomain() {
  settings.value.domain = settings.value.domain
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
}

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
  <ModalHost v-if="open" size="xl" @close="emit('close')">
    <TabsUI v-model:active="active" class="flex h-full min-w-0 flex-1 !flex-row !gap-0">
      <!-- left sidebar: grouped nav + pinned account footer -->
      <div class="flex w-48 shrink-0 flex-col border-r border-input">
        <nav class="flex flex-1 flex-col gap-3 overflow-y-auto p-2">
          <div v-for="group in NAV" :key="group.label" class="flex flex-col gap-0.5">
            <p class="px-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              {{ group.label }}
            </p>
            <TabUI v-for="item in group.items" :key="item.id" :id="item.id" class="!w-full !text-left">
              <span class="flex items-center gap-2">
                <component :is="item.icon" class="size-3.5 shrink-0" />
                {{ item.label }}
              </span>
            </TabUI>
          </div>
        </nav>
        <!-- account / danger zone -->
        <div class="flex flex-col gap-1.5 border-t border-input p-3">
          <p class="truncate text-[10px] text-muted-foreground" :title="authEmail ?? ''">
            {{ authEmail }}
          </p>
          <ButtonUI variant="outline" size="xs" :icon="LogOut" class="w-full !text-danger" @click="logout">
            Sign out
          </ButtonUI>
        </div>
      </div>

      <!-- right pane: section content -->
      <div class="min-w-0 flex-1 overflow-y-auto">
        <div class="flex flex-col gap-4 p-5">
          <TabPanelUI class="gap-4" id="general">
            <SettingsGroup title="Project" description="How your project shows up in the editor and in browser tabs.">
              <RowUI label="Name">
                <InputUI v-model="projectName" placeholder="Untitled project" />
              </RowUI>
              <RowUI label="Favicon">
                <UploadUI v-model="favicon" accept="image/png,image/svg+xml,image/x-icon" />
              </RowUI>
            </SettingsGroup>
            <SettingsGroup
              title="Locales"
              description="Languages your site is translated into. Changing the default does not move content between locales."
            >
              <RowUI label="Default">
                <SelectUI
                  :model-value="defaultLocale"
                  :options="localeOptions"
                  @update:model-value="(v) => v && setDefaultLocale(v)"
                />
              </RowUI>
              <div class="flex flex-wrap gap-1">
                <BadgeUI
                  v-for="l in locales"
                  :key="l"
                  :removable="l !== defaultLocale"
                  @remove="confirmingLocale = l"
                >
                  {{ l }}
                </BadgeUI>
              </div>
              <div class="flex gap-1.5">
                <InputUI v-model="newLocale" placeholder="e.g. fr" @keydown.enter="onAddLocale" />
                <ButtonUI variant="outline" size="sm" :icon="Plus" @click="onAddLocale">Add</ButtonUI>
              </div>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI class="gap-4" id="design">
            <SettingsGroup
              title="Design tokens"
              description="Project colors, usable in classes as bg-<name>, text-<name>, border-<name>."
            >
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
            </SettingsGroup>
            <SettingsGroup title="Typography" description="The site-wide font. Pick a stack or paste any font-family value.">
              <RowUI label="Font">
                <SelectUI v-model="settings.fonts.family" :options="fontOptions" />
              </RowUI>
              <InputUI v-model="settings.fonts.family" placeholder="font-family value" class="font-mono" />
              <RowUI label="Google">
                <InputUI
                  v-model="googleFontsUrl"
                  placeholder="https://fonts.googleapis.com/css2?…"
                  class="font-mono"
                />
              </RowUI>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI class="gap-4" id="seo">
            <SettingsGroup
              title="Site defaults"
              description="Used on every page unless a page overrides them. %s in the title template is replaced by the page name."
            >
              <RowUI label="Site name">
                <InputUI v-model="settings.seo.siteName" placeholder="My Site" />
              </RowUI>
              <RowUI label="Title">
                <InputUI v-model="settings.seo.titleTemplate" placeholder="%s — My Site" class="font-mono" />
              </RowUI>
              <TextareaUI v-model="settings.seo.description" placeholder="Site description" :rows="2" />
              <RowUI label="OG image">
                <UploadUI v-model="ogImage" />
              </RowUI>
            </SettingsGroup>
            <SettingsGroup title="Per page" description="Override the defaults for a single page.">
              <RowUI label="Page">
                <SelectUI v-model="seoPageId" :options="pageOptions" />
              </RowUI>
              <RowUI label="Title">
                <InputUI v-model="pageSeoTitle" placeholder="Overrides the template" />
              </RowUI>
              <TextareaUI v-model="pageSeoDescription" placeholder="Page description" :rows="2" />
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI class="gap-4" id="site">
            <SettingsGroup
              title="Domain"
              description="Used for canonical and social URLs in the published site."
            >
              <RowUI label="Domain">
                <InputUI
                  v-model="settings.domain"
                  placeholder="example.com"
                  class="font-mono"
                  @blur="normalizeDomain"
                />
              </RowUI>
            </SettingsGroup>
            <SettingsGroup
              v-if="canBuild"
              title="Publishing"
              description="Rebuild and redeploy the static site from the current project."
            >
              <template v-if="publishedInfo">
                <p class="text-xs">Last published {{ timeAgo(publishedInfo.publishedAt) }}</p>
                <p class="text-[10px] text-muted-foreground">
                  {{ publishedInfo.routes }} routes · {{ formatBytes(publishedInfo.bytes) }}
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
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI v-if="isAdmin" id="users">
            <UsersSettings />
          </TabPanelUI>

          <TabPanelUI v-if="isAdmin" class="gap-4" id="advanced">
            <SettingsGroup
              title="Custom head code"
              description="Raw HTML injected into <head> of exported pages. Runs with full access to your published site."
            >
              <TextareaUI
                v-model="settings.customCode.head"
                :rows="8"
                class="font-mono"
                placeholder="Scripts, meta tags, styles…"
              />
            </SettingsGroup>
            <SettingsGroup
              title="SMTP"
              description="Outgoing mail credentials, stored with the project for future use — not verified or used yet."
            >
              <RowUI label="Host"><InputUI v-model="settings.smtp.host" placeholder="smtp.example.com" /></RowUI>
              <RowUI label="Port"><InputUI v-model="settings.smtp.port" placeholder="587" /></RowUI>
              <RowUI label="User"><InputUI v-model="settings.smtp.user" /></RowUI>
              <RowUI label="Password"><InputUI v-model="settings.smtp.password" type="password" /></RowUI>
              <RowUI label="From"><InputUI v-model="settings.smtp.from" placeholder="hello@example.com" /></RowUI>
            </SettingsGroup>
          </TabPanelUI>
        </div>
      </div>
    </TabsUI>
  </ModalHost>

  <ConfirmModal
    v-if="confirmingLocale"
    title="Delete locale"
    :message="`Delete ${confirmingLocale.toUpperCase()} and all of its translated content? The default locale keeps its content.`"
    @confirm="((deleteLocale(confirmingLocale)), (confirmingLocale = null))"
    @close="confirmingLocale = null"
  />
</template>
