/**
 * The semantic palette the bundled library is built on — the shadcn set, with
 * neutral light-theme defaults.
 *
 * Adding an entry creates only the tokens it actually names, and never touches
 * one that already exists: the point is that a project restyles the whole
 * library from Settings → Design tokens, so the user's value always wins.
 *
 * Design tokens are hex colours only. Radii, spacing and type scale live in
 * `settings.theme`, so the entries spell those as ordinary Tailwind classes.
 */
export const CATALOG_TOKENS: Record<string, string> = {
  background: '#ffffff',
  foreground: '#0a0a0a',
  card: '#ffffff',
  'card-foreground': '#0a0a0a',
  primary: '#171717',
  'primary-foreground': '#fafafa',
  secondary: '#f5f5f5',
  'secondary-foreground': '#171717',
  muted: '#f5f5f5',
  'muted-foreground': '#737373',
  accent: '#f5f5f5',
  'accent-foreground': '#171717',
  destructive: '#e7000b',
  'destructive-foreground': '#ffffff',
  border: '#e5e5e5',
  input: '#e5e5e5',
  ring: '#a1a1a1',
}

export type CatalogTokenName = keyof typeof CATALOG_TOKENS
