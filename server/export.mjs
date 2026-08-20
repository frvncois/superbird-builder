// Static-site exporter: turns a published project snapshot into plain
// HTML files + one compiled CSS + a tiny interaction runtime. Pure JS —
// no Vue; rendering semantics mirror src/components/site/PublicRenderer.vue
// (the SPA dev preview), which is the source of truth for behavior.

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile, optimize } from '@tailwindcss/node'
// Element registry shared verbatim with the client (src/lib/elements.ts
// re-exports this same module) — one source of truth, no drift.
import { ELEMENTS_DATA as ELEMENTS } from '../src/lib/shared/elements.js'
import { themeBlock, applyTitleTemplate } from '../src/lib/shared/tokens.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const RUNTIME = join(ROOT, 'server', 'site-runtime.js')

// SiteView.vue wrapper / PublicRenderer body classes (keep in sync)
const SHELL_CLASSES = 'flex min-h-screen flex-col bg-white font-sans text-black'
const BODY_EXTRA = 'flex-1'
const NOTFOUND_CLASSES =
  'flex flex-1 flex-col items-center justify-center gap-2 text-4xl font-semibold text-sm text-neutral-500'

const SAFE_HREF = /^(\/|#|https?:|mailto:|tel:)/i
const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

// project-settings helpers shared verbatim with the client
// (src/lib/settings.ts re-exports these) — token validation, the @theme
// builder and the title template

// ---------- tiny helpers (duplicated from src/lib) ----------

function walkNodes(nodes, visit) {
  for (const node of nodes) {
    visit(node)
    walkNodes(node.children ?? [], visit)
  }
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const entrySlug = (entry) => entry.slug || slugify(entry.name)

/** slugify each path segment so a user-typed slug/locale/name can't escape
 * the output dir (`..` → '' → dropped) while legitimate nesting survives */
const safePath = (path) => String(path ?? '').split('/').map(slugify).filter(Boolean).join('/')

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

// ---------- locale reads (mirror src/composables/useLocale.ts) ----------

const nodeContent = (node, locale, def) =>
  (locale !== def && node.locales?.[locale]?.content) || node.content

const nodeSrc = (node, locale, def) => (locale !== def && node.locales?.[locale]?.src) || node.src

const entryValue = (entry, field, locale, def) =>
  (locale !== def && entry.locales?.[locale]?.[field]) || entry.values[field]

// ---------- component master pairing (mirror useComponents masterMap) ----------

function buildMasterMap(elements, components) {
  const map = new Map()
  const pair = (inst, master, instanceId, root) => {
    if (inst.type !== master.type) return
    map.set(inst.id, { master, instanceId, root })
    const length = Math.min(inst.children.length, master.children.length)
    for (let i = 0; i < length; i++) pair(inst.children[i], master.children[i], instanceId, root)
  }
  walkNodes(elements, (node) => {
    if (!/^[A-Z]/.test(node.type)) return
    const def = components.find((c) => c.name === node.type)
    if (def) pair(node, def.root, node.id, def.root)
  })
  return map
}

// ---------- interactions ----------

/**
 * Plain (non-component) interaction index for a route, built from every
 * tree the route actually renders (the page plus template trees pulled
 * in by collection-item embeds) — a deliberate improvement over the
 * SPA's activePage-only index.
 * Returns Map<targetNodeId, Interaction[]>.
 */
function buildPlainTargets(page, project) {
  const trees = [page.elements]
  walkNodes(page.elements, (n) => {
    if (n.type === 'collection-item' && n.arg) {
      const col = project.collections.find((c) => c.name === n.arg)
      const tpl = col && project.pages.find((p) => p.id === col.templatePageId)
      const body = tpl?.elements.find((b) => b.type === 'body')
      if (body) trees.push(body.children)
    }
  })
  const index = new Map()
  for (const tree of trees) {
    walkNodes(tree, (owner) => {
      for (const i of owner.interactions ?? []) {
        const key = i.targetId ?? owner.id
        if (!index.has(key)) index.set(key, [])
        index.get(key).push(i)
      }
    })
  }
  return index
}

/** interactions inside a component root targeting a given master node */
function scopedTargets(root, masterId) {
  const list = []
  walkNodes([root], (owner) => {
    for (const i of owner.interactions ?? []) {
      if ((i.targetId ?? owner.id) === masterId) list.push(i)
    }
  })
  return list
}

// ---------- media extraction ----------

function extractMedia(project) {
  const files = new Map() // relPath -> Buffer
  const paths = new Map() // dataUrl -> '/media/...' | null (dropped)

  const intern = (value) => {
    if (typeof value !== 'string' || !value.startsWith('data:')) return
    if (paths.has(value)) return
    const match = value.match(/^data:([^;,]+)(;base64)?,/)
    const ext = match && MIME_EXT[match[1]]
    if (!match || !ext) {
      console.warn(`export: dropping media with unsupported mime ${match?.[1] ?? '?'}`)
      paths.set(value, null)
      return
    }
    const payload = value.slice(match[0].length)
    const buffer = match[2] ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload))
    const hash = createHash('sha1').update(buffer).digest('hex').slice(0, 12)
    const rel = `media/${hash}.${ext}`
    files.set(rel, buffer)
    paths.set(value, `/${rel}`)
  }

  const scanNode = (node) => {
    intern(node.src)
    for (const override of Object.values(node.locales ?? {})) intern(override.src)
  }
  intern(project.settings?.favicon)
  intern(project.settings?.seo?.ogImage)
  for (const page of project.pages) walkNodes(page.elements, scanNode)
  for (const component of project.components ?? []) walkNodes([component.root], scanNode)
  for (const collection of project.collections ?? []) {
    const imageFields = collection.fields.filter((f) => f.type === 'image').map((f) => f.name)
    for (const entry of collection.entries) {
      for (const field of imageFields) {
        intern(entry.values[field])
        for (const values of Object.values(entry.locales ?? {})) intern(values[field])
      }
    }
  }

  const rewrite = (value) =>
    typeof value === 'string' && value.startsWith('data:') ? (paths.get(value) ?? undefined) : value
  return { rewrite, files }
}

