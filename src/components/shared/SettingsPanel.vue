<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  Archive, Check, Code2, Copy, Globe, KeyRound, LogOut, Palette, Plug,
  Plus, Rocket, ScanSearch, Search, Settings2, Trash2, Type, UserRound, Users,
  Waypoints,
} from 'lucide-vue-next'
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
import ToggleUI from '@/components/ui/ToggleUI.vue'
import { useProject } from '@/composables/useProject'
import { useSettings } from '@/composables/useSettings'
import { useLocale } from '@/composables/useLocale'
import { usePage } from '@/composables/usePage'
import { usePublish } from '@/composables/usePublish'
import { useBranches } from '@/composables/useBranches'
import { useAuth } from '@/composables/useAuth'
import { useModal } from '@/composables/useModal'
import { useApiTokens } from '@/composables/useApiTokens'
import type { CustomFont } from '@/types/editor'
import UsersSettings from '@/components/shared/UsersSettings.vue'
import InteractionsSettings from '@/components/shared/InteractionsSettings.vue'
import MediaPickerControl from '@/components/editor/content/MediaPickerControl.vue'
import {
  FONT_STACKS,
  tokenNameError,
  tokenNameNote,
  isThemeValue,
  fontError,
  fontFormatForMime,
  fontFormatForUrl,
} from '@/lib/settings'
import { useMedia } from '@/composables/useMedia'
import { timeAgo } from '@/lib/time'
import { formatBytes } from '@/lib/media'
import { downloadBlob } from '@/lib/download'

const { project, renameProject } = useProject()
const {
  settings, addToken, removeToken,
  customFonts, addFont, removeFont,
  legacyHeadFonts, importLegacyHeadFonts, clearLegacyHeadFonts,
} = useSettings()
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
const { email: authEmail, name: authName, isAdmin, canBuild, logout, updateAccount } = useAuth()
const { confirm } = useModal()

// opened via useModal (mounted = open); Esc/backdrop close through the host
const props = defineProps<{ initialSection?: string }>()
const emit = defineEmits<{ close: [] }>()

const active = ref(props.initialSection ?? 'general')

// --- nav: sections under Project / Site / Admin group headings; the Admin
// group is hidden entirely for non-admins ---

const NAV = computed(() => {
  const project = [
    { id: 'general', label: 'General', icon: Settings2 },
    { id: 'seo', label: 'SEO', icon: ScanSearch },
    { id: 'fonts', label: 'Fonts', icon: Type },
    { id: 'design', label: 'Design', icon: Palette },
  ]
  // site-wide motion is structure, not content: the server drops a
  // contributor's settings writes, so don't offer them a dead control
  if (canBuild.value) project.push({ id: 'interactions', label: 'Interactions', icon: Waypoints })
  const groups = [{ label: 'Project', items: project }]
  if (canBuild.value) {
    const site = [
      { id: 'domain', label: 'Domain', icon: Globe },
      { id: 'publish', label: 'Publish', icon: Rocket },
    ]
    if (isAdmin.value) site.push({ id: 'code', label: 'Code', icon: Code2 })
    groups.push({ label: 'Site', items: site })
    groups.push({
      label: 'Connect',
      items: [
        { id: 'integrations', label: 'Integrations', icon: Plug },
        { id: 'mcp', label: 'MCP', icon: KeyRound },
      ],
    })
  }
  if (isAdmin.value)
    groups.push({
      label: 'Admin',
      items: [
        { id: 'users', label: 'Users', icon: Users },
        { id: 'backup', label: 'Backup', icon: Archive },
      ],
    })
  return groups
})

// 'account' has no nav item (reached from the user card), so it's always valid
const NAVLESS_SECTIONS = ['account']

// if the active section disappears (e.g. role loads after mount), fall back
watch(NAV, (nav) => {
  if (NAVLESS_SECTIONS.includes(active.value)) return
  if (!nav.some((g) => g.items.some((i) => i.id === active.value))) active.value = 'general'
})

// --- my account (all roles; no nav item — opened from the user card) ---

const accName = ref(authName.value)
const accEmail = ref(authEmail.value ?? '')
const accPassword = ref('')
const accCurrentPassword = ref('')
const accError = ref<string | null>(null)
const accBusy = ref(false)
const accSaved = ref(false)

async function saveAccount() {
  if (accBusy.value) return
  accBusy.value = true
  accError.value = null
  accSaved.value = false
  try {
    await updateAccount({
      name: accName.value.trim(),
      email: accEmail.value.trim(),
      password: accPassword.value || undefined,
      currentPassword: accCurrentPassword.value || undefined,
    })
    accPassword.value = ''
    accCurrentPassword.value = ''
    accSaved.value = true
    setTimeout(() => (accSaved.value = false), 1600)
  } catch (e) {
    accError.value = e instanceof Error ? e.message : 'Update failed'
  } finally {
    accBusy.value = false
  }
}

