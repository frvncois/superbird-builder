// Design-token validation + the @theme block + title template — shared
// VERBATIM by the TS client (src/lib/settings.ts re-exports these) and the
// node exporter (server/export.mjs), which can't import TypeScript.
// Plain-JS ESM; the typed signatures live in src/lib/settings.ts.

export const TOKEN_NAME_RE = /^[a-z][a-z0-9-]*$/
export const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

// Tailwind palette names + keywords a token may not shadow.
// NOTE: the palette portion must stay in sync with TAILWIND_COLORS keys in
// src/lib/colors.ts (the client's name→hex map).
export const RESERVED_TOKEN_NAMES = new Set([
  'slate', 'gray', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
  'neutral', 'stone', 'zinc', 'white', 'black', 'transparent', 'current', 'inherit',
])

export function isValidToken(token) {
  return (
    TOKEN_NAME_RE.test(token.name) &&
    !RESERVED_TOKEN_NAMES.has(token.name) &&
    HEX_RE.test(token.value)
  )
}

// fallback stacks appended after a custom family so a missing webfont still
// degrades sensibly
const MONO_STACK =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
const SERIF_STACK = "ui-serif, Georgia, Cambria, 'Times New Roman', serif"

/** a font-family value safe to drop into CSS: only letters/digits/space/hyphen
 * survive (blocks `;`/`}`/quotes that could break out of the declaration),
 * quoted when it contains a space, with the fallback stack appended. Returns
 * null when nothing usable remains. */
export function fontFamilyValue(family, stack) {
  const clean = String(family ?? '')
    .replace(/[^A-Za-z0-9 -]/g, '')
    .trim()
  if (!clean) return null
  const quoted = clean.includes(' ') ? `'${clean}'` : clean
  return `${quoted}, ${stack}`
}

/** the @theme block fed to Tailwind (canvas runtime + static export);
 * only fully valid tokens are emitted — one bad declaration would poison
 * the shared stylesheet for every user class. Custom mono/serif families
 * (settings.fonts.monoFamily / serifFamily) become --font-mono / --font-serif
 * so `font-mono` / `font-serif` resolve to a designed face. */
export function themeBlock(settings) {
  const lines = (settings?.tokens ?? [])
    .filter(isValidToken)
    .map((t) => `  --color-${t.name}: ${t.value};`)
  const fonts = settings?.fonts ?? {}
  const mono = fontFamilyValue(fonts.monoFamily, MONO_STACK)
  const serif = fontFamilyValue(fonts.serifFamily, SERIF_STACK)
  if (mono) lines.push(`  --font-mono: ${mono};`)
  if (serif) lines.push(`  --font-serif: ${serif};`)
  return lines.length ? `@theme {\n${lines.join('\n')}\n}` : ''
}

/** '%s' in the template is the page name; empty template = just the name */
export const applyTitleTemplate = (template, pageName) => (template || '%s').replaceAll('%s', pageName)
