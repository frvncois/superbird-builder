import { normalizeSyntax } from './syntax'

export interface PageMeta {
  name: string
  slug: string
  status: string
  locale: string
}

/**
 * Canonical page document: a protected @setup block, then the :body
 * wrap — body: is always the last line. Only the setup values and the
 * body content are editable; an empty body keeps one indented line so
 * there is always somewhere to type.
 */
export function buildDocument(meta: PageMeta, bodyLines: string[], bodyArg?: string): string {
  const body = bodyLines.some((l) => l.trim()) ? bodyLines : ['\t']
  return [
    '@setup',
    `\tname: ${meta.name}`,
    `\tslug: ${meta.slug}`,
    `\tstatus: ${meta.status}`,
    `\tlocale: ${meta.locale}`,
    bodyArg ? `:body(${bodyArg})` : ':body',
    ...body,
    'body:',
  ].join('\n')
}

/** the collection bound to the page body, from :body(post) */
export function extractBodyArg(code: string): string | undefined {
  return code.match(/^:body\(([a-z0-9-]+)\)$/m)?.[1]
}

/** normalizes a string into a url slug segment */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** rebuilds a document with new @setup values but the same body */
export function replaceSetup(code: string, meta: PageMeta): string {
  return buildDocument(meta, extractBodyLines(code), extractBodyArg(code))
}

/** The editable lines between :body and body: */
export function extractBodyLines(code: string): string[] {
  const lines = code.split('\n')
  const trimmed = lines.map((l) => l.trim())
  const start = trimmed.findIndex((t) => t === ':body' || t.startsWith(':body('))
  const end = trimmed.lastIndexOf('body:')
  if (start !== -1 && end > start) return lines.slice(start + 1, end)
  // wrapper damaged → salvage whatever still looks like body content
  return lines.filter((l) => {
    const t = l.trim()
    return (
      t &&
      !t.startsWith('@') &&
      !/^(name|slug|status|locale):/.test(t) &&
      t !== ':body' &&
      !t.startsWith(':body(') &&
      t !== 'body:'
    )
  })
}

/**
 * Rebuilds the canonical document from whatever the user typed:
 * the scaffold always comes back, setup values and body content
 * survive. Returns the enforced code plus the parsed meta.
 */
/** reads the @setup values out of a document */
export function parseSetup(value: string): PageMeta {
  return {
    name: value.match(/^\s*name: ?(.*)$/m)?.[1] ?? '',
    slug: value.match(/^\s*slug: ?(.*)$/m)?.[1] ?? '',
    status: value.match(/^\s*status: ?(.*)$/m)?.[1] || 'published',
    locale: value.match(/^\s*locale: ?(.*)$/m)?.[1] || 'en',
  }
}

/**
 * Rewrites the locale value on the @setup line only — never body lines
 * (a body line could trim to `locale: x`). Zero line-count change.
 */
export function setSetupLocale(code: string, locale: string): string {
  const lines = code.split('\n')
  const bodyOpen = lines.findIndex((l) => /^:body(\(|$)/.test(l.trim()))
  const end = bodyOpen === -1 ? lines.length : bodyOpen
  for (let i = 1; i < end; i++) {
    if (/^\s*locale:/.test(lines[i]!)) {
      lines[i] = lines[i]!.replace(/^(\s*locale: ?).*$/, `$1${locale}`)
      return lines.join('\n')
    }
  }
  return code
}

export function enforceDocument(value: string): { code: string; meta: PageMeta } {
  const meta = parseSetup(value)

  // body content: one token per line, at least one tab deep
  const body = normalizeSyntax(extractBodyLines(value).join('\n'))
    .split('\n')
    .map((l) => (l.trim() && !l.startsWith('\t') ? '\t' + l : l))

  return { code: buildDocument(meta, body, extractBodyArg(value)), meta }
}