// section search: filter the sidebar nav by label, dropping empty groups
const navQuery = ref('')
const filteredNav = computed(() => {
  const q = navQuery.value.trim().toLowerCase()
  if (!q) return NAV.value
  return NAV.value
    .map((g) => ({ ...g, items: g.items.filter((i) => i.label.toLowerCase().includes(q)) }))
    .filter((g) => g.items.length)
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

// --- type scale (settings.theme) ---
// Written through computeds so a blank field CLEARS the override rather than
// storing an empty string the compiler would silently drop.
function themeField(
  read: () => string | undefined,
  write: (v: string | undefined) => void,
) {
  return computed({
    get: () => read() ?? '',
    set: (v: string) => write(v.trim() || undefined),
  })
}
const ensureTheme = () => (settings.value.theme ??= {})
const themeRootFontSize = themeField(
  () => settings.value.theme?.rootFontSize,
  (v) => {
    const t = ensureTheme()
    if (v) t.rootFontSize = v
    else delete t.rootFontSize
  },
)
const themeSpacing = themeField(
  () => settings.value.theme?.spacing,
  (v) => {
    const t = ensureTheme()
    if (v) t.spacing = v
    else delete t.spacing
  },
)
const themeTextBase = themeField(
  () => settings.value.theme?.text?.base,
  (v) => {
    const t = ensureTheme()
    if (v) t.text = { ...(t.text ?? {}), base: v }
    else if (t.text) {
      delete t.text.base
      if (!Object.keys(t.text).length) delete t.text
    }
  },
)
/** which of the three fields hold something the compiler would discard */
const themeInvalid = computed(() =>
  (
    [
      ['Root size', themeRootFontSize.value],
      ['Body size', themeTextBase.value],
      ['Spacing unit', themeSpacing.value],
    ] as const
  )
    .filter(([, v]) => v && !isThemeValue(v))
    .map(([label]) => label),
)

const tokenError = (id: string, name: string) =>
  tokenNameError(
    name,
    settings.value.tokens.filter((t) => t.id !== id),
  )

const googleFontsUrl = computed({
  get: () => settings.value.fonts.googleFontsUrl ?? '',
  set: (v: string) => (settings.value.fonts.googleFontsUrl = v.trim() || undefined),
})

// --- custom webfonts ---

const { assetForSrc } = useMedia()

const fontWeightOptions = [
  { label: 'Regular (400)', value: '' },
  { label: 'Thin (100)', value: '100' },
  { label: 'Light (300)', value: '300' },
  { label: 'Medium (500)', value: '500' },
  { label: 'Semibold (600)', value: '600' },
  { label: 'Bold (700)', value: '700' },
  { label: 'Black (900)', value: '900' },
  { label: 'Variable (100–900)', value: '100 900' },
]
const fontStyleOptions = [
  { label: 'Normal', value: '' },
  { label: 'Italic', value: 'italic' },
]

/** picking a file also records its format() hint, taken from the library
 *  asset's mime — assets are stored extensionless, so the URL alone can't
 *  tell us, and the exporter must not need the media index to emit the CSS */
function setFontSrc(font: CustomFont, src: string) {
  font.src = src
  const asset = assetForSrc(src)
  font.format = (asset && fontFormatForMime(asset.mime)) || fontFormatForUrl(src)
  // an unnamed font takes its family from the filename ("OffSans.ttf" → OffSans)
  if (!font.family.trim() && asset?.name) {
    font.family = asset.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9 -]/g, ' ').trim()
  }
}

const fontIssue = (font: CustomFont) => fontError(font, customFonts.value)

/** families that actually resolve — offered as the base/mono/serif value so
 *  the user picks a registered font instead of retyping its name */
const customFamilyOptions = computed(() =>
  customFonts.value
    .filter((f) => !fontIssue(f))
    .map((f) => f.family.trim())
    .filter((name, i, all) => name && all.indexOf(name) === i)
    .map((name) => ({ label: name, value: name })),
)

const familyOptions = computed(() => {
  const custom = customFamilyOptions.value
  return [
    { label: 'Default', value: '' },
    ...(custom.length ? custom : []),
    ...FONT_STACKS,
  ]
})

const monoFamily = computed({
  get: () => settings.value.fonts.monoFamily ?? '',
  set: (v: string) => (settings.value.fonts.monoFamily = v.trim() || undefined),
})
const serifFamily = computed({
  get: () => settings.value.fonts.serifFamily ?? '',
  set: (v: string) => (settings.value.fonts.serifFamily = v.trim() || undefined),
})

const legacyImported = ref(0)
function onImportLegacyFonts() {
  legacyImported.value = importLegacyHeadFonts()
}

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

