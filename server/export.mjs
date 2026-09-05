// Static-site exporter: turns a published project snapshot into plain
// HTML files + one compiled CSS + a tiny interaction runtime. Pure JS —
// no Vue; rendering semantics mirror src/components/site/PublicRenderer.vue
// (the SPA dev preview), which is the source of truth for behavior.

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile, optimize } from '@tailwindcss/node'
// Element registry shared verbatim with the client (src/lib/elements.ts
// re-exports this same module) — one source of truth, no drift.
import { ELEMENTS_DATA as ELEMENTS } from '../src/lib/shared/elements.js'
import { themeBlock, applyTitleTemplate } from '../src/lib/shared/tokens.js'
import { resolveBinding, resolveListScope, refDisplay } from '../src/lib/shared/fields.js'
import { evaluateConditions, staticMatch } from '../src/lib/shared/conditions.js'
import { isRich, sanitizeRich } from '../src/lib/shared/richtext.js'
import { backgroundRender } from '../src/lib/shared/background.js'
import { SAFE_HREF, SAFE_SRC } from '../src/lib/shared/urls.js'
import { slugify, entrySlug } from '../src/lib/shared/slug.js'
import { walkNodes } from './util.mjs'
import { extractMedia } from './export-media.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const RUNTIME = join(ROOT, 'server', 'site-runtime.js')

// SiteView.vue wrapper / PublicRenderer body classes (keep in sync)
// the published <body> IS the page's body node — its classes are user-owned.
// The old shell defaults live in @layer base instead, so any utility the
// user puts on body (bg-*, text-*, …) wins by layer order, never by luck.
const SANS_STACK =
  'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"'
