// Media extraction for the static exporter: interns data-URL media and
// referenced library assets into hashed files under media/ so the exported
// site is fully self-contained. Split out of export.mjs (BOUNDARIES.md);
// the render mirror stays there per CLAUDE.md's keep-in-sync mandate.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkNodes } from './util.mjs'

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
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'application/pdf': 'pdf',
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
}

// media library storage (see server/media.mjs) — referenced assets are
// copied into the export under hashed names so the site stays fully static
const MEDIA_LIB = join(
  process.env.SB_DATA_DIR || join(fileURLToPath(new URL('..', import.meta.url)), 'server', 'data'),
  'media',
)
const LIB_REF_RE = /^\/media\/([a-f0-9]{16})$/

export async function extractMedia(project) {
  const files = new Map() // relPath -> Buffer
  const paths = new Map() // dataUrl | '/media/<id>' -> '/media/<hash>.<ext>' | null (dropped)
  const libraryRefs = new Set() // '/media/<id>' strings, resolved after the scan

  const store = (value, buffer, ext) => {
    const hash = createHash('sha1').update(buffer).digest('hex').slice(0, 12)
    const rel = `assets/media/${hash}.${ext}`
    files.set(rel, buffer)
    paths.set(value, `/${rel}`)
  }

  const intern = (value) => {
    if (typeof value !== 'string') return
    if (LIB_REF_RE.test(value)) {
      libraryRefs.add(value)
      return
    }
    if (!value.startsWith('data:')) return
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
    store(value, buffer, ext)
  }

  const scanNode = (node) => {
    intern(node.src)
    intern(node.background)
    intern(node.conditions?.swapSrc)
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

  // resolve library refs: copy referenced bytes out of the media store so the
  // exported site is self-contained (deployable anywhere, immutable names)
  let assetsById = new Map()
  if (libraryRefs.size) {
    let index = { assets: [] }
    try {
      index = JSON.parse(await readFile(join(MEDIA_LIB, 'index.json'), 'utf8'))
    } catch {
      /* no library yet — every ref drops below */
    }
    assetsById = new Map((index.assets ?? []).map((a) => [a.id, a]))
    for (const ref of libraryRefs) {
      const id = LIB_REF_RE.exec(ref)[1]
      const asset = assetsById.get(id)
      const ext = asset && MIME_EXT[asset.mime]
      if (!ext) {
        console.warn(`export: dropping missing/unsupported media asset ${id}`)
        paths.set(ref, null)
        continue
      }
      try {
        store(ref, await readFile(join(MEDIA_LIB, 'files', id)), ext)
      } catch {
        console.warn(`export: media asset ${id} has no file on disk — dropped`)
        paths.set(ref, null)
      }
    }
  }

  const rewrite = (value) =>
    typeof value === 'string' && (value.startsWith('data:') || LIB_REF_RE.test(value))
      ? (paths.get(value) ?? undefined)
      : value
  /** default alt text from the library asset a src references, if any */
  const altFor = (value) => {
    const id = typeof value === 'string' ? LIB_REF_RE.exec(value)?.[1] : null
    return (id && assetsById.get(id)?.alt) || ''
  }
  /** 'image' | 'video' | null for a media ref, from its library asset mime */
  const kindFor = (value) => {
    const id = typeof value === 'string' ? LIB_REF_RE.exec(value)?.[1] : null
    const mime = id && assetsById.get(id)?.mime
    if (!mime) return null
    return mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : null
  }
  return { rewrite, altFor, kindFor, files }
}
