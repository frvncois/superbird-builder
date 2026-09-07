<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Check, Copy, KeyRound, LogOut, Palette, Plus, Rocket, Settings2, Trash2, Users } from 'lucide-vue-next'
import ModalHost from '@/components/modal/ModalHost.vue'
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
import { useBranches } from '@/composables/useBranches'
import { useAuth } from '@/composables/useAuth'
import { useModal } from '@/composables/useModal'
import { useApiTokens } from '@/composables/useApiTokens'
import UsersSettings from '@/components/shared/UsersSettings.vue'
import { FONT_STACKS, tokenNameError } from '@/lib/settings'
import { timeAgo } from '@/lib/time'
import { formatBytes } from '@/lib/media'
import { downloadBlob } from '@/lib/download'

const { project, renameProject } = useProject()
const { settings, addToken, removeToken } = useSettings()
const { locales, defaultLocale, addLocale, deleteLocale, setDefaultLocale } = useLocale()

async function confirmDeleteLocale(loc: string) {
  const ok = await confirm({
    title: 'Delete locale',
    message: `Delete ${loc.toUpperCase()} and all of its translated content? The default locale keeps its content.`,
  })
  if (ok) deleteLocale(loc)
}
const { pages, activePage } = usePage()
const { publishedInfo, markPublished } = usePublish()
const { onMain } = useBranches()
const { email: authEmail, isAdmin, canBuild, logout } = useAuth()
const { confirm } = useModal()

// opened via useModal (mounted = open); Esc/backdrop close through the host
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
  ]
  if (canBuild.value)
    groups.push({
      label: 'Publish',
      items: [{ id: 'publish', label: 'Publish', icon: Rocket }],
    })
  if (canBuild.value)
    groups.push({
      label: 'Access',
      items: [{ id: 'tokens', label: 'API tokens', icon: KeyRound }],
    })
  if (isAdmin.value)
    groups.push({
      label: 'Admin',
      items: [{ id: 'users', label: 'Users', icon: Users }],
    })
  return groups
})

// if the active section disappears (e.g. role loads after mount), fall back
watch(NAV, (nav) => {
  if (!nav.some((g) => g.items.some((i) => i.id === active.value))) active.value = 'general'
})

// --- API tokens (admin/editor only; the server 403s contributors) ---

const { tokens, load: loadTokens, create: createToken, revoke: revokeTokenApi } = useApiTokens()

const apiTokenName = ref('')
const apiTokenBusy = ref(false)
const apiTokenError = ref<string | null>(null)
// the raw token, shown exactly once right after creation, then unrecoverable
const freshApiToken = ref<string | null>(null)
const freshApiName = ref('')
const apiTokenCopied = ref(false)

onMounted(() => {
  if (canBuild.value) loadTokens().catch(() => {})
})

async function onCreateToken() {
  if (apiTokenBusy.value) return
  apiTokenError.value = null
  const label = apiTokenName.value.trim()
  if (!label) {
    apiTokenError.value = 'Give the token a name first'
    return
  }
  apiTokenBusy.value = true
  try {
    freshApiToken.value = await createToken(label)
    freshApiName.value = label
    apiTokenName.value = ''
    apiTokenCopied.value = false
  } catch (e) {
    apiTokenError.value = e instanceof Error ? e.message : 'Could not create the token'
  } finally {
    apiTokenBusy.value = false
  }
}

async function copyToken() {
  if (!freshApiToken.value) return
  await navigator.clipboard.writeText(freshApiToken.value).catch(() => {})
  apiTokenCopied.value = true
  setTimeout(() => (apiTokenCopied.value = false), 1600)
}

async function onRevokeToken(id: string, label: string) {
  const ok = await confirm({
    title: 'Revoke token',
    message: `Any MCP server or script using “${label}” will stop working immediately.`,
    confirmLabel: 'Revoke',
  })
  if (ok) await revokeTokenApi(id).catch((e) => (apiTokenError.value = e instanceof Error ? e.message : 'Failed'))
}

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
    await markPublished(settings.value.publishing.method)
  } catch (e) {
    republishError.value = e instanceof Error ? e.message : 'Publish failed'
  } finally {
    republishing.value = false
  }
}

// --- publish method ---

const publishMethodOptions = [
  { label: 'Server', value: 'server' },
  { label: 'Download .zip', value: 'zip' },
  { label: 'GitHub', value: 'github' },
]

// GitHub token is write-only: the server never echoes it, we only learn
// whether one is set (on mount) and can replace it.
const ghTokenSet = ref(false)
const ghToken = ref('')
const ghSaving = ref(false)
const ghError = ref<string | null>(null)

onMounted(async () => {
  if (!canBuild.value) return
  try {
    const res = await fetch('/api/publish-config')
    if (res.ok) ghTokenSet.value = (await res.json())?.github?.tokenSet ?? false
  } catch {
    /* best-effort — leave ghTokenSet false */
  }
})

