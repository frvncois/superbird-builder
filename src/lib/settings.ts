import type { DesignToken, ProjectSettings } from '@/types/editor'
import { TOKEN_NAME_RE, RESERVED_TOKEN_NAMES } from './shared/tokens.js'

// token validation, the @theme builder and the title template are shared
// verbatim with the node exporter (server/export.mjs)
export {
  TOKEN_NAME_RE,
  HEX_RE,
  RESERVED_TOKEN_NAMES,
  isValidToken,
  themeBlock,
  applyTitleTemplate,
} from './shared/tokens.js'

/** human error for the token name input; null = fine */
export function tokenNameError(name: string, others: DesignToken[]): string | null {
  if (!name) return 'Name required'
  if (!TOKEN_NAME_RE.test(name)) return 'Lowercase letters, digits and dashes only'
  if (RESERVED_TOKEN_NAMES.has(name)) return `"${name}" is a Tailwind color name`
  if (others.some((t) => t.name === name)) return 'Duplicate name'
  return null
}

export const FONT_STACKS: { label: string; value: string }[] = [
  { label: 'System sans', value: 'ui-sans-serif, system-ui, sans-serif' },
  { label: 'Geist', value: "'Geist Variable', ui-sans-serif, system-ui, sans-serif" },
  { label: 'Serif', value: 'ui-serif, Georgia, Cambria, serif' },
  { label: 'Mono', value: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
]

export function defaultSettings(): ProjectSettings {
  return {
    favicon: undefined,
    seo: { siteName: '', titleTemplate: '%s', description: '', ogImage: undefined },
    domain: '',
    smtp: { host: '', port: '', user: '', password: '', from: '' },
    tokens: [],
    customCode: { head: '' },
    fonts: { family: '', googleFontsUrl: undefined },
  }
}