// ---------- CSS ----------

function collectCandidates(project) {
  const candidates = new Set()
  const add = (classString) => {
    for (const token of (classString ?? '').split(/\s+/)) if (token) candidates.add(token)
  }
  const scanNode = (node) => {
    add(node.classes)
    for (const i of node.interactions ?? []) {
      add(i.toClasses)
      add(i.duration)
      add(i.easing)
      candidates.add('transition-all')
    }
  }
  for (const page of project.pages) walkNodes(page.elements, scanNode)
  for (const component of project.components ?? []) walkNodes([component.root], scanNode)
  add(SHELL_CLASSES)
  add(BODY_EXTRA)
  add(NOTFOUND_CLASSES)
  return candidates
}

async function buildCss(candidates, settings) {
  const input = '@import "tailwindcss";\n' + themeBlock(settings)
  const compiler = await compile(input, { base: ROOT, onDependency() {} })
  const css = compiler.build([...candidates])
  return optimize(css, { minify: true }).code
}

// ---------- HTML serialization ----------
// ctx: { project, locale, defaultLocale, scope, mm, plainTargets, fx, rewrite, itemStack }

function classFor(node, ctx) {
  const mapping = ctx.mm.get(node.id)
  const parts = [node.type === 'body' && BODY_EXTRA, mapping ? mapping.master.classes : node.classes]
  if (mapping) {
    for (const i of scopedTargets(mapping.root, mapping.master.id)) {
      parts.push(`transition-all ${i.duration} ${i.easing}`)
    }
  } else {
    for (const i of ctx.plainTargets.get(node.id) ?? []) {
      parts.push(`transition-all ${i.duration} ${i.easing}`)
    }
  }
  return parts.filter(Boolean).join(' ').trim()
}