async function saveGhToken() {
  ghSaving.value = true
  ghError.value = null
  try {
    const res = await fetch('/api/publish-config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ github: { token: ghToken.value } }),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Save failed')
    ghTokenSet.value = (await res.json())?.github?.tokenSet ?? false
    ghToken.value = ''
  } catch (e) {
    ghError.value = e instanceof Error ? e.message : 'Save failed'
  } finally {
    ghSaving.value = false
  }
}

// --- export / import ---

const exporting = ref(false)
const exportError = ref<string | null>(null)
async function exportPackage() {
  exporting.value = true
  exportError.value = null
  try {
    const res = await fetch('/api/project-export')
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Export failed')
    downloadBlob(await res.blob(), 'guano-project.zip')
  } catch (e) {
    exportError.value = e instanceof Error ? e.message : 'Export failed'
  } finally {
    exporting.value = false
  }
}

async function exportSiteZip() {
  exportError.value = null
  try {
    await markPublished('zip')
  } catch (e) {
    exportError.value = e instanceof Error ? e.message : 'Export failed'
  }
}

const importInput = ref<HTMLInputElement>()
const importing = ref(false)
const importError = ref<string | null>(null)
async function onImportFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (importInput.value) importInput.value.value = '' // allow re-picking the same file
  if (!file) return
  const ok = await confirm({
    title: 'Replace entire project?',
    message:
      'Importing a package replaces ALL pages, branches, settings and media for every user. This cannot be undone.',
  })
  if (!ok) return
  importing.value = true
  importError.value = null
  try {
    const res = await fetch('/api/project-import', { method: 'POST', body: file })
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Import failed')
    location.reload()
  } catch (e) {
    importError.value = e instanceof Error ? e.message : 'Import failed'
    importing.value = false
  }
}
</script>

