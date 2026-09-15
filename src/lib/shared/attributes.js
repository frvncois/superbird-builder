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
  'disabled', 'open', 'for', 'required', 'readonly', 'checked', 'selected',
  'multiple', 'autofocus', 'autocomplete', 'min', 'max', 'step', 'rows',
  'cols', 'maxlength', 'minlength', 'pattern', 'inputmode', 'accept',
  // translate="no" marks content that must never be localized (code samples,
  // brand names) — browsers/translators honour it, and the MCP translation
  // worklist excludes the whole subtree
  'translate',
])

/**
 * Attributes whose PRESENCE is the value: `download`, `hidden`, `required`.
 * An empty string is the canonical way to express them, so they must survive
 * sanitization, and they serialize BARE (`<a download>` not `<a download="">`)
 * — `download="false"` would still download, and `hidden=""` vs `hidden` are the
 * same to the parser but only the bare form reads as intended.
 */
export const BOOLEAN_ATTRS = new Set([
  'download', 'hidden', 'disabled', 'open', 'required', 'readonly',
  'checked', 'selected', 'multiple', 'autofocus',
])

/** true when `name` serializes as a bare attribute with an empty value */
export function isBooleanAttribute(name) {
  return BOOLEAN_ATTRS.has(String(name).toLowerCase().trim())
}

/** allowed name prefixes (data-*, aria-*) */
const ATTR_PREFIXES = ['data-', 'aria-']

/**
 * Attributes that belong to the LINK, not to the element carrying it.
 *
 * A non-anchor element with a link is wrapped in a generated `<a>` (see
 * linkWrap in server/export.mjs). These attributes were landing on the inner
 * element, where they do nothing: `target="_blank"` on a `<div>` never opens a
 * new tab, and `aria-label` on a non-interactive div is not announced as the
 * link's name. They hoist onto the generated anchor instead.
 */
const LINK_ATTRS = new Set([
  'target',
  'rel',
  'download',
  'title',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'aria-current',
])

/**
 * Split sanitized attributes into the ones that belong on a generated `<a>`
 * wrapper and the ones that stay on the element itself. Callers that render a
 * real `<a>` (ELEMENTS[type].tag === 'a') keep everything on the one tag.
 * @param {Record<string,string>} record already-sanitized attributes
 * @returns {{link: Record<string,string>, element: Record<string,string>}}
 */
export function splitLinkAttributes(record) {
  /** @type {Record<string,string>} */
  const link = {}
  /** @type {Record<string,string>} */
  const element = {}
  for (const [name, value] of Object.entries(record ?? {})) {
    if (LINK_ATTRS.has(name)) link[name] = value
    else element[name] = value
  }
  return { link, element }
}

/**
 * `target="_blank"` without `rel` lets the opened page reach back through
 * window.opener. Every surface adds the guard, so an author can't ship the hole
 * by forgetting it. An explicit `rel` is left exactly as authored.
 * @param {Record<string,string>} record
 * @returns {Record<string,string>} a new object when a rel was added
 */
export function withSafeRel(record) {
  if (record?.target !== '_blank' || record.rel) return record
  return { ...record, rel: 'noopener noreferrer' }
}

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
 * Keep only allowed attributes, lowercased names with string values. Returns a
 * fresh object (never mutates the input).
 *
 * EMPTY VALUES ARE KEPT. They used to be dropped, which made `alt=""` (the
 * correct markup for a decorative image) and every boolean attribute
 * (`download`, `hidden`, `required`) unexpressible — and because callers infer
 * the rejection reason by diffing key names, the loss was reported as
 * "attribute not allowed", pointing at the wrong thing entirely.
 *
 * `true` coerces to the empty string (so an agent can pass a real boolean) and
 * `false` drops the attribute (absence IS false for booleans).
 */
export function sanitizeAttributes(record) {
  /** @type {Record<string, string>} */
  const out = {}
  if (!record || typeof record !== 'object' || Array.isArray(record)) return out
  for (const [rawName, rawValue] of Object.entries(record)) {
    const name = String(rawName).toLowerCase().trim()
    if (!isAllowedAttribute(name)) continue
    if (rawValue === false) continue
    const value = rawValue == null || rawValue === true ? '' : String(rawValue)
    out[name] = value
  }
  return out
}

/**
 * Serialize one sanitized attribute for static HTML. Boolean attributes with an
 * empty value emit bare; everything else emits `name="value"`, including an
 * explicit empty value.
 * @param {string} name
 * @param {string} value
 * @param {(s: string) => string} escape
 * @returns {string}
 */
export function serializeAttribute(name, value, escape) {
  return value === '' && isBooleanAttribute(name) ? name : `${name}="${escape(value)}"`
}
