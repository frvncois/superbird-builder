import { computed, ref } from 'vue'
import { useProject } from './useProject'
import { usePage } from './usePage'
import { buildDocument, extractBodyLines, slugify } from '@/lib/document'
import { parseSyntax } from '@/lib/syntax'
import { deepClone, walkNodes } from '@/lib/tree'
import type { Collection, CollectionEntry, CollectionField, Page } from '@/types/editor'

/** entry loaded into the template canvas for editing */
const activeEntryId = ref<string | null>(null)

export function useCollections() {
  const { project } = useProject()
  const { activePage, setActivePage, homePage } = usePage()

  const collections = computed(() => project.value.collections)

  function collectionByName(name: string): Collection | null {
    return collections.value.find((c) => c.name === name) ?? null
  }

  function collectionById(id: string): Collection | null {
    return collections.value.find((c) => c.id === id) ?? null
  }

  /** the collection whose template is the active page, if any */
  const activeCollection = computed(() =>
    activePage.value.collectionId ? collectionById(activePage.value.collectionId) : null,
  )

  const activeEntry = computed(
    () => activeCollection.value?.entries.find((e) => e.id === activeEntryId.value) ?? null,
  )

  function createCollection(rawName: string): Collection | null {
    const name = rawName
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (!name || collectionByName(name)) return null

    const label = name.charAt(0).toUpperCase() + name.slice(1)
    const code = buildDocument(
      { name: label, slug: `/${name}`, status: 'published', locale: project.value.defaultLocale },
      ['\t:section', '\t\t:h1[title]:', '\tsection:'],
      name,
    )
    const page: Page = {
      id: crypto.randomUUID(),
      name: `${label} template`,
      path: `/${name}`,
      status: 'published',
      code,
      elements: parseSyntax(code),
      collectionId: '',
    }
    const collection: Collection = {
      id: crypto.randomUUID(),
      name,
      fields: [{ id: crypto.randomUUID(), name: 'title', type: 'text' }],
      templatePageId: page.id,
      entries: [],
    }
    page.collectionId = collection.id
    project.value.pages.push(page)
    project.value.collections.push(collection)
    setActivePage(page.id)
    return collection
  }

  function addField(collection: Collection, name = 'field') {
    let unique = name
    let n = 2
    while (collection.fields.some((f) => f.name === unique)) unique = `${name}${n++}`
    collection.fields.push({ id: crypto.randomUUID(), name: unique, type: 'text' })
  }

  function removeField(collection: Collection, fieldId: string) {
    collection.fields = collection.fields.filter((f) => f.id !== fieldId)
  }

  function addEntry(collection: Collection): CollectionEntry {
    const n = collection.entries.length + 1
    const name = `${collection.name} ${n}`
    let slug = slugify(name)
    let i = n
    while (collection.entries.some((e) => e.slug === slug)) slug = `${slugify(collection.name)}-${++i}`
    const entry: CollectionEntry = {
      id: crypto.randomUUID(),
      name,
      slug,
      values: {},
      createdAt: Date.now(),
    }
    collection.entries.push(entry)
    return entry
  }

  /** an entry's own slug, or one derived from its name (older entries) */
  function entrySlug(entry: CollectionEntry): string {
    return entry.slug || slugify(entry.name)
  }

  /** full route path of an entry: /<collection>/<slug> */
  function entryPath(collection: Collection, entry: CollectionEntry): string {
    return `/${collection.name}/${entrySlug(entry)}`
  }

  function duplicateEntry(collection: Collection, entryId: string): CollectionEntry | null {
    const source = collection.entries.find((e) => e.id === entryId)
    if (!source) return null
    let slug = `${source.slug}-copy`
    let n = 2
    while (collection.entries.some((e) => e.slug === slug)) slug = `${source.slug}-copy-${n++}`
    const entry: CollectionEntry = {
      id: crypto.randomUUID(),
      name: `${source.name} copy`,
      slug,
      values: { ...source.values },
      locales: source.locales ? deepClone(source.locales) : undefined,
      createdAt: Date.now(),
    }
    collection.entries.push(entry)
    return entry
  }

  function removeEntry(collection: Collection, entryId: string) {
    collection.entries = collection.entries.filter((e) => e.id !== entryId)
    if (activeEntryId.value === entryId) activeEntryId.value = null
  }

  /** duplicates a collection: fields, template page (fresh node ids), and entries */
  function duplicateCollection(collection: Collection): Collection | null {
    const template = project.value.pages.find((p) => p.id === collection.templatePageId)
    if (!template) return null

    let name = `${collection.name}-copy`
    let n = 2
    while (collectionByName(name)) name = `${collection.name}-copy-${n++}`
    const label = name.charAt(0).toUpperCase() + name.slice(1)

    const page = deepClone(template) as Page
    page.id = crypto.randomUUID()
    walkNodes(page.elements, (node) => {
      node.id = crypto.randomUUID()
      if (node.type === 'body') node.arg = name // rebind :body[name] to the copy
    })
    page.name = `${label} template`
    page.path = `/${name}`
    page.code = buildDocument(
      { name: page.name, slug: page.path, status: page.status, locale: project.value.defaultLocale },
      extractBodyLines(page.code),
      name,
    )

    // entries get fresh ids, so self-references must follow them (fields
    // pointing at OTHER collections keep targeting the originals)
    const entryIdMap = new Map(collection.entries.map((e) => [e.id, crypto.randomUUID()]))
    const copyId = crypto.randomUUID()
    const selfRefFields = collection.fields.filter(
      (f) =>
        (f.type === 'reference' || f.type === 'multi-reference') &&
        f.refCollectionId === collection.id,
    )
    const copy: Collection = {
      id: copyId,
      name,
      fields: collection.fields.map((f) => ({
        ...f,
        id: crypto.randomUUID(),
        refCollectionId: f.refCollectionId === collection.id ? copyId : f.refCollectionId,
      })),
      templatePageId: page.id,
      entries: collection.entries.map((e) => {
        const values = { ...e.values }
        for (const f of selfRefFields) {
          const v = values[f.name]
          if (Array.isArray(v)) values[f.name] = v.map((id) => entryIdMap.get(id) ?? id)
          else if (typeof v === 'string' && v) values[f.name] = entryIdMap.get(v) ?? v
        }
        return {
          ...e,
          id: entryIdMap.get(e.id)!,
          values,
          locales: e.locales ? deepClone(e.locales) : undefined,
        }
      }),
    }
    page.collectionId = copy.id
    project.value.pages.push(page)
    project.value.collections.push(copy)
    return copy
  }

  /** deletes a collection with its template page and entries */
  function removeCollection(collection: Collection) {
    const onTemplate = activePage.value.id === collection.templatePageId
    project.value.pages = project.value.pages.filter((p) => p.id !== collection.templatePageId)
    project.value.collections = project.value.collections.filter((c) => c.id !== collection.id)
    if (collection.entries.some((e) => e.id === activeEntryId.value)) activeEntryId.value = null
    if (onTemplate) setActivePage(homePage.value.id)
  }

  /** open the collection's template with this entry loaded for editing */
  function openEntry(collection: Collection, entryId: string) {
    setActivePage(collection.templatePageId)
    activeEntryId.value = entryId
  }

  /** field of a collection matched by an element's arg */
  function fieldFor(collection: Collection | null, arg?: string): CollectionField | null {
    if (!collection || !arg) return null
    return collection.fields.find((f) => f.name === arg) ?? null
  }

  return {
    collections,
    collectionByName,
    collectionById,
    activeCollection,
    activeEntryId,
    activeEntry,
    createCollection,
    addField,
    removeField,
    addEntry,
    duplicateEntry,
    removeEntry,
    duplicateCollection,
    removeCollection,
    openEntry,
    fieldFor,
    entrySlug,
    entryPath,
  }
}
