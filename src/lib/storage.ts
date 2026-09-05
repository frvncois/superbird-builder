import type { Interaction, InteractionBinding, Project } from '@/types/editor'
import { parseSetup, replaceSetup, slugify } from './document'
import { reconcile } from './syntax'
import { defaultSettings } from './settings'
import { walkNodes } from './tree'
import { storeGet } from './store'

/**
 * One-time split of the old inline interaction model (trigger + classes +
 * timing all on the node) into the shared library + per-element bindings.
 * An old entry has `toClasses` but no `interactionId`; each becomes one
 * library Interaction plus a binding that references it.
 */
function migrateInlineInteractions(project: Project) {
  project.interactions ??= []
  if (project.interactions.length) return // already migrated
  let n = 0
  const trees = [
    ...project.pages.map((p) => p.elements),
    ...(project.components ?? []).map((c) => [c.root]),
  ]
  for (const tree of trees) {
    walkNodes(tree, (node) => {
      if (!node.interactions?.length) return
      node.interactions = node.interactions.map((raw): InteractionBinding => {
        const old = raw as InteractionBinding & Partial<Interaction>
        if (old.interactionId) return old // already a binding
        const animation: Interaction = {
          id: crypto.randomUUID(),
          name: `Interaction ${++n}`,
          toClasses: old.toClasses ?? '',
          duration: old.duration ?? 'duration-300',
          easing: old.easing ?? 'ease-out',
        }
        project.interactions.push(animation)
        return {
          id: old.id,
          interactionId: animation.id,
          trigger: old.trigger ?? 'hover',
          targetId: old.targetId ?? null,
        }
      })
    })
  }
}

/** reads and validates a stored project; null on missing/corrupt data.
 * Reads the server-backed store cache — callers hydrate the key first. */
export function readStoredProject(key: string): Project | null {
  try {
    const raw = storeGet(key)
    if (!raw) return null
    return migrateStoredProject(JSON.parse(raw) as Project)
  } catch {
    return null
  }
}

/** validates + backfills a parsed project (localStorage or fetched snapshot) */
export function migrateStoredProject(parsed: Project): Project | null {
  try {
    if (!Array.isArray(parsed.pages) || !parsed.pages.length) return null
    // backfill fields added after a project was first saved
    parsed.components ??= []
    parsed.collections ??= []
    parsed.comments ??= []
    migrateInlineInteractions(parsed)
    for (const comment of parsed.comments) {
      comment.author ||= 'You'
      for (const reply of comment.replies ?? []) reply.author ||= 'You'
    }
    for (const collection of parsed.collections) {
      const multiRef = collection.fields.filter((f) => f.type === 'multi-reference')
      for (const entry of collection.entries) {
        entry.slug ||= slugify(entry.name)
        // multi-reference values must be arrays (defensive: a field's type
        // may have changed after values were written)
        for (const field of multiRef) {
          const v = entry.values[field.name]
          if (v !== undefined && !Array.isArray(v)) entry.values[field.name] = v ? [v] : []
        }
      }
    }
    // settings backfills (deep, for forward-compat with older saves)
    const defaults = defaultSettings()
    parsed.settings ??= defaults
    parsed.settings.seo ??= defaults.seo
    parsed.settings.smtp ??= defaults.smtp
    parsed.settings.tokens ??= []
    parsed.settings.customCode ??= defaults.customCode
    parsed.settings.fonts ??= defaults.fonts
    parsed.settings.domain ??= ''
    parsed.settings.publishing ??= defaults.publishing
    parsed.settings.publishing.github ??= { repo: '', branch: 'main' }
    // locale backfills (list before pages: the migration reads it)
    parsed.defaultLocale ||= 'en'
    parsed.locales ??= [parsed.defaultLocale]
    if (!parsed.locales.includes(parsed.defaultLocale)) parsed.locales.unshift(parsed.defaultLocale)
    // one-time scaffold migration: pre-locale saves lack the `locale:`
    // setup line; adding it shifts every body node's absolute line, so
    // reconcile carries node identity across the rebuild
    for (const page of parsed.pages) {
      if (/^\s*locale:/m.test(page.code.split(/^:body/m)[0]!)) continue
      const old = page.code
      page.code = replaceSetup(old, { ...parseSetup(old), locale: parsed.defaultLocale })
      page.elements = reconcile(old, page.code, page.elements)
    }
    // links became code-owned (the '@target' token suffix). Backfill any
    // node.link that predates the syntax into its code line so the value
    // survives the code-driven reparse. Idempotent; also renames the early
    // '@entry' sentinel to '@item'.
    for (const page of parsed.pages) {
      const lines = page.code.split('\n')
      let changed = false
      walkNodes(page.elements, (node) => {
        if (!node.link || node.line === undefined) return
        if (node.link === '@entry') node.link = '@item'
        const line = lines[node.line]
        if (line === undefined || /@\S+$/.test(line)) return
        const target = node.link === '@item' ? 'item' : node.link
        lines[node.line] = `${line}@${target}`
        changed = true
      })
      if (changed) page.code = lines.join('\n')
    }
    return parsed
  } catch {
    return null
  }
}
