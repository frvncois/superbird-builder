import type { Project } from '@/types/editor'
import { parseSetup, replaceSetup, slugify } from './document'
import { reconcile } from './syntax'
import { defaultSettings } from './settings'
import { storeGet } from './store'

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
    for (const comment of parsed.comments) {
      comment.author ||= 'You'
      for (const reply of comment.replies ?? []) reply.author ||= 'You'
    }
    for (const collection of parsed.collections) {
      for (const entry of collection.entries) entry.slug ||= slugify(entry.name)
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
    return parsed
  } catch {
    return null
  }
}
