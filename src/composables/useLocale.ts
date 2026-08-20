import { computed, ref, watch } from 'vue'
import { useProject } from './useProject'
import { parseSetup, replaceSetup } from '@/lib/document'
import { reconcile } from '@/lib/syntax'
import type { CollectionEntry, ElementNode } from '@/types/editor'

/** the locale being edited/previewed — runtime editor state, shared
 * across pages; deliberately NOT on the project (not persisted, not
 * part of undo history) */
const activeLocale = ref('en')

const LOCALE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/

let clampStarted = false

export interface LocalizedValue {
  value: string | undefined
  /** false = shown via default-locale fallback while a non-default locale is active */
  translated: boolean
}

export function useLocale() {
  const { project } = useProject()

  const locales = computed(() => project.value.locales)
  const defaultLocale = computed(() => project.value.defaultLocale)
  const isDefault = computed(() => activeLocale.value === defaultLocale.value)

  // branch switch / undo / reset may load a project without the active locale
  if (!clampStarted) {
    clampStarted = true
    watch(locales, (list) => {
      if (!list.includes(activeLocale.value)) activeLocale.value = defaultLocale.value
    })
  }

  function normalizeLocale(raw: string): string | null {
    const code = raw.trim().toLowerCase()
    return LOCALE_RE.test(code) ? code : null
  }

  function addLocale(raw: string): string | null {
    const code = normalizeLocale(raw)
    if (!code || locales.value.includes(code)) return null
    project.value.locales.push(code) // undoable: lives on the project
    return code
  }

  function setActiveLocale(code: string) {
    activeLocale.value = locales.value.includes(code) ? code : defaultLocale.value
  }

  /** overrides are kept so re-adding a removed locale restores them */
  function removeLocale(code: string) {
    if (code === defaultLocale.value) return
    project.value.locales = project.value.locales.filter((l) => l !== code)
  }

  /**
   * Changes which locale the base content belongs to. Rewrites every
   * page's `locale:` setup line (same mechanism as the storage
   * migration). Content does NOT move between locales.
   */
  function setDefaultLocale(code: string) {
    if (!locales.value.includes(code) || code === defaultLocale.value) return
    project.value.defaultLocale = code
    for (const page of project.value.pages) {
      const old = page.code
      page.code = replaceSetup(old, { ...parseSetup(old), locale: code })
      page.elements = reconcile(old, page.code, page.elements)
    }
  }

  // --- canvas reads (fallback-aware) ---

  function nodeContent(node: ElementNode): LocalizedValue {
    if (isDefault.value) return { value: node.content, translated: true }
    const override = node.locales?.[activeLocale.value]?.content
    return override
      ? { value: override, translated: true }
      : { value: node.content, translated: false }
  }

  function nodeSrc(node: ElementNode): LocalizedValue {
    if (isDefault.value) return { value: node.src, translated: true }
    const override = node.locales?.[activeLocale.value]?.src
    return override
      ? { value: override, translated: true }
      : { value: node.src, translated: false }
  }

  function entryValue(entry: CollectionEntry, field: string): LocalizedValue {
    if (isDefault.value) return { value: entry.values[field], translated: true }
    const override = entry.locales?.[activeLocale.value]?.[field]
    return override
      ? { value: override, translated: true }
      : { value: entry.values[field], translated: false }
  }

  // --- panel edits (raw override, no fallback) ---

  function editNodeContent(node: ElementNode): string {
    return (isDefault.value ? node.content : node.locales?.[activeLocale.value]?.content) ?? ''
  }

  function setNodeContent(node: ElementNode, value: string) {
    if (isDefault.value) node.content = value
    else setNodeOverride(node, 'content', value)
  }

  function editNodeSrc(node: ElementNode): string {
    return (isDefault.value ? node.src : node.locales?.[activeLocale.value]?.src) ?? ''
  }

  function setNodeSrc(node: ElementNode, value: string) {
    if (isDefault.value) node.src = value || undefined
    else setNodeOverride(node, 'src', value)
  }

  // an empty value deletes the override (fallback returns); empty
  // records are pruned so a touch-then-clear edit leaves the node
  // byte-identical — keeps branch-merge signatures stable
  function setNodeOverride(node: ElementNode, key: 'content' | 'src', value: string) {
    if (!value) {
      const slot = node.locales?.[activeLocale.value]
      if (slot) {
        delete slot[key]
        if (!Object.keys(slot).length) delete node.locales![activeLocale.value]
        if (!Object.keys(node.locales!).length) delete node.locales
      }
      return
    }
    ;((node.locales ??= {})[activeLocale.value] ??= {})[key] = value
  }

  function editEntryValue(entry: CollectionEntry, field: string): string {
    return (
      (isDefault.value ? entry.values[field] : entry.locales?.[activeLocale.value]?.[field]) ?? ''
    )
  }

  function setEntryValue(entry: CollectionEntry, field: string, value: string) {
    if (isDefault.value) {
      entry.values[field] = value
      return
    }
    if (!value) {
      const slot = entry.locales?.[activeLocale.value]
      if (slot) {
        delete slot[field]
        if (!Object.keys(slot).length) delete entry.locales![activeLocale.value]
        if (!Object.keys(entry.locales!).length) delete entry.locales
      }
      return
    }
    ;((entry.locales ??= {})[activeLocale.value] ??= {})[field] = value
  }

  return {
    activeLocale,
    locales,
    defaultLocale,
    isDefault,
    addLocale,
    setActiveLocale,
    removeLocale,
    setDefaultLocale,
    nodeContent,
    nodeSrc,
    entryValue,
    editNodeContent,
    setNodeContent,
    editNodeSrc,
    setNodeSrc,
    editEntryValue,
    setEntryValue,
  }
}
