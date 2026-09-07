// Custom HTML attribute allowlist, shared VERBATIM by the client renderers
// (via useRenderNode), the static exporter (server/export.mjs), the Data
// panel, and the MCP edit_elements tool — plain JS so every side sanitizes
// the same way. Attributes the renderer already manages (id/class/style/
// src/href) and anything executable (on* handlers) are refused so custom
// attributes can't shadow editor state or inject script into the export.

/** attribute names allowed verbatim */
const ATTR_ALLOW = new Set([
  'target', 'rel', 'download', 'title', 'role', 'type', 'name', 'value',
  'placeholder', 'alt', 'loading', 'tabindex', 'lang', 'dir', 'hidden',
  'disabled', 'open', 'for',
])

/** allowed name prefixes (data-*, aria-*) */
const ATTR_PREFIXES = ['data-', 'aria-']

/** a syntactically valid attribute name (lowercase, no colons/uppercase) */
const NAME_RE = /^[a-z][a-z0-9-]*$/

/** is `name` an allowed custom attribute? */
export function isAllowedAttribute(name) {
  const n = String(name).toLowerCase().trim()
  if (!NAME_RE.test(n)) return false
  if (ATTR_ALLOW.has(n)) return true
  return ATTR_PREFIXES.some((p) => n.startsWith(p) && n.length > p.length)
}

/**
 * Keep only allowed attributes, lowercased names with string values, dropping
 * empties. Returns a fresh object (never mutates the input).
 */
export function sanitizeAttributes(record) {
  /** @type {Record<string, string>} */
  const out = {}
  if (!record || typeof record !== 'object' || Array.isArray(record)) return out
  for (const [rawName, rawValue] of Object.entries(record)) {
    const name = String(rawName).toLowerCase().trim()
    if (!isAllowedAttribute(name)) continue
    const value = rawValue == null ? '' : String(rawValue)
    if (value === '') continue
    out[name] = value
  }
  return out
}
