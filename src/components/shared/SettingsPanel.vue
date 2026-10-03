<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  Archive, Check, Code2, Copy, KeyRound, Languages, LogOut, Palette, Plug,
  Plus, Rocket, ScanSearch, Search, Settings2, Trash2, Type, UserRound, Users, X,
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
import IconTileUI from '@/components/ui/IconTileUI.vue'
import ButtonUI from '@/components/ui/ButtonUI.vue'
import MenuUI from '@/components/ui/MenuUI.vue'
import BadgeUI from '@/components/ui/BadgeUI.vue'
import ColorPickerUI from '@/components/ui/ColorPickerUI.vue'
import ToggleUI from '@/components/ui/ToggleUI.vue'
import SliderUI from '@/components/ui/SliderUI.vue'
import { useProject } from '@/composables/useProject'
import { SCROLL_LERP_DEFAULT, SCROLL_LERP_MIN, SCROLL_LERP_MAX } from '@/lib/motion'
import { useSettings } from '@/composables/useSettings'
import { useLocale } from '@/composables/useLocale'
import { usePage } from '@/composables/usePage'
import { usePublish } from '@/composables/usePublish'
import { useBranches } from '@/composables/useBranches'
import { useAuth } from '@/composables/useAuth'
import { useModal } from '@/composables/useModal'
import { useApiTokens } from '@/composables/useApiTokens'
import type { CustomFont, StructuredDataType } from '@/types/editor'
import { SCHEMA_TYPES, customSchemaError } from '@/lib/shared/structuredData.js'
import UsersSettings from '@/components/shared/UsersSettings.vue'
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
  settings, addToken, removeToken, smoothScroll,
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
const { publishedInfo } = usePublish()
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
  const groups = [{ label: 'Project', items: project }]
  if (canBuild.value) {
    const site = [
      { id: 'locales', label: 'Locales', icon: Languages },
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
const addingToken = ref(false)
function closeAddToken() {
  addingToken.value = false
  freshApiToken.value = null
  apiTokenName.value = ''
  apiTokenError.value = null
}

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
const faviconDark = computed({
  get: () => settings.value.faviconDark ?? '',
  set: (v: string) => (settings.value.faviconDark = v || undefined),
})

// smooth scrolling (settings.motion.scroll): the slider reads as intensity —
// higher is snappier; lerp is the per-frame catch-up fraction underneath
const scrollLerp = computed({
  get: () => smoothScroll.value.lerp ?? SCROLL_LERP_DEFAULT,
  set: (v: number) => (smoothScroll.value.lerp = v),
})

// site-wide body code: an empty value drops the key so a project that never
// used it stays byte-identical
const siteBodyCode = computed({
  get: () => settings.value.customCode.body ?? '',
  set: (v: string) => {
    if (v) settings.value.customCode.body = v
    else delete settings.value.customCode.body
  },
})

const newLocale = ref('')
function onAddLocale() {
  if (addLocale(newLocale.value)) newLocale.value = ''
}


// --- seo ---

const ogImage = computed({
  get: () => settings.value.seo.ogImage ?? '',
  set: (v: string) => (settings.value.seo.ogImage = v || undefined),
})

// structured data (schema.org JSON-LD): written through computeds so an
// untouched project carries no `schema` key, and clearing a field deletes it
const schemaOn = computed(() => !!settings.value.seo.schema)
const schemaTypeOptions = [
  { label: 'None', value: '' },
  ...SCHEMA_TYPES.map((t) => ({ label: t === 'LocalBusiness' ? 'Local business' : t, value: t })),
]
const seoLogo = computed({
  get: () => settings.value.seo.logo ?? '',
  set: (v: string) => (settings.value.seo.logo = v || undefined),
})
function schemaField(key: 'custom') {
  return computed({
    get: () => settings.value.seo.schema?.[key] ?? '',
    set: (v: string) => {
      const sd = settings.value.seo.schema
      if (!sd) return
      if (v) sd[key] = v
      else delete sd[key]
    },
  })
}
// the type select is the switch: "None" removes the whole `schema` key so an
// untouched project stays byte-identical; picking a type creates it
const schemaType = computed({
  get: () => settings.value.seo.schema?.type ?? '',
  set: (v: StructuredDataType | '') => {
    if (!v) delete settings.value.seo.schema
    else if (settings.value.seo.schema) settings.value.seo.schema.type = v
    else settings.value.seo.schema = { type: v }
  },
})
const schemaCustom = schemaField('custom')
const schemaCustomError = computed(() => customSchemaError(schemaCustom.value))
const newSameAs = ref('')
const sameAs = computed(() => settings.value.seo.schema?.sameAs ?? [])
function addSameAs() {
  const url = newSameAs.value.trim()
  const sd = settings.value.seo.schema
  if (!sd || !/^https?:\/\//i.test(url) || sameAs.value.includes(url)) return
  ;(sd.sameAs ??= []).push(url)
  newSameAs.value = ''
}
function removeSameAs(url: string) {
  const sd = settings.value.seo.schema
  if (!sd?.sameAs) return
  sd.sameAs = sd.sameAs.filter((u) => u !== url)
  if (!sd.sameAs.length) delete sd.sameAs
}
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

// the shared validator also reports a row that is merely unfinished (no name
// yet, no file yet) — the empty controls say that already, so only real
// problems are shown
const INCOMPLETE_FONT = new Set(['Family name required', 'Pick a font file'])
const fontIssue = (font: CustomFont) => {
  const err = fontError(font, customFonts.value)
  return err && !INCOMPLETE_FONT.has(err) ? err : null
}

/** families that actually resolve — offered as the base/mono/serif value so
 *  the user picks a registered font instead of retyping its name */
const customFamilyOptions = computed(() =>
  customFonts.value
    .filter((f) => !fontError(f, customFonts.value))
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
                <div class="flex items-start gap-3">
                  <IconTileUI
                    v-model="favicon"
                    label="Light"
                    scheme="light"
                    accept="image/png,image/svg+xml,image/x-icon"
                  />
                  <IconTileUI
                    v-model="faviconDark"
                    label="Dark"
                    scheme="dark"
                    accept="image/png,image/svg+xml,image/x-icon"
                  />
                </div>
                <p class="ml-2 self-start pt-1 text-[10px] text-muted-foreground">
                  Square PNG, SVG or ICO. The dark one is used by browsers in dark mode when set;
                  otherwise the light one everywhere.
                </p>
              </RowUI>
            </SettingsGroup>
            <SettingsGroup
              v-if="canBuild"
              title="Smooth scrolling"
              description="The page glides toward where you scrolled instead of jumping there. Applies to Play and the published site; off on touch devices and for reduced-motion visitors."
            >
              <template #action>
                <ToggleUI v-model="smoothScroll.enabled" />
              </template>
              <RowUI v-if="smoothScroll.enabled" label="Intensity">
                <SliderUI v-model="scrollLerp" :min="SCROLL_LERP_MIN" :max="SCROLL_LERP_MAX" :step="0.01" />
                <span class="w-12 shrink-0 text-right font-mono text-xs text-muted-foreground">
                  {{ scrollLerp.toFixed(2) }}
                </span>
              </RowUI>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI class="gap-9" id="seo">
            <SettingsGroup
              title="Search & social"
              description="Used on every page unless a page overrides them. The domain makes canonical, social-image and structured-data URLs absolute; %s in the title template is the page name."
            >
              <RowUI label="Logo" class="!items-start">
                <IconTileUI v-model="seoLogo" />
              </RowUI>
              <RowUI label="Site name">
                <InputUI v-model="settings.seo.siteName" placeholder="My Site" />
              </RowUI>
              <RowUI v-if="canBuild" label="Domain">
                <InputUI
                  v-model="settings.domain"
                  placeholder="example.com"
                  class="font-mono"
                  @blur="normalizeDomain"
                />
              </RowUI>
              <RowUI label="Title">
                <InputUI v-model="settings.seo.titleTemplate" placeholder="%s — My Site" />
              </RowUI>
              <RowUI label="Description" class="!items-start">
                <TextareaUI v-model="settings.seo.description" placeholder="Shown in search results" :rows="2" />
              </RowUI>
              <!-- structured data (schema.org JSON-LD): "None" turns it off -->
              <RowUI label="Schema">
                <SelectUI v-model="schemaType" :options="schemaTypeOptions" />
              </RowUI>
              <RowUI v-if="schemaOn" label="Profiles">
                <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div v-if="sameAs.length" class="flex flex-wrap gap-1">
                    <BadgeUI v-for="u in sameAs" :key="u" removable @remove="removeSameAs(u)">
                      {{ u.replace(/^https?:\/\/(www\.)?/, '') }}
                    </BadgeUI>
                  </div>
                  <div class="flex gap-1.5">
                    <InputUI
                      v-model="newSameAs"
                      placeholder="https://instagram.com/…"
                      class="font-mono"
                      @keydown.enter="addSameAs"
                    />
                    <ButtonUI variant="outline" size="xs" class="!h-7 px-2.5" :icon="Plus" @click="addSameAs">Add</ButtonUI>
                  </div>
                </div>
              </RowUI>
              <RowUI label="OG image" class="!items-start">
                <IconTileUI v-model="ogImage" wide />
              </RowUI>
              <RowUI v-if="schemaOn" label="JSON-LD" class="!items-start">
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <TextareaUI
                    v-model="schemaCustom"
                    placeholder='{ "@type": "LocalBusiness", "telephone": "+1 …" }'
                    :rows="4"
                    class="font-mono"
                  />
                  <p v-if="schemaCustomError" class="text-[10px] text-danger">{{ schemaCustomError }}</p>
                  <p v-else class="text-[10px] text-muted-foreground">
                    Optional. One object or an array, added after the generated entries.
                  </p>
                </div>
              </RowUI>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI class="gap-9" id="design">
            <SettingsGroup
              title="Design tokens"
              description="Project colors, usable in classes as bg-<name>, text-<name>, border-<name>."
            >
              <div v-for="token in settings.tokens" :key="token.id" class="flex flex-col gap-0.5">
                <div class="flex items-center gap-1.5">
                  <InputUI v-model="token.name" placeholder="brand" class="font-mono" />
                  <ColorPickerUI v-model="token.value" output="hex" />
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
              description="A font file from the media library and the family name it registers. It renders everywhere — canvas, preview and export."
            >
              <div v-for="font in customFonts" :key="font.id" class="flex flex-col gap-1.5">
                <div class="flex items-start gap-1.5">
                  <MediaPickerControl
                    :model-value="font.src"
                    kind="font"
                    compact
                    class="min-w-0 flex-1"
                    @update:model-value="(v) => setFontSrc(font, v)"
                  />
                  <InputUI v-model="font.family" placeholder="Family name" size="lg" class="!w-40 shrink-0" />
                  <ButtonUI variant="ghost" size="xs" :icon="Trash2" class="!h-12" @click="removeFont(font.id)" />
                </div>
                <p v-if="fontIssue(font)" class="text-[10px] text-danger">{{ fontIssue(font) }}</p>
                <p v-else-if="font.family.trim() && font.src" class="text-[10px] text-muted-foreground">
                  Use it with <span class="font-mono">font-[{{ font.family.trim().replace(/ /g, '_') }}]</span>
                  or set it as the base font below.
                </p>
              </div>
              <ButtonUI variant="outline" size="sm" :icon="Plus" class="w-full" @click="addFont()">
                Add font
              </ButtonUI>
            </SettingsGroup>

            <SettingsGroup
              title="Google Fonts"
              description="A hosted stylesheet, loaded on every page. Use the family name it defines as the base font below."
            >
              <RowUI label="URL">
                <InputUI
                  v-model="googleFontsUrl"
                  placeholder="https://fonts.googleapis.com/css2?…"
                  class="font-mono"
                />
              </RowUI>
            </SettingsGroup>

            <SettingsGroup
              title="Typography"
              description="Which family the site uses by default, and what font-mono / font-serif resolve to."
            >
              <RowUI label="Base">
                <SelectUI v-model="settings.fonts.family" :options="familyOptions" />
              </RowUI>
              <RowUI label="Serif">
                <SelectUI v-model="serifFamily" :options="familyOptions" />
              </RowUI>
              <RowUI label="Mono">
                <SelectUI v-model="monoFamily" :options="familyOptions" />
              </RowUI>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI v-if="canBuild" class="gap-9" id="locales">
            <SettingsGroup
              title="Locales"
              description="Languages your site is translated into. The default locale holds the base content; the others store translations on top of it."
            >
              <div class="flex flex-col divide-y divide-input rounded-xl border border-input">
                <div v-for="l in locales" :key="l" class="flex h-9 items-center gap-3 px-3">
                  <span class="w-16 shrink-0 font-mono text-xs">{{ l }}</span>
                  <span class="min-w-0 flex-1 text-[10px] text-muted-foreground">
                    <template v-if="l === defaultLocale">Default — base content</template>
                    <template v-else>Translations fall back to {{ defaultLocale }}</template>
                  </span>
                  <ButtonUI
                    v-if="l !== defaultLocale"
                    variant="ghost"
                    size="xs"
                    class="text-muted-foreground"
                    @click="setDefaultLocale(l)"
                  >
                    Make default
                  </ButtonUI>
                  <BadgeUI v-else>default</BadgeUI>
                  <ButtonUI
                    variant="ghost"
                    size="xs"
                    :icon="Trash2"
                    :disabled="l === defaultLocale"
                    tooltip="Delete locale"
                    class="hover:!text-danger"
                    @click="confirmDeleteLocale(l)"
                  />
                </div>
              </div>
              <div class="flex gap-1.5">
                <InputUI
                  v-model="newLocale"
                  placeholder="Locale code, e.g. fr or pt-br"
                  class="font-mono"
                  @keydown.enter="onAddLocale"
                />
                <ButtonUI variant="outline" size="xs" class="!h-7 px-2.5" :icon="Plus" @click="onAddLocale">Add</ButtonUI>
              </div>
              <p class="text-[10px] text-muted-foreground">
                Changing the default does not move content between locales.
              </p>
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
            </SettingsGroup>

            <SettingsGroup
              v-if="settings.publishing.method === 'github'"
              title="GitHub"
              description="The repository branch the exported site is pushed to."
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
                  <ButtonUI variant="outline" size="xs" class="!h-7 px-2.5" :disabled="ghSaving || !ghToken" @click="saveGhToken">
                    {{ ghSaving ? 'Saving…' : 'Save' }}
                  </ButtonUI>
                </div>
              </RowUI>
              <p class="text-[10px] text-muted-foreground">
                The branch is fully replaced on every publish — a root README or CNAME would be
                deleted. The token is kept on the server, never in the project file or an export.
              </p>
              <p v-if="ghError" class="text-[10px] text-danger">{{ ghError }}</p>
            </SettingsGroup>

            <SettingsGroup title="Status" description="The last build of the static site from Main.">
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
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI v-if="isAdmin" class="gap-9" id="code">
            <SettingsGroup
              title="Custom code"
              description="Raw HTML added to every exported page — export only, the editor and Play never run it. It has full access to your published site."
            >
              <RowUI label="Head" class="!items-start">
                <TextareaUI
                  v-model="settings.customCode.head"
                  :rows="8"
                  class="font-mono"
                  placeholder="Inside <head> — analytics, meta tags, styles…"
                />
              </RowUI>
              <RowUI label="Body" class="!items-start">
                <TextareaUI
                  v-model="siteBodyCode"
                  :rows="8"
                  class="font-mono"
                  placeholder="Before </body> — widgets, noscript tags…"
                />
              </RowUI>
            </SettingsGroup>
          </TabPanelUI>

          <TabPanelUI v-if="canBuild" class="gap-9" id="integrations">
            <p class="text-[10px] text-muted-foreground">
              Keys are stored on the server, never in the project file or an export, and are never
              shown again once saved.
            </p>

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
              <template #action>
                <ButtonUI
                  size="xs"
                  :icon="addingToken ? X : Plus"
                  @click="addingToken ? closeAddToken() : (addingToken = true)"
                >
                  {{ addingToken ? 'Close' : 'Add token' }}
                </ButtonUI>
              </template>

              <!-- inline create form (before the list), like Users' add form -->
              <div v-if="addingToken" class="flex flex-col gap-2 rounded-xl border border-input p-3">
                <!-- step 1: name it -->
                <template v-if="!freshApiToken">
                  <RowUI label="Name">
                    <InputUI v-model="apiTokenName" placeholder="e.g. mcp-laptop" @keydown.enter="onCreateToken" />
                  </RowUI>
                  <p v-if="apiTokenError" class="text-[10px] text-danger">{{ apiTokenError }}</p>
                  <div class="flex justify-end gap-1.5">
                    <ButtonUI variant="outline" size="xs" @click="closeAddToken">Cancel</ButtonUI>
                    <ButtonUI size="xs" :disabled="apiTokenBusy" @click="onCreateToken">
                      {{ apiTokenBusy ? 'Creating…' : 'Create token' }}
                    </ButtonUI>
                  </div>
                </template>

                <!-- step 2: show-once raw token -->
                <template v-else>
                  <p class="flex items-center gap-1.5 text-xs">
                    <Check class="size-3.5 shrink-0 text-success" />
                    <span class="font-medium">{{ freshApiName }}</span>
                    <span class="text-muted-foreground">· created</span>
                  </p>
                  <code class="block rounded-lg bg-input px-2 py-1.5 font-mono text-[10px] break-all select-all">
                    {{ freshApiToken }}
                  </code>
                  <ButtonUI :icon="apiTokenCopied ? Check : Copy" size="sm" class="w-full justify-center" @click="copyToken">
                    {{ apiTokenCopied ? 'Copied to clipboard' : 'Copy token' }}
                  </ButtonUI>
                  <p class="text-[10px] text-muted-foreground">Copy it now — it won't be shown again.</p>
                  <div class="flex justify-end gap-1.5">
                    <ButtonUI variant="outline" size="xs" @click="freshApiToken = null">Add another</ButtonUI>
                    <ButtonUI size="xs" @click="closeAddToken">Done</ButtonUI>
                  </div>
                </template>
              </div>
              <p v-else-if="apiTokenError" class="text-[10px] text-danger">{{ apiTokenError }}</p>

              <!-- existing tokens, laid out like the members list -->
              <div v-if="tokens.length" class="flex flex-col rounded-xl border border-input">
                <div
                  v-for="t in tokens"
                  :key="t.id"
                  class="flex items-center gap-2 border-b border-input px-3 py-2 last:border-b-0"
                >
                  <span class="size-1.5 shrink-0 rounded-full" :class="t.lastUsedAt ? 'bg-success' : 'bg-muted-foreground/40'" />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-xs font-medium">{{ t.name }}</p>
                    <p class="truncate text-[10px] text-muted-foreground">
                      Created {{ timeAgo(t.createdAt) }} ·
                      {{ t.lastUsedAt ? `last used ${timeAgo(t.lastUsedAt)}` : 'never used' }}
                    </p>
                  </div>
                  <MenuUI>
                    <template #default="{ close }">
                      <button
                        type="button"
                        class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-danger outline-none hover:bg-accent/30"
                        @click="(onRevokeToken(t.id, t.name), close())"
                      >
                        <Trash2 class="size-3.5" /> Revoke
                      </button>
                    </template>
                  </MenuUI>
                </div>
              </div>
              <p v-else class="text-[10px] text-muted-foreground">No tokens yet.</p>
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