function baseBodyCss(settings) {
  const family = settings?.fonts?.family
  const safe = family && /^[\w\s,'"-]+$/.test(family) ? family : null
  return (
    '@layer base{body{display:flex;min-height:100vh;flex-direction:column;' +
    `background-color:#fff;color:#000;font-family:${safe ?? SANS_STACK};}}\n`
  )
}
const NOTFOUND_CLASSES =
  'flex flex-1 flex-col items-center justify-center gap-2 text-4xl font-semibold text-sm text-neutral-500'

// project-settings helpers shared verbatim with the client
// (src/lib/settings.ts re-exports these) — token validation, the @theme
// builder and the title template

// ---------- tiny helpers ----------

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

// reference fields store ids (possibly arrays) — those never read as text
const baseEntryText = (entry, field) =>
  typeof entry.values[field] === 'string' ? entry.values[field] : undefined

const entryValue = (entry, field, locale, def) =>
  (locale !== def && entry.locales?.[locale]?.[field]) || baseEntryText(entry, field)

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

// ---------- CSS ----------

function collectCandidates(project) {
  const candidates = new Set()
  const anim = new Map((project.interactions ?? []).map((a) => [a.id, a]))
  const add = (classString) => {
    for (const token of (classString ?? '').split(/\s+/)) if (token) candidates.add(token)
  }
  const scanNode = (node) => {
    add(node.classes)
    for (const b of node.interactions ?? []) {
      const a = anim.get(b.interactionId)
      if (!a) continue
      add(a.toClasses)
      add(a.duration)
      add(a.easing)
      candidates.add('transition-all')
    }
  }
  for (const page of project.pages) walkNodes(page.elements, scanNode)
  for (const component of project.components ?? []) walkNodes([component.root], scanNode)
  add(NOTFOUND_CLASSES)
  return candidates
}

async function buildCss(candidates, settings) {
  const input = '@import "tailwindcss";\n' + baseBodyCss(settings) + themeBlock(settings)
  const compiler = await compile(input, { base: ROOT, onDependency() {} })
  const css = compiler.build([...candidates])
  return optimize(css, { minify: true }).code
}

// ---------- HTML serialization ----------
// ctx: { project, locale, defaultLocale, scope, mm, plainTargets, fx, rewrite, itemStack }

function classFor(node, ctx) {
  const mapping = ctx.mm.get(node.id)
  const parts = [mapping ? mapping.master.classes : node.classes]
  const bindings = mapping
    ? scopedTargets(mapping.root, mapping.master.id)
    : (ctx.plainTargets.get(node.id) ?? [])
  for (const b of bindings) {
    const a = ctx.anim.get(b.interactionId)
    if (a) parts.push(`transition-all ${a.duration} ${a.easing}`)
  }
  return parts.filter(Boolean).join(' ').trim()
}

/**
 * Final href for a linked node, or null. '@item' resolves to the current
 * entry's page; scheme-allowlisted; internal links get locale-prefixed.
 * Mirrors PublicRenderer/PreviewRenderer linkTarget — keep the three in sync.
 */
function resolveHref(node, ctx) {
  const mapping = ctx.mm.get(node.id)
  let raw = node.link ?? mapping?.master.link
  if (raw === '@item') {
    raw = ctx.scope?.entry
      ? `/${ctx.scope.collection.name}/${entrySlug(ctx.scope.entry)}`
      : null
  }
  if (!raw || !SAFE_HREF.test(raw)) return null
  let href = raw
  if (raw.startsWith('/')) {
    const first = raw.split('/')[1] ?? ''
    if (ctx.project.locales.includes(first)) {
      if (first === ctx.defaultLocale) href = raw.slice(first.length + 1) || '/'
    } else if (ctx.locale !== ctx.defaultLocale) {
      href = `/${ctx.locale}${raw === '/' ? '' : raw}`
    }
  }
  return href
}

/** wraps a non-anchor linked element in an <a> so it navigates without JS;
 * display:contents keeps the wrapper out of the layout */
function linkWrap(html, node, ctx) {
  if (ELEMENTS[node.type]?.tag === 'a') return html
  const href = resolveHref(node, ctx)
  return href ? `<a href="${escapeHtml(href)}" class="contents">${html}</a>` : html
}

function attrsFor(node, ctx, cond, runtime, bg) {
  const mapping = ctx.mm.get(node.id)
  const def = ELEMENTS[node.type]
  const attrs = []
  if (node.htmlId) attrs.push(`id="${escapeHtml(node.htmlId)}"`)

  // browser-evaluated condition (viewport/date/query): script.js reads this.
  // A 'show' effect starts hidden so nothing flashes before evaluation.
  if (runtime) {
    attrs.push(`data-cond="${escapeHtml(JSON.stringify(runtime))}"`)
    if (runtime.e === 'show') attrs.push('hidden')
  }

  const classes = [classFor(node, ctx), bg?.hostClass].filter(Boolean).join(' ')
  if (classes) attrs.push(`class="${escapeHtml(classes)}"`)
  if (bg?.style) attrs.push(`style="${escapeHtml(bg.style)}"`)

  // src: condition swap first, then bound image field (possibly through a
  // reference hop), else the node's own (locale-aware)
  const binding = ctx.scope
    ? resolveBinding(ctx.project.collections, ctx.scope.collection, ctx.scope.entry, node.arg)
    : null
  let src = cond?.src || undefined
  if (!src && binding?.field.type === 'image' && binding.entry) {
    src = entryValue(binding.entry, binding.field.name, ctx.locale, ctx.defaultLocale)
  }
  src ||= nodeSrc(node, ctx.locale, ctx.defaultLocale)
  const rawSrc = src // pre-rewrite value — library alt lookup keys on it
  src = ctx.rewrite(src)
  if (src && SAFE_SRC.test(src)) attrs.push(`src="${escapeHtml(src)}"`)
  // images always carry alt: the library asset's default, or '' (decorative)
  if (def?.tag === 'img') attrs.push(`alt="${escapeHtml(ctx.altFor?.(rawSrc) ?? '')}"`)

  // href: link elements only, scheme-allowlisted, locale-prefixed internals.
  // href on <a> elements; non-anchor linked elements are wrapped instead
  // (see renderNode). Locale-explicit links are absolute; default-locale
  // prefix normalizes away (locale-switcher authoring).
  if (def?.tag === 'a') {
    const href = resolveHref(node, ctx)
    if (href) attrs.push(`href="${escapeHtml(href)}"`)
  }

  // interaction wiring for the runtime
  const triggers = (mapping ? mapping.master.interactions : node.interactions) ?? []
  if (triggers.length) {
    const list = triggers.map((i) => {
      const key = mapping ? `${i.id}@${mapping.instanceId}` : i.id
      ctx.fx[key] = ctx.anim.get(i.interactionId)?.toClasses ?? ''
      if (i.breakpoints) ctx.fxbp[key] = i.breakpoints
      return { t: i.trigger, k: key }
    })
    attrs.push(`data-int="${escapeHtml(JSON.stringify(list))}"`)
  }
  const targets = mapping
    ? scopedTargets(mapping.root, mapping.master.id)
    : (ctx.plainTargets.get(node.id) ?? [])
  if (targets.length) {
    const targetKeys = targets.map((i) => (mapping ? `${i.id}@${mapping.instanceId}` : i.id))
    targets.forEach((i, n) => {
      const key = targetKeys[n]
      ctx.fx[key] ??= ''
      if (i.breakpoints) ctx.fxbp[key] = i.breakpoints
    })
    attrs.push(`data-tgt="${escapeHtml(targetKeys.join(' '))}"`)
  }

  return attrs.length ? ' ' + attrs.join(' ') : ''
}

/**
 * Condition evaluation for a node (mirrors useRenderNode.condition).
 * Fully static specs resolve here: hidden → drop, swap → baked. A spec
 * whose static rules pass but that also has runtime rules defers to the
 * browser instead: `runtime` describes the data-cond attribute to emit
 * (rules + effect + pre-sanitized swap payload) and script.js evaluates it.
 */
function conditionFor(node, ctx) {
  const mapping = ctx.mm.get(node.id)
  const spec = (mapping ? mapping.master.conditions : node.conditions) ?? null
  if (!spec?.rules?.length) return { cond: { visible: true }, runtime: null }
  const condCtx = {
    collections: ctx.project.collections ?? [],
    collection: ctx.scope?.collection ?? null,
    entry: ctx.scope?.entry ?? null,
    locale: ctx.locale,
    defaultLocale: ctx.defaultLocale,
    pagePath: ctx.pagePath,
    index: ctx.scope?.index,
    count: ctx.scope?.count,
  }
  const { matched, runtime } = staticMatch(spec, condCtx)
  if (!runtime.length) return { cond: evaluateConditions(spec, condCtx), runtime: null }
  if (!matched) {
    // static rules already fail — the spec can never fully match
    if (spec.effect === 'show') return { cond: { visible: false }, runtime: null }
    return { cond: { visible: true }, runtime: null } // hide/swap render plainly
  }
  const attr = { e: spec.effect, r: runtime.map((r) => ({ p: r.path, o: r.op, v: r.value })) }
  if (spec.effect === 'swap') {
    if (spec.swapContent) {
      attr.h = isRich(spec.swapContent)
      attr.c = attr.h ? sanitizeRich(spec.swapContent) : spec.swapContent
    }
    if (spec.swapSrc) {
      const s = ctx.rewrite(spec.swapSrc)
      if (s && SAFE_SRC.test(s)) attr.s = s
    }
  }
  return { cond: { visible: true }, runtime: attr }
}

function renderNode(node, ctx) {
  const def = ELEMENTS[node.type]
  const tag = def?.tag ?? 'div'

  // condition-hidden elements are dropped from the static output entirely
  const { cond, runtime } = conditionFor(node, ctx)
  if (!cond.visible) return ''
  if (runtime) ctx.flags.condRuntime = true

  if (node.type === 'collection-list') {
    // the arg names a collection (all entries) or a multi-reference field
    // of the surrounding scope entry (mirrors useRenderNode.listScope)
    const list = resolveListScope(
      ctx.project.collections,
      ctx.scope?.collection ?? null,
      ctx.scope?.entry ?? null,
      node.arg,
    )
    const inner = list
      ? list.entries
          .map((entry, index) => {
            const inner2 = {
              ...ctx,
              scope: { collection: list.collection, entry, index, count: list.entries.length },
            }
            return node.children.map((child) => renderNode(child, inner2)).join('')
          })
          .join('')
      : ''
    return linkWrap(`<${tag}${attrsFor(node, ctx, cond, runtime)}>${inner}</${tag}>`, node, ctx)
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
    return linkWrap(`<${tag}${attrsFor(node, ctx, cond, runtime)}>${inner}</${tag}>`, node, ctx)
  }

  if (def?.void) return linkWrap(`<${tag}${attrsFor(node, ctx, cond, runtime)}>`, node, ctx)

  // background media: image → CSS bg on the host, video → a layer behind content
  const bg = backgroundFor(node, ctx)
  const bgLayer =
    bg?.kind === 'video'
      ? `<video src="${escapeHtml(bg.url)}" autoplay muted loop playsinline class="${escapeHtml(bg.layerClass)}"></video>`
      : ''

  let inner
  if (node.children.length) {
    inner = node.children.map((child) => renderNode(child, ctx)).join('')
  } else {
    const mapping = ctx.mm.get(node.id)
    // binding may hop one reference ('author.name') — mirrors useRenderNode
    const binding = ctx.scope
      ? resolveBinding(ctx.project.collections, ctx.scope.collection, ctx.scope.entry, node.arg)
      : null
    let text
    if (cond.content != null && cond.content !== '') {
      // an active condition swap wins over every other content source
      text = cond.content
    } else if (binding) {
      const { field, entry } = binding
      // bound fields with no entry/value render empty on the public site;
      // a directly-bound reference reads as the referenced entry name(s)
      if (field.type === 'reference' || field.type === 'multi-reference') {
        text = entry ? refDisplay(ctx.project.collections, field, entry) : ''
      } else {
        text = entry ? (entryValue(entry, field.name, ctx.locale, ctx.defaultLocale) ?? '') : ''
      }
    } else {
      text =
        nodeContent(node, ctx.locale, ctx.defaultLocale) ||
        (mapping ? nodeContent(mapping.master, ctx.locale, ctx.defaultLocale) : undefined) ||
        def?.defaultContent ||
        ''
    }
    // rich text emits its sanitized subset; anything else is fully escaped
    inner = isRich(text) ? sanitizeRich(text) : escapeHtml(text)
  }
  return linkWrap(`<${tag}${attrsFor(node, ctx, cond, runtime, bg)}>${bgLayer}${inner}</${tag}>`, node, ctx)
}

/** background-media descriptor for a node (mirrors useRenderNode.backgroundInfo) */
function backgroundFor(node, ctx) {
  const mapping = ctx.mm.get(node.id)
  const styleNode = mapping ? mapping.master : node
  const ref = styleNode.background
  if (!ref) return null
  const url = ctx.rewrite(ref)
  if (!SAFE_SRC.test(url)) return null
  const kind = ctx.kindFor(ref)
  const tokens = (styleNode.classes ?? '').split(/\s+/).filter(Boolean)
  return backgroundRender(kind, url, tokens)
}

/** wrap author JS in a <script>, escaping any literal </script so it can't break out */
function scriptTag(js) {
  return js && js.trim() ? `<script>${js.replace(/<\/script/gi, '<\\/script')}</script>` : ''
}

/** the shared head + body-open shell for every exported page */
function renderShell(project, rewrite, { locale, title, description, path, headScript, bodyAttrs }) {
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
  // same scheme allowlist as every other URL sink (FINDINGS S15)
  const ogImage = rewrite(seo.ogImage)
  if (ogImage && SAFE_SRC.test(ogImage))
    head += `<meta property="og:image" content="${escapeHtml(absolute(ogImage))}">`
  const favicon = rewrite(settings.favicon)
  if (favicon && SAFE_SRC.test(favicon)) head += `<link rel="icon" href="${escapeHtml(favicon)}">`
  if (domain && path) head += `<link rel="canonical" href="${escapeHtml(`https://${domain}${path}`)}">`
  head += `<link rel="stylesheet" href="/assets/style.css">`
  const fontsUrl = settings.fonts?.googleFontsUrl
  if (fontsUrl?.startsWith('https://fonts.googleapis.com/')) {
    head += `<link rel="stylesheet" href="${escapeHtml(fontsUrl)}">`
  }
  // owner-authored raw head HTML, last — same trust level as the site itself
  if (settings.customCode?.head) head += settings.customCode.head
  if (headScript) head += headScript // per-page head script
  head += `</head>`

  // font-family + layout/color defaults come from @layer base (baseBodyCss);
  // bodyAttrs carries the body NODE's classes/id/interactions/background
  return head + `<body${bodyAttrs ?? ''}>`
}

function renderPage(route, project, media) {
  const { page, locale, scope, outPath } = route
  const ctx = {
    project,
    locale,
    defaultLocale: project.defaultLocale,
    scope,
    pagePath: page.path,
    mm: buildMasterMap(page.elements, project.components),
    plainTargets: buildPlainTargets(page, project),
    // saved-interaction id → animation, for resolving bindings to timing/classes
    anim: new Map((project.interactions ?? []).map((a) => [a.id, a])),
    fx: {},
    // interaction key → breakpoint ids it's scoped to (absent = all breakpoints)
    fxbp: {},
    rewrite: media.rewrite,
    altFor: media.altFor,
    kindFor: media.kindFor,
    // shared by reference across per-scope ctx spreads, unlike plain fields
    flags: { condRuntime: false },
  }
  // the body node renders as the document <body> itself: children inline,
  // classes/id/interactions/background on the real tag (a video background
  // becomes the first child layer, like any other host)
  const bodyNode = page.elements.find((n) => n.type === 'body') ?? null
  const roots = bodyNode ? bodyNode.children : page.elements
  const body = roots.map((node) => renderNode(node, ctx)).join('')
  let bodyAttrs = ''
  let bodyBgLayer = ''
  if (bodyNode) {
    const bg = backgroundFor(bodyNode, ctx)
    bodyAttrs = attrsFor(bodyNode, ctx, { visible: true }, null, bg)
    if (bg?.kind === 'video') {
      bodyBgLayer = `<video src="${escapeHtml(bg.url)}" autoplay muted loop playsinline class="${escapeHtml(bg.layerClass)}"></video>`
    }
  }
  const hasInteractions = Object.keys(ctx.fx).length > 0
  const needsRuntime = hasInteractions || ctx.flags.condRuntime
  const jsonTag = (id, data) =>
    `<script type="application/json" id="${id}">${JSON.stringify(data).replaceAll('</', '<\\/')}</script>`
  const fxTag = hasInteractions ? jsonTag('int-fx', ctx.fx) : ''
  // breakpoint-scoped interactions need the width→breakpoint map + per-key scope
  const hasBpScope = Object.keys(ctx.fxbp).length > 0
  const bpTag = hasBpScope
    ? jsonTag('int-bp', (project.breakpoints ?? []).map((b) => ({ id: b.id, w: b.width }))) +
      jsonTag('int-fxbp', ctx.fxbp)
    : ''
  const tail = needsRuntime ? `${fxTag}${bpTag}<script src="/assets/script.js" defer></script>` : ''
  const seo = project.settings?.seo ?? {}
  const shell = renderShell(project, media.rewrite, {
    locale,
    title: page.seo?.title ?? applyTitleTemplate(seo.titleTemplate, page.name),
    description: page.seo?.description ?? seo.description ?? '',
    path: '/' + (outPath ?? '').replace(/index\.html$/, ''),
    headScript: scriptTag(page.customCode?.head),
    bodyAttrs,
  })
  // per-page body script runs last, before </body> (DOM + runtime ready)
  return `${shell}${bodyBgLayer}${body}${tail}${scriptTag(page.customCode?.body)}</body></html>`
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
  const media = await extractMedia(project)
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

  await write('assets/style.css', css)
  await write('assets/script.js', runtime)
  await write('404.html', renderNotFound(project, media.rewrite))
  for (const [rel, buffer] of media.files) await write(rel, buffer)

  const routes = enumerateRoutes(project)
  const written = new Set()
  for (const route of routes) {
    if (written.has(route.outPath)) continue // page paths win over entry collisions
    written.add(route.outPath)
    await write(route.outPath, renderPage(route, project, media))
  }

  // atomic swap: the old site stays live until the new one is complete
  const old = `${outDir}.old-${Date.now()}`
  if (existsSync(outDir)) await rename(outDir, old)
  await rename(tmp, outDir)
  await rm(old, { recursive: true, force: true })

  return { routes: written.size, bytes }
}
