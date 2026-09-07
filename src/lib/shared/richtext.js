// Rich-text sanitizer shared VERBATIM by the editor, the SPA preview and
// the static exporter — plain JS, no DOM, so it runs identically in the
// browser and in Node (server/export.mjs).
//
// Content is user-authored HTML restricted to a tiny inline subset. The
// sanitizer is allowlist-based: allowed tags are re-emitted in canonical
// form (all attributes dropped except a validated href), disallowed tags
// are stripped (their text kept), text is entity-escaped, and open tags
// are balanced so a fragment can never break out of its element.

import { SAFE_HREF } from './urls.js'

const ALLOWED = {
  b: {},
  strong: {},
  i: {},
  em: {},
  u: {},
  mark: {},
  br: { void: true },
  ul: {},
  ol: {},
  li: {},
  a: { href: true },
}

const escapeText = (s) => s.replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const escapeAttr = (s) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')

/** true when a string uses any of the allowed rich tags */
export function isRich(value) {
  return typeof value === 'string' && /<\/?(b|strong|i|em|u|mark|a|ul|ol|li|br)[\s>/]/i.test(value)
}

/** sanitize a rich-text fragment to the allowed subset (idempotent) */
export function sanitizeRich(html) {
  if (typeof html !== 'string' || !html) return ''
  const out = []
  const open = []
  for (const token of html.match(/<[^>]*>|[^<]+|</g) ?? []) {
    if (token[0] !== '<' || token.length === 1) {
      out.push(escapeText(token))
      continue
    }
    // real tags have no space before the name — '< b and c >' is prose
    const match = token.match(/^<(\/?)([a-zA-Z0-9]+)([^>]*)>$/)
    if (!match) {
      out.push(escapeText(token))
      continue
    }
    const closing = match[1] === '/'
    const tag = match[2].toLowerCase()
    const spec = ALLOWED[tag]
    if (!spec) continue // disallowed tag stripped, inner text survives
    if (spec.void) {
      if (!closing) out.push(`<${tag}>`)
      continue
    }
    if (closing) {
      // close intervening unclosed tags so nesting stays valid
      const at = open.lastIndexOf(tag)
      if (at === -1) continue // stray close — drop
      for (let i = open.length - 1; i >= at; i--) out.push(`</${open[i]}>`)
      open.length = at
      continue
    }
    if (tag === 'a') {
      const href = match[3].match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
      const raw = (href?.[1] ?? href?.[2] ?? href?.[3] ?? '').trim()
      const safe = SAFE_HREF.test(raw) ? raw : ''
      out.push(safe ? `<a href="${escapeAttr(safe)}" rel="noopener">` : '<a>')
    } else {
      out.push(`<${tag}>`)
    }
    open.push(tag)
  }
  for (let i = open.length - 1; i >= 0; i--) out.push(`</${open[i]}>`)
  return out.join('')
}