// --- agent policy: what a `guano_` token may do (server/agent-policy.mjs) ---
// Admin + session only on the server, so the switches only render for admins.
type AgentPolicy = { allowMainWrites: boolean; allowPublish: boolean; allowCustomCode: boolean }
const agentPolicy = ref<AgentPolicy | null>(null)
const agentPolicyError = ref<string | null>(null)
const AGENT_POLICY_ROWS: { key: keyof AgentPolicy; label: string; hint: string }[] = [
  { key: 'allowMainWrites', label: 'Write to Main', hint: 'Edit the live project directly instead of a draft.' },
  { key: 'allowPublish', label: 'Publish', hint: 'Export the target as the live site.' },
  { key: 'allowCustomCode', label: 'Custom code', hint: 'Change head/body code — raw script on every page.' },
]

onMounted(async () => {
  if (!isAdmin.value) return
  try {
    const res = await fetch('/api/agent-policy')
    if (res.ok) agentPolicy.value = await res.json()
  } catch {
    /* best-effort — the group stays hidden */
  }
})

async function setAgentPolicy(key: keyof AgentPolicy, value: boolean) {
  if (!agentPolicy.value) return
  const prev = agentPolicy.value
  agentPolicy.value = { ...prev, [key]: value }
  agentPolicyError.value = null
  try {
    const res = await fetch('/api/agent-policy', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Save failed')
    agentPolicy.value = await res.json()
  } catch (e) {
    agentPolicy.value = prev
    agentPolicyError.value = e instanceof Error ? e.message : 'Save failed'
  }
}

// --- integration secrets (Stripe / mailing / SMTP password) ---
// Same contract as the GitHub token: the server stores them and only ever
// reports whether one is set, so nothing secret reaches the project blob.

type SecretField = 'stripeSecret' | 'mailingKey' | 'smtpPassword'

const secretsSet = ref({
  stripe: { secretKeySet: false },
  mailing: { apiKeySet: false },
  smtp: { passwordSet: false },
})
const secretInput = ref<Record<SecretField, string>>({
  stripeSecret: '',
  mailingKey: '',
  smtpPassword: '',
})
const secretBusy = ref<SecretField | null>(null)
const secretError = ref<string | null>(null)

onMounted(async () => {
  if (!canBuild.value) return
  try {
    const res = await fetch('/api/integrations-config')
    if (res.ok) secretsSet.value = await res.json()
  } catch {
    /* best-effort — leave everything unset */
  }
})

async function saveSecret(field: SecretField, patch: Record<string, unknown>) {
  secretBusy.value = field
  secretError.value = null
  try {
    const res = await fetch('/api/integrations-config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Save failed')
    const data = await res.json()
    secretsSet.value = { stripe: data.stripe, mailing: data.mailing, smtp: data.smtp }
    secretInput.value[field] = ''
  } catch (e) {
    secretError.value = e instanceof Error ? e.message : 'Save failed'
  } finally {
    secretBusy.value = null
  }
}

const savedPlaceholder = (isSet: boolean, hint: string) =>
  isSet ? 'Saved — enter to replace' : hint

// a password saved before secrets moved server-side still counts as configured
const smtpHasPassword = computed(
  () => secretsSet.value.smtp.passwordSet || !!settings.value.smtp.password,
)
const ghConfigured = computed(() => !!settings.value.publishing.github.repo && ghTokenSet.value)
const smtpConfigured = computed(() => !!settings.value.smtp.host && smtpHasPassword.value)
const mailingConfigured = computed(
  () => !!settings.value.integrations.mailing.provider && secretsSet.value.mailing.apiKeySet,
)
const stripeConfigured = computed(() => secretsSet.value.stripe.secretKeySet)

// --- domain check ---

type DnsResult = { domain: string; a: string[]; aaaa: string[]; cname: string[]; timedOut?: boolean }
const dnsBusy = ref(false)
const dnsResult = ref<DnsResult | null>(null)
const dnsError = ref<string | null>(null)

async function checkDomain() {
  normalizeDomain()
  const domain = settings.value.domain.trim()
  if (!domain) {
    dnsError.value = 'Enter a domain first'
    return
  }
  dnsBusy.value = true
  dnsError.value = null
  dnsResult.value = null
  try {
    const res = await fetch(`/api/domain-check?domain=${encodeURIComponent(domain)}`)
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Check failed')
    dnsResult.value = await res.json()
  } catch (e) {
    dnsError.value = e instanceof Error ? e.message : 'Check failed'
  } finally {
    dnsBusy.value = false
  }
}

const dnsResolves = computed(
  () => !!dnsResult.value && !!(dnsResult.value.a.length || dnsResult.value.aaaa.length || dnsResult.value.cname.length),
)

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

const deleting = ref(false)
const deleteError = ref<string | null>(null)
async function deleteProject() {
  const ok = await confirm({
    title: 'Clear all project data?',
    message:
      'Deletes ALL pages, components, collections, drafts, settings, media and the published site, for every user. No backup is made — download a package first if you may need it. This cannot be undone.',
    confirmLabel: 'Clear project data',
  })
  if (!ok) return
  deleting.value = true
  deleteError.value = null
  try {
    const res = await fetch('/api/project-delete', { method: 'POST' })
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Delete failed')
    location.reload()
  } catch (e) {
    deleteError.value = e instanceof Error ? e.message : 'Delete failed'
    deleting.value = false
  }
}
</script>

<template>
  <ModalHost size="xl" @close="emit('close')">
    <div class="flex h-full flex-col">
      <!-- top bar: [icon] [title] ——— [search] -->
      <div class="flex shrink-0 items-center gap-2 border-b border-input px-4 py-2.5">
        <Settings2 class="size-4 shrink-0 text-muted-foreground" />
        <span class="text-xs font-medium">Project settings</span>
        <div class="flex-1" />
        <div class="relative w-64">
          <Search
            class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            v-model="navQuery"
            type="text"
            spellcheck="false"
            placeholder="Search settings…"
            class="h-8 w-full rounded-lg bg-input pr-2 pl-8 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
      </div>

      <TabsUI v-model:active="active" class="flex min-h-0 min-w-0 flex-1 !flex-row !gap-0">
      <!-- left sidebar: grouped nav + pinned account footer -->
      <div class="flex w-48 shrink-0 flex-col border-r border-input">
        <nav class="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
          <p v-if="!filteredNav.length" class="px-2 py-1 text-[10px] text-muted-foreground">
            No matching settings.
          </p>
          <div v-for="group in filteredNav" :key="group.label" class="flex flex-col gap-0.5">
            <p class="px-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              {{ group.label }}
            </p>
            <TabUI
              v-for="item in group.items"
              :key="item.id"
              :id="item.id"
              class="flex !h-8 !w-full items-center !justify-start !px-3 !text-left"
            >
              <span class="flex items-center gap-2">
                <component :is="item.icon" class="size-3.5 shrink-0" />
                {{ item.label }}
              </span>
            </TabUI>
          </div>
        </nav>
        <!-- user card: click to open the account tab; log out stays here -->
        <div class="flex items-center gap-2 border-t border-input p-2">
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1.5 text-left transition-colors hover:bg-accent/30"
            :class="active === 'account' ? 'bg-input' : ''"
            @click="active = 'account'"
          >
            <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
              <UserRound class="size-3.5" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-xs font-medium">{{ authName || 'Your account' }}</span>
              <span class="block truncate text-[10px] text-muted-foreground">{{ authEmail }}</span>
            </span>
          </button>
          <ButtonUI
            variant="icon"
            size="sm"
            :icon="LogOut"
            tooltip="Sign out"
            class="shrink-0 text-muted-foreground hover:!text-danger"
            @click="logout"
          />
        </div>
      </div>

      <!-- right pane: section content -->
      <div class="min-w-0 flex-1 overflow-y-auto">
        <div class="flex flex-col gap-9 p-6">
          <TabPanelUI class="gap-9" id="general">
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
              v-if="isAdmin"
              title="Clear project data"
              description="Wipes ALL pages, components, collections, drafts, settings, media and the published site, then starts a blank project. Users and logins are kept."
              danger
            >
              <ButtonUI
                variant="outline"
                size="sm"
                class="w-full !text-danger"
                :disabled="deleting"
                @click="deleteProject"
              >
                {{ deleting ? 'Clearing…' : 'Clear project data' }}
              </ButtonUI>
              <p v-if="deleteError" class="text-[10px] text-danger">{{ deleteError }}</p>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI class="gap-9" id="seo">
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

          <TabPanelUI v-if="canBuild" class="gap-9" id="interactions">
            <InteractionsSettings />
          </TabPanelUI>

          <TabPanelUI class="gap-9" id="design">
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
                <p
                  v-else-if="tokenNameNote(token.name)"
                  class="text-[10px] text-pending"
                >
                  {{ tokenNameNote(token.name) }}
                </p>
              </div>
              <ButtonUI variant="outline" size="sm" :icon="Plus" class="w-full" @click="addToken()">
                Add token
              </ButtonUI>
            </SettingsGroup>

            <SettingsGroup
              title="Type scale"
              description="Override Tailwind's defaults when your design isn't built on them. Blank means the default."
            >
              <RowUI label="Root size">
                <InputUI
                  v-model="themeRootFontSize"
                  placeholder="16px"
                  class="font-mono"
                />
              </RowUI>
              <RowUI label="Body size">
                <InputUI v-model="themeTextBase" placeholder="1rem" class="font-mono" />
              </RowUI>
              <RowUI label="Spacing unit">
                <InputUI v-model="themeSpacing" placeholder="0.25rem" class="font-mono" />
              </RowUI>
              <p v-if="themeInvalid.length" class="px-1 text-[10px] text-danger">
                Not a CSS length: {{ themeInvalid.join(', ') }}
              </p>
              <p v-else-if="settings.theme?.rootFontSize" class="px-1 text-[10px] text-muted-foreground">
                The root size applies exactly on the published site. In the editor it is scoped to
                the canvas so it can't resize the editor itself, so rem-based spacing previews at
                the default there.
              </p>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI class="gap-9" id="fonts">
            <!-- fonts hand-written into the head code render on the published
                 site but NOT in the editor/preview (head code is exporter-only),
                 which is exactly the bug this tab exists to end. Offer the
                 conversion; never rewrite their code behind their back. -->
            <SettingsGroup
              v-if="legacyHeadFonts.length"
              title="Fonts found in your head code"
              description="These @font-face rules only reach the published site — the editor and preview can't see them. Import them to fix that."
            >
              <div class="flex flex-col divide-y divide-input rounded-xl border border-input">
                <div
                  v-for="(f, i) in legacyHeadFonts"
                  :key="`${f.family}-${i}`"
                  class="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <span class="text-xs font-medium">{{ f.family }}</span>
                  <span class="truncate font-mono text-[10px] text-muted-foreground">{{ f.src }}</span>
                </div>
              </div>
              <ButtonUI variant="outline" size="sm" class="w-full" @click="onImportLegacyFonts">
                Import {{ legacyHeadFonts.length }} font{{ legacyHeadFonts.length === 1 ? '' : 's' }}
              </ButtonUI>
            </SettingsGroup>

            <SettingsGroup
              v-else-if="legacyImported"
              title="Fonts imported"
              description="Your fonts now render in the editor, the preview and the published site. The old @font-face rules in your head code are now redundant."
            >
              <ButtonUI variant="outline" size="sm" class="w-full" @click="clearLegacyHeadFonts">
                Remove them from the head code
              </ButtonUI>
            </SettingsGroup>

            <SettingsGroup
              title="Custom fonts"
              description="Upload a font file to the media library, then point a family name at it. It renders everywhere — canvas, preview and export."
            >
              <div v-for="font in customFonts" :key="font.id" class="flex flex-col gap-1.5">
                <div class="flex items-center gap-1.5">
                  <InputUI v-model="font.family" placeholder="OffSans" class="font-mono" />
                  <ButtonUI variant="ghost" size="xs" :icon="Trash2" @click="removeFont(font.id)" />
                </div>
                <MediaPickerControl
                  :model-value="font.src"
                  kind="font"
                  @update:model-value="(v) => setFontSrc(font, v)"
                />
                <div class="flex items-center gap-1.5">
                  <SelectUI
                    :model-value="font.weight ?? ''"
                    :options="fontWeightOptions"
                    @update:model-value="(v) => (font.weight = v || undefined)"
                  />
                  <SelectUI
                    :model-value="font.style ?? ''"
                    :options="fontStyleOptions"
                    @update:model-value="(v) => (font.style = (v as 'italic') || undefined)"
                  />
                </div>
                <p v-if="fontIssue(font)" class="text-[10px] text-danger">{{ fontIssue(font) }}</p>
                <p v-else class="text-[10px] text-muted-foreground">
                  Use it with <span class="font-mono">font-[{{ font.family.trim().replace(/ /g, '_') }}]</span>
                  or set it as the base font below.
                </p>
              </div>
              <ButtonUI variant="outline" size="sm" :icon="Plus" class="w-full" @click="addFont()">
                Add font
              </ButtonUI>
            </SettingsGroup>

            <SettingsGroup
              title="Typography"
              description="Which family the site uses by default, and what font-mono / font-serif resolve to."
            >
              <RowUI label="Base">
                <SelectUI v-model="settings.fonts.family" :options="familyOptions" />
              </RowUI>
              <InputUI v-model="settings.fonts.family" placeholder="font-family value" class="font-mono" />
              <RowUI label="Serif">
                <SelectUI v-model="serifFamily" :options="familyOptions" />
              </RowUI>
              <RowUI label="Mono">
                <SelectUI v-model="monoFamily" :options="familyOptions" />
              </RowUI>
            </SettingsGroup>

            <SettingsGroup
              title="Google Fonts"
              description="A hosted stylesheet, loaded on every page. Use the family name it defines as the base font above."
            >
              <RowUI label="URL">
                <InputUI
                  v-model="googleFontsUrl"
                  placeholder="https://fonts.googleapis.com/css2?…"
                  class="font-mono"
                />
              </RowUI>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI v-if="canBuild" class="gap-9" id="domain">
            <SettingsGroup
              title="Domain"
              description="Your bare domain, without https:// — used for canonical links and absolute social-image URLs in the exported site."
            >
              <RowUI label="Domain">
                <InputUI
                  v-model="settings.domain"
                  placeholder="example.com"
                  class="font-mono"
                  @blur="normalizeDomain"
                />
              </RowUI>
              <p class="text-[10px] text-muted-foreground">
                Setting this does not move your site — it only fills in the URLs inside the export.
                Point the domain at wherever you host the published site.
              </p>
            </SettingsGroup>

            <SettingsGroup
              title="Connect your domain"
              description="Add these records at your DNS provider, then check that they've propagated."
            >
              <div class="flex flex-col divide-y divide-input rounded-xl border border-input">
                <div class="flex items-center gap-3 px-3 py-2">
                  <span class="w-12 shrink-0 font-mono text-[10px] text-muted-foreground">A</span>
                  <span class="w-16 shrink-0 font-mono text-[10px]">@</span>
                  <span class="min-w-0 flex-1 text-[10px] text-muted-foreground">
                    The IP address of the host serving your site
                  </span>
                </div>
                <div class="flex items-center gap-3 px-3 py-2">
                  <span class="w-12 shrink-0 font-mono text-[10px] text-muted-foreground">CNAME</span>
                  <span class="w-16 shrink-0 font-mono text-[10px]">www</span>
                  <span class="min-w-0 flex-1 text-[10px] text-muted-foreground">
                    {{ settings.domain || 'example.com' }} — so www redirects to the apex domain
                  </span>
                </div>
              </div>
              <p class="text-[10px] text-muted-foreground">
                DNS changes can take minutes to hours to spread. Static hosts (GitHub Pages,
                Netlify, Vercel) publish their own records — use theirs when you deploy there.
              </p>

              <ButtonUI
                variant="outline"
                size="sm"
                :icon="Globe"
                class="w-full"
                :disabled="dnsBusy"
                @click="checkDomain"
              >
                {{ dnsBusy ? 'Checking…' : 'Check DNS' }}
              </ButtonUI>
              <p v-if="dnsError" class="text-[10px] text-danger">{{ dnsError }}</p>

              <div
                v-if="dnsResult"
                class="flex flex-col gap-1.5 rounded-xl border p-3"
                :class="dnsResolves ? 'border-success/40 bg-success/5' : 'border-input'"
              >
                <p class="flex items-center gap-1.5 text-[11px] font-medium">
                  <Check v-if="dnsResolves" class="size-3.5 text-success" />
                  <span class="font-mono">{{ dnsResult.domain }}</span>
                  <span v-if="!dnsResolves" class="text-muted-foreground">
                    {{ dnsResult.timedOut ? 'lookup timed out' : "isn't resolving yet" }}
                  </span>
                </p>
                <div v-if="dnsResult.a.length" class="flex gap-2 text-[10px]">
                  <span class="w-12 shrink-0 text-muted-foreground">A</span>
                  <span class="font-mono break-all">{{ dnsResult.a.join(', ') }}</span>
                </div>
                <div v-if="dnsResult.aaaa.length" class="flex gap-2 text-[10px]">
                  <span class="w-12 shrink-0 text-muted-foreground">AAAA</span>
                  <span class="font-mono break-all">{{ dnsResult.aaaa.join(', ') }}</span>
                </div>
                <div v-if="dnsResult.cname.length" class="flex gap-2 text-[10px]">
                  <span class="w-12 shrink-0 text-muted-foreground">CNAME</span>
                  <span class="font-mono break-all">{{ dnsResult.cname.join(', ') }}</span>
                </div>
                <p v-if="!dnsResolves && !dnsResult.timedOut" class="text-[10px] text-muted-foreground">
                  Add the records above, then check again.
                </p>
              </div>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI v-if="canBuild" class="gap-9" id="publish">
            <SettingsGroup
              title="Publish method"
              description="How the Publish button ships your site. The local preview at / always refreshes too."
            >
              <RowUI label="Method">
                <SelectUI v-model="settings.publishing.method" :options="publishMethodOptions" />
              </RowUI>
              <p v-if="settings.publishing.method === 'github'" class="text-[10px] text-muted-foreground">
                Configure the repository and token under Connect → Integrations.
              </p>
            </SettingsGroup>

            <SettingsGroup
              title="Status"
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
              title="Download"
              description="Grab the built static site as a zip — deployable to any static host."
            >
              <ButtonUI variant="outline" size="sm" class="w-full" @click="exportSiteZip">
                Download static site (.zip)
              </ButtonUI>
              <p v-if="exportError" class="text-[10px] text-danger">{{ exportError }}</p>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI v-if="isAdmin" class="gap-9" id="code">
            <SettingsGroup
              title="Custom head code"
              description="Raw HTML injected into <head> of exported pages. Runs with full access to your published site."
            >
              <TextareaUI
                v-model="settings.customCode.head"
                :rows="10"
                class="font-mono"
                placeholder="Scripts, meta tags, styles…"
              />
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI v-if="canBuild" class="gap-9" id="integrations">
            <p class="text-[10px] text-muted-foreground">
              Keys are stored on the server, never in the project file or an export, and are never
              shown again once saved.
            </p>

            <SettingsGroup
              title="GitHub"
              description="Publish the exported site to a repository branch."
            >
              <template #action>
                <span class="shrink-0 text-[10px]" :class="ghConfigured ? 'text-success' : 'text-muted-foreground'">
                  {{ ghConfigured ? 'Configured' : 'Not configured' }}
                </span>
              </template>
              <RowUI label="Repository">
                <InputUI v-model="settings.publishing.github.repo" placeholder="owner/name" class="font-mono" />
              </RowUI>
              <RowUI label="Branch">
                <InputUI v-model="settings.publishing.github.branch" placeholder="main" class="font-mono" />
              </RowUI>
              <RowUI label="Token">
                <div class="flex w-full gap-1.5">
                  <InputUI
                    v-model="ghToken"
                    type="password"
                    :placeholder="savedPlaceholder(ghTokenSet, 'ghp_…')"
                    class="font-mono"
                  />
                  <ButtonUI variant="outline" size="sm" :disabled="ghSaving || !ghToken" @click="saveGhToken">
                    {{ ghSaving ? 'Saving…' : 'Save' }}
                  </ButtonUI>
                </div>
              </RowUI>
              <p class="text-[10px] text-muted-foreground">
                The branch is fully replaced on every publish — a root README or CNAME would be
                deleted. Select GitHub as your method under Site → Publish.
              </p>
              <p v-if="ghError" class="text-[10px] text-danger">{{ ghError }}</p>
            </SettingsGroup>

            <SettingsGroup
              v-if="isAdmin"
              title="Email (SMTP)"
              description="Outgoing mail credentials, stored for future use — nothing sends mail yet."
            >
              <template #action>
                <span class="shrink-0 text-[10px]" :class="smtpConfigured ? 'text-success' : 'text-muted-foreground'">
                  {{ smtpConfigured ? 'Configured' : 'Not configured' }}
                </span>
              </template>
              <RowUI label="Host"><InputUI v-model="settings.smtp.host" placeholder="smtp.example.com" /></RowUI>
              <RowUI label="Port"><InputUI v-model="settings.smtp.port" placeholder="587" /></RowUI>
              <RowUI label="User"><InputUI v-model="settings.smtp.user" /></RowUI>
              <RowUI label="From"><InputUI v-model="settings.smtp.from" placeholder="hello@example.com" /></RowUI>
              <RowUI label="Password">
                <div class="flex w-full gap-1.5">
                  <InputUI
                    v-model="secretInput.smtpPassword"
                    type="password"
                    :placeholder="savedPlaceholder(smtpHasPassword, '••••••••')"
                  />
                  <ButtonUI
                    variant="outline"
                    size="sm"
                    :disabled="secretBusy === 'smtpPassword' || !secretInput.smtpPassword"
                    @click="saveSecret('smtpPassword', { smtp: { password: secretInput.smtpPassword } })"
                  >
                    {{ secretBusy === 'smtpPassword' ? 'Saving…' : 'Save' }}
                  </ButtonUI>
                </div>
              </RowUI>
            </SettingsGroup>

            <SettingsGroup
              title="Mailing list"
              description="An API key for your newsletter provider, ready for form blocks to use."
            >
              <template #action>
                <span class="shrink-0 text-[10px]" :class="mailingConfigured ? 'text-success' : 'text-muted-foreground'">
                  {{ mailingConfigured ? 'Configured' : 'Not configured' }}
                </span>
              </template>
              <RowUI label="Provider">
                <InputUI
                  v-model="settings.integrations.mailing.provider"
                  placeholder="Mailchimp, Kit, Buttondown…"
                />
              </RowUI>
              <RowUI label="API key">
                <div class="flex w-full gap-1.5">
                  <InputUI
                    v-model="secretInput.mailingKey"
                    type="password"
                    :placeholder="savedPlaceholder(secretsSet.mailing.apiKeySet, 'API key')"
                    class="font-mono"
                  />
                  <ButtonUI
                    variant="outline"
                    size="sm"
                    :disabled="secretBusy === 'mailingKey' || !secretInput.mailingKey"
                    @click="saveSecret('mailingKey', { mailing: { apiKey: secretInput.mailingKey } })"
                  >
                    {{ secretBusy === 'mailingKey' ? 'Saving…' : 'Save' }}
                  </ButtonUI>
                </div>
              </RowUI>
            </SettingsGroup>

            <SettingsGroup
              title="Stripe"
              description="Keys for selling online. The publishable key ships with your site; the secret key never leaves the server."
            >
              <template #action>
                <span class="shrink-0 text-[10px]" :class="stripeConfigured ? 'text-success' : 'text-muted-foreground'">
                  {{ stripeConfigured ? 'Configured' : 'Not configured' }}
                </span>
              </template>
              <RowUI label="Publishable">
                <InputUI
                  v-model="settings.integrations.stripe.publishableKey"
                  placeholder="pk_live_…"
                  class="font-mono"
                />
              </RowUI>
              <RowUI label="Secret">
                <div class="flex w-full gap-1.5">
                  <InputUI
                    v-model="secretInput.stripeSecret"
                    type="password"
                    :placeholder="savedPlaceholder(secretsSet.stripe.secretKeySet, 'sk_live_…')"
                    class="font-mono"
                  />
                  <ButtonUI
                    variant="outline"
                    size="sm"
                    :disabled="secretBusy === 'stripeSecret' || !secretInput.stripeSecret"
                    @click="saveSecret('stripeSecret', { stripe: { secretKey: secretInput.stripeSecret } })"
                  >
                    {{ secretBusy === 'stripeSecret' ? 'Saving…' : 'Save' }}
                  </ButtonUI>
                </div>
              </RowUI>
            </SettingsGroup>

            <p v-if="secretError" class="text-[10px] text-danger">{{ secretError }}</p>
          </TabPanelUI>

          <TabPanelUI v-if="canBuild" class="gap-9" id="mcp">
            <SettingsGroup
              title="MCP access"
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

            <SettingsGroup
              v-if="isAdmin && agentPolicy"
              title="Agent permissions"
              description="What an MCP agent (token-authenticated) may do. Off by default: agents work in drafts a human applies."
            >
              <RowUI v-for="row in AGENT_POLICY_ROWS" :key="row.key" :label="row.label">
                <div class="flex items-center justify-end gap-2">
                  <span class="text-[10px] text-muted-foreground">{{ row.hint }}</span>
                  <ToggleUI
                    :model-value="agentPolicy[row.key]"
                    @update:model-value="(v) => setAgentPolicy(row.key, v)"
                  />
                </div>
              </RowUI>
              <p v-if="agentPolicyError" class="text-[10px] text-danger">{{ agentPolicyError }}</p>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI v-if="isAdmin" id="users">
            <UsersSettings />
          </TabPanelUI>

          <TabPanelUI v-if="isAdmin" class="gap-9" id="backup">
            <SettingsGroup
              title="Export"
              description="A zip of every page, draft, setting and media file — your restore point."
            >
              <ButtonUI
                variant="outline"
                size="sm"
                class="w-full"
                :disabled="exporting"
                @click="exportPackage"
              >
                {{ exporting ? 'Preparing…' : 'Download project package (.zip)' }}
              </ButtonUI>
              <p v-if="exportError" class="text-[10px] text-danger">{{ exportError }}</p>
            </SettingsGroup>

            <SettingsGroup
              title="Import"
              description="Restores a project package. Replaces ALL pages, drafts, settings and media, for every user."
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
                :disabled="importing"
                @click="importInput?.click()"
              >
                {{ importing ? 'Importing…' : 'Choose package…' }}
              </ButtonUI>
              <p v-if="importError" class="text-[10px] text-danger">{{ importError }}</p>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI class="gap-9" id="account">
            <SettingsGroup title="Profile" description="Your name and sign-in email.">
              <RowUI label="Name">
                <InputUI v-model="accName" placeholder="Your name" />
              </RowUI>
              <RowUI label="Email">
                <InputUI v-model="accEmail" type="email" placeholder="you@example.com" />
              </RowUI>
            </SettingsGroup>
            <SettingsGroup title="Change password" description="Leave blank to keep your current password.">
              <RowUI label="New">
                <InputUI v-model="accPassword" type="password" placeholder="Leave blank to keep" />
              </RowUI>
              <RowUI v-if="accPassword" label="Current">
                <InputUI v-model="accCurrentPassword" type="password" placeholder="Current password" />
              </RowUI>
            </SettingsGroup>
            <div class="flex items-center gap-2">
              <ButtonUI variant="default" size="sm" :disabled="accBusy" @click="saveAccount">
                {{ accBusy ? 'Saving…' : 'Save changes' }}
              </ButtonUI>
              <span v-if="accSaved" class="flex items-center gap-1 text-[10px] text-success">
                <Check class="size-3.5" /> Saved
              </span>
              <span v-if="accError" class="text-[10px] text-danger">{{ accError }}</span>
            </div>
          </TabPanelUI>
        </div>
      </div>
      </TabsUI>
    </div>
  </ModalHost>
</template>