<template>
  <ModalHost size="xl" @close="emit('close')">
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
          <p v-tooltip="authEmail" class="truncate text-[10px] text-muted-foreground">
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
                  @remove="confirmDeleteLocale(l)"
                >
                  {{ l }}
                </BadgeUI>
              </div>
              <div class="flex gap-1.5">
                <InputUI v-model="newLocale" placeholder="e.g. fr" @keydown.enter="onAddLocale" />
                <ButtonUI variant="outline" size="sm" :icon="Plus" @click="onAddLocale">Add</ButtonUI>
              </div>
            </SettingsGroup>
            <SettingsGroup
              title="SEO — Site defaults"
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
            <SettingsGroup title="SEO — Per page" description="Override the defaults for a single page.">
              <RowUI label="Page">
                <SelectUI v-model="seoPageId" :options="pageOptions" />
              </RowUI>
              <RowUI label="Title">
                <InputUI v-model="pageSeoTitle" placeholder="Overrides the template" />
              </RowUI>
              <TextareaUI v-model="pageSeoDescription" placeholder="Page description" :rows="2" />
            </SettingsGroup>
            <SettingsGroup
              v-if="isAdmin"
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
              v-if="isAdmin"
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

          <TabPanelUI v-if="canBuild" class="gap-4" id="publish">
            <SettingsGroup
              title="Publish method"
              description="How the Publish button ships your site. The local preview at / always refreshes too."
            >
              <RowUI label="Method">
                <SelectUI v-model="settings.publishing.method" :options="publishMethodOptions" />
              </RowUI>
              <template v-if="settings.publishing.method === 'github'">
                <RowUI label="Repository">
                  <InputUI v-model="settings.publishing.github.repo" placeholder="owner/name" class="font-mono" />
                </RowUI>
                <RowUI label="Branch">
                  <InputUI v-model="settings.publishing.github.branch" placeholder="main" class="font-mono" />
                </RowUI>
                <p class="text-[10px] text-muted-foreground">
                  Publishing sends the exported site to this GitHub repo. The branch is fully
                  replaced on every publish — a root README or CNAME would be deleted.
                </p>
                <RowUI label="Token">
                  <div class="flex w-full gap-1.5">
                    <InputUI
                      v-model="ghToken"
                      type="password"
                      :placeholder="ghTokenSet ? 'Token saved — enter to replace' : 'ghp_…'"
                      class="font-mono"
                    />
                    <ButtonUI variant="outline" size="sm" :disabled="ghSaving || !ghToken" @click="saveGhToken">
                      {{ ghSaving ? 'Saving…' : 'Save' }}
                    </ButtonUI>
                  </div>
                </RowUI>
                <p class="text-[10px] text-muted-foreground">
                  Token is stored on the server and never shown again.
                </p>
                <p v-if="ghError" class="text-[10px] text-danger">{{ ghError }}</p>
              </template>
            </SettingsGroup>

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
              title="Publishing"
              description="Rebuild and redeploy the static site from Main."
            >
              <p v-if="!onMain" class="text-[10px] text-pending">
                You're on a draft — publishing ships Main; draft changes are not included.
              </p>
              <template v-if="publishedInfo">
                <p class="text-xs">Last published {{ timeAgo(publishedInfo.publishedAt) }}</p>
                <p class="text-[10px] text-muted-foreground">
                  {{ publishedInfo.routes }} routes · {{ formatBytes(publishedInfo.bytes) }}
                  <template v-if="publishedInfo.commit">
                    · {{ publishedInfo.commit.slice(0, 7) }}
                  </template>
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

            <SettingsGroup
              title="Export"
              description="Download a copy of your project or the built static site."
            >
              <ButtonUI
                v-if="isAdmin"
                variant="outline"
                size="sm"
                class="w-full"
                :disabled="exporting"
                @click="exportPackage"
              >
                {{ exporting ? 'Preparing…' : 'Download project package (.zip)' }}
              </ButtonUI>
              <ButtonUI variant="outline" size="sm" class="w-full" @click="exportSiteZip">
                Download static site (.zip)
              </ButtonUI>
              <p v-if="exportError" class="text-[10px] text-danger">{{ exportError }}</p>
            </SettingsGroup>

            <SettingsGroup
              v-if="isAdmin"
              title="Import"
              description="Restores a project package. Replaces everything."
            >
              <input
                ref="importInput"
                type="file"
                accept=".zip,application/zip"
                class="hidden"
                @change="onImportFile"
              />
              <ButtonUI
                variant="outline"
                size="sm"
                class="w-full"
                :disabled="importing"
                @click="importInput?.click()"
              >
                {{ importing ? 'Importing…' : 'Choose package…' }}
              </ButtonUI>
              <p v-if="importError" class="text-[10px] text-danger">{{ importError }}</p>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI v-if="canBuild" class="gap-4" id="tokens">
            <SettingsGroup
              title="API tokens"
              description="Bearer credentials for the Guano MCP server and scripts. Each carries your role — treat it like a password."
            >
              <!-- show-once: the freshly created raw token -->
              <div
                v-if="freshApiToken"
                class="flex flex-col gap-2 rounded-xl border border-accent/40 bg-accent/10 p-3"
              >
                <p class="flex items-center gap-1.5 text-[11px] font-medium">
                  <Check class="size-3.5 text-success" /> Token “{{ freshApiName }}” created
                </p>
                <code
                  class="block rounded-lg bg-background px-2 py-1.5 font-mono text-[10px] break-all select-all"
                >
                  {{ freshApiToken }}
                </code>
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[10px] text-muted-foreground">Copy it now — it won't be shown again.</span>
                  <ButtonUI size="xs" :icon="apiTokenCopied ? Check : Copy" @click="copyToken">
                    {{ apiTokenCopied ? 'Copied' : 'Copy' }}
                  </ButtonUI>
                </div>
                <ButtonUI variant="ghost" size="xs" class="self-end" @click="freshApiToken = null">
                  Done
                </ButtonUI>
              </div>

              <!-- create row -->
              <div v-else class="flex items-end gap-1.5">
                <div class="flex-1">
                  <InputUI
                    v-model="apiTokenName"
                    placeholder="Token name (e.g. mcp-laptop)"
                    @keydown.enter="onCreateToken"
                  />
                </div>
                <ButtonUI variant="outline" size="sm" :disabled="apiTokenBusy" @click="onCreateToken">
                  {{ apiTokenBusy ? 'Creating…' : 'Create' }}
                </ButtonUI>
              </div>

              <p v-if="apiTokenError" class="text-[10px] text-danger">{{ apiTokenError }}</p>

              <!-- existing tokens -->
              <ul v-if="tokens.length" class="flex flex-col divide-y divide-input">
                <li
                  v-for="t in tokens"
                  :key="t.id"
                  class="flex items-center justify-between gap-2 py-1.5"
                >
                  <div class="min-w-0">
                    <p class="truncate text-xs font-medium">{{ t.name }}</p>
                    <p class="text-[10px] text-muted-foreground">
                      Created {{ timeAgo(t.createdAt) }} ·
                      {{ t.lastUsedAt ? `last used ${timeAgo(t.lastUsedAt)}` : 'never used' }}
                    </p>
                  </div>
                  <ButtonUI
                    variant="icon"
                    size="sm"
                    :icon="Trash2"
                    tooltip="Revoke token"
                    @click="onRevokeToken(t.id, t.name)"
                  />
                </li>
              </ul>
              <p v-else class="text-[10px] text-muted-foreground">No tokens yet.</p>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI v-if="isAdmin" id="users">
            <UsersSettings />
          </TabPanelUI>
        </div>
      </div>
    </TabsUI>
  </ModalHost>
</template>
