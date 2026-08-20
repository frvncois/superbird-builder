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

/** the @theme block fed to Tailwind (canvas runtime + static export);
 * only fully valid tokens are emitted — one bad declaration would poison
 * the shared stylesheet for every user class */
export function themeBlock(settings) {
  const lines = (settings?.tokens ?? [])
    .filter(isValidToken)
    .map((t) => `  --color-${t.name}: ${t.value};`)
  return lines.length ? `@theme {\n${lines.join('\n')}\n}` : ''
}

/** '%s' in the template is the page name; empty template = just the name */
export const applyTitleTemplate = (template, pageName) => (template || '%s').replaceAll('%s', pageName)