function attrsFor(node, ctx) {
  const mapping = ctx.mm.get(node.id)
  const def = ELEMENTS[node.type]
  const attrs = []
  if (node.htmlId) attrs.push(`id="${escapeHtml(node.htmlId)}"`)

  const classes = classFor(node, ctx)
  if (classes) attrs.push(`class="${escapeHtml(classes)}"`)

  // src: bound image field first, else the node's own (locale-aware)
  const field = ctx.scope
    ? ctx.scope.collection.fields.find((f) => f.name === node.arg)
    : null
  let src
  if (field?.type === 'image' && ctx.scope.entry) {
    src = entryValue(ctx.scope.entry, field.name, ctx.locale, ctx.defaultLocale)
  }
  src ||= nodeSrc(node, ctx.locale, ctx.defaultLocale)
  src = ctx.rewrite(src)
  if (src) attrs.push(`src="${escapeHtml(src)}"`)

  // href: link elements only, scheme-allowlisted, locale-prefixed internals.
  // Locale-explicit links (/fr, /en/about) are absolute — never re-prefixed,
  // default-locale prefix normalizes away (locale-switcher authoring).
  if (def?.tag === 'a') {
    const raw = node.link ?? mapping?.master.link
    if (raw && SAFE_HREF.test(raw)) {
      let href = raw
      if (raw.startsWith('/')) {
        const first = raw.split('/')[1] ?? ''
        if (ctx.project.locales.includes(first)) {
          if (first === ctx.defaultLocale) href = raw.slice(first.length + 1) || '/'
        } else if (ctx.locale !== ctx.defaultLocale) {
          href = `/${ctx.locale}${raw === '/' ? '' : raw}`
        }
      }
      attrs.push(`href="${escapeHtml(href)}"`)
    }
  }

  // interaction wiring for the runtime
  const triggers = (mapping ? mapping.master.interactions : node.interactions) ?? []
  if (triggers.length) {
    const list = triggers.map((i) => {
      const key = mapping ? `${i.id}@${mapping.instanceId}` : i.id
      ctx.fx[key] = i.toClasses
      return { t: i.trigger, k: key }
    })
    attrs.push(`data-int="${escapeHtml(JSON.stringify(list))}"`)
  }
  const targetKeys = mapping
    ? scopedTargets(mapping.root, mapping.master.id).map((i) => `${i.id}@${mapping.instanceId}`)
    : (ctx.plainTargets.get(node.id) ?? []).map((i) => i.id)
  if (targetKeys.length) {
    for (const key of targetKeys) ctx.fx[key] ??= ''
    attrs.push(`data-tgt="${escapeHtml(targetKeys.join(' '))}"`)
  }

  return attrs.length ? ' ' + attrs.join(' ') : ''
}

function renderNode(node, ctx) {
  const def = ELEMENTS[node.type]
  const tag = def?.tag ?? 'div'

  if (node.type === 'collection-list') {
    const collection = node.arg
      ? ctx.project.collections.find((c) => c.name === node.arg)
      : null
    const inner = collection
      ? collection.entries
          .map((entry) => {
            const inner2 = { ...ctx, scope: { collection, entry } }
            return node.children.map((child) => renderNode(child, inner2)).join('')
          })
          .join('')
      : ''
    return `<${tag}${attrsFor(node, ctx)}>${inner}</${tag}>`
  }

  if (node.type === 'collection-item') {
    const collection = node.arg
      ? ctx.project.collections.find((c) => c.name === node.arg)
      : null
    const entry = collection?.entries.find((e) => e.id === node.entryId) ?? null
    const selfNested = !!ctx.scope && !!collection && ctx.scope.collection.id === collection.id
    let inner = ''
    if (collection && entry && !selfNested) {
      const template = ctx.project.pages.find((p) => p.id === collection.templatePageId)
      const body = template?.elements.find((b) => b.type === 'body')
      if (body) {
        const inner2 = {
          ...ctx,
          scope: { collection, entry },
          mm: buildMasterMap(body.children, ctx.project.components),
        }
        inner = body.children.map((child) => renderNode(child, inner2)).join('')
      }
    }
    return `<${tag}${attrsFor(node, ctx)}>${inner}</${tag}>`
  }

  if (def?.void) return `<${tag}${attrsFor(node, ctx)}>`

  let inner
  if (node.children.length) {
    inner = node.children.map((child) => renderNode(child, ctx)).join('')
  } else {
    const mapping = ctx.mm.get(node.id)
    const field = ctx.scope
      ? ctx.scope.collection.fields.find((f) => f.name === node.arg)
      : null
    let text
    if (field) {
      // bound fields with no entry/value render empty on the public site
      text = ctx.scope.entry
        ? (entryValue(ctx.scope.entry, field.name, ctx.locale, ctx.defaultLocale) ?? '')
        : ''
    } else {
      text =
        nodeContent(node, ctx.locale, ctx.defaultLocale) ||
        (mapping ? nodeContent(mapping.master, ctx.locale, ctx.defaultLocale) : undefined) ||
        def?.defaultContent ||
        ''
    }
    inner = escapeHtml(text)
  }
  return `<${tag}${attrsFor(node, ctx)}>${inner}</${tag}>`
}

/** the shared head + body-open shell for every exported page */
function renderShell(project, rewrite, { locale, title, description, path }) {
  const settings = project.settings ?? {}
  const seo = settings.seo ?? {}
  const domain = settings.domain || ''
  const absolute = (rel) => (domain && rel?.startsWith('/') ? `https://${domain}${rel}` : rel)

  let head =
    `<!doctype html><html lang="${escapeHtml(locale)}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(title)}</title>`
  if (description) head += `<meta name="description" content="${escapeHtml(description)}">`
  head += `<meta property="og:title" content="${escapeHtml(title)}">`
  if (seo.siteName) head += `<meta property="og:site_name" content="${escapeHtml(seo.siteName)}">`
  if (description) head += `<meta property="og:description" content="${escapeHtml(description)}">`
  const ogImage = rewrite(seo.ogImage)
  if (ogImage) head += `<meta property="og:image" content="${escapeHtml(absolute(ogImage))}">`
  const favicon = rewrite(settings.favicon)
  if (favicon) head += `<link rel="icon" href="${escapeHtml(favicon)}">`
  if (domain && path) head += `<link rel="canonical" href="${escapeHtml(`https://${domain}${path}`)}">`
  head += `<link rel="stylesheet" href="/site.css">`
  const fontsUrl = settings.fonts?.googleFontsUrl
  if (fontsUrl?.startsWith('https://fonts.googleapis.com/')) {
    head += `<link rel="stylesheet" href="${escapeHtml(fontsUrl)}">`
  }
  // owner-authored raw head HTML, last — same trust level as the site itself
  if (settings.customCode?.head) head += settings.customCode.head
  head += `</head>`

  const fontStyle = settings.fonts?.family
    ? ` style="font-family:${escapeHtml(settings.fonts.family)}"`
    : ''
  return head + `<body class="${SHELL_CLASSES}"${fontStyle}>`
}

function renderPage(route, project, rewrite) {
  const { page, locale, scope, outPath } = route
  const ctx = {
    project,
    locale,
    defaultLocale: project.defaultLocale,
    scope,
    mm: buildMasterMap(page.elements, project.components),
    plainTargets: buildPlainTargets(page, project),
    fx: {},
    rewrite,
  }
  const body = page.elements.map((node) => renderNode(node, ctx)).join('')
  const hasInteractions = Object.keys(ctx.fx).length > 0
  const tail = hasInteractions
    ? `<script type="application/json" id="int-fx">${JSON.stringify(ctx.fx).replaceAll('</', '<\\/')}</script><script src="/site.js" defer></script>`
    : ''
  const seo = project.settings?.seo ?? {}
  const shell = renderShell(project, rewrite, {
    locale,
    title: page.seo?.title ?? applyTitleTemplate(seo.titleTemplate, page.name),
    description: page.seo?.description ?? seo.description ?? '',
    path: '/' + (outPath ?? '').replace(/index\.html$/, ''),
  })
  return `${shell}${body}${tail}</body></html>`
}

function renderNotFound(project, rewrite) {
  const shell = renderShell(project, rewrite, {
    locale: project.defaultLocale,
    title: '404',
    description: '',
    path: '',
  })
  return (
    `${shell}<div class="flex flex-1 flex-col items-center justify-center gap-2">` +
    `<p class="text-4xl font-semibold">404</p>` +
    `<p class="text-sm text-neutral-500">This page could not be found.</p>` +
    `</div></body></html>`
  )
}

// ---------- routes ----------

function enumerateRoutes(project) {
  const routes = []
  const locales = ['', ...(project.locales ?? []).filter((l) => l !== project.defaultLocale)]

  for (const prefix of locales) {
    const locale = prefix || project.defaultLocale
    const dir = prefix ? `${safePath(prefix)}/` : ''

    for (const page of project.pages) {
      if (page.status !== 'published') continue
      const seg = safePath(page.path)
      const rel = seg ? `${seg}/` : ''
      // bare collection-template paths render with an empty entry scope
      const collection = page.collectionId
        ? (project.collections.find((c) => c.id === page.collectionId) ?? null)
        : null
      routes.push({
        outPath: `${dir}${rel}index.html`,
        page,
        locale,
        scope: collection ? { collection, entry: null } : null,
      })
    }

    for (const collection of project.collections ?? []) {
      const template = project.pages.find((p) => p.id === collection.templatePageId)
      if (!template || template.status !== 'published') continue
      for (const entry of collection.entries) {
        routes.push({
          outPath: `${dir}${safePath(collection.name)}/${safePath(entrySlug(entry))}/index.html`,
          page: template,
          locale,
          scope: { collection, entry },
        })
      }
    }
  }
  return routes
}

// ---------- top level ----------

export async function exportSite(project, outDir) {
  const media = extractMedia(project)
  const css = await buildCss(collectCandidates(project), project.settings)
  const runtime = await readFile(RUNTIME)

  const tmp = `${outDir}.tmp-${Date.now()}`
  await mkdir(tmp, { recursive: true })

  const tmpAbs = resolve(tmp)
  let bytes = 0
  const write = async (rel, data) => {
    const file = join(tmp, rel)
    // hard backstop: never write outside the output dir, whatever the
    // (server-untrusted) page path / locale / collection name contained
    if (file !== tmpAbs && !file.startsWith(tmpAbs + sep)) {
      throw new Error(`export: refusing to write outside the output dir (${rel})`)
    }
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, data)
    bytes += typeof data === 'string' ? Buffer.byteLength(data) : data.length
  }

  await write('site.css', css)
  await write('site.js', runtime)
  await write('404.html', renderNotFound(project, media.rewrite))
  for (const [rel, buffer] of media.files) await write(rel, buffer)

  const routes = enumerateRoutes(project)
  const written = new Set()
  for (const route of routes) {
    if (written.has(route.outPath)) continue // page paths win over entry collisions
    written.add(route.outPath)
    await write(route.outPath, renderPage(route, project, media.rewrite))
  }

  // atomic swap: the old site stays live until the new one is complete
  const old = `${outDir}.old-${Date.now()}`
  if (existsSync(outDir)) await rename(outDir, old)
  await rename(tmp, outDir)
  await rm(old, { recursive: true, force: true })

  return { routes: written.size, bytes }
}
