// Reference-field resolution shared VERBATIM by the client renderers
// (via useRenderNode/ContentEditor) and the static exporter
// (server/export.mjs) — plain JS so both sides import the same file.
//
// A binding path is a field name, optionally hopping ONE reference:
//   'title'        → the scoped entry's own field
//   'author.name'  → the entry referenced by the 'author' field, its 'name'
// Reference values live only in an entry's base `values` (never locale
// overrides): reference = target entry id, multi-reference = array of ids.

/** ids stored on a reference/multi-reference field, always as an array */
export function refIds(entry, fieldName) {
  const v = entry?.values?.[fieldName]
  if (Array.isArray(v)) return v
  return typeof v === 'string' && v ? [v] : []
}

/**
 * Resolve a binding path against a collection + entry scope.
 * Returns the collection/field the value lives on and the entry to read it
 * from — `entry` is null when it can't be resolved yet (no scope entry, or a
 * dangling reference), so callers can still show a {field} placeholder.
 * Returns null when the path names no field at all.
 */
export function resolveBinding(collections, collection, entry, path) {
  if (!collection || !path) return null
  const dot = path.indexOf('.')
  const head = dot === -1 ? path : path.slice(0, dot)
  const tail = dot === -1 ? null : path.slice(dot + 1)
  const field = collection.fields.find((f) => f.name === head)
  if (!field) return null
  if (tail === null) return { collection, field, entry: entry ?? null }
  if (field.type !== 'reference' || tail.includes('.')) return null
  const refCollection = collections.find((c) => c.id === field.refCollectionId) ?? null
  const refField = refCollection?.fields.find((f) => f.name === tail) ?? null
  if (!refCollection || !refField) return null
  const id = entry?.values?.[head]
  const refEntry =
    (typeof id === 'string' && refCollection.entries.find((e) => e.id === id)) || null
  return { collection: refCollection, field: refField, entry: refEntry }
}

/**
 * Entries a :collection-list[arg] iterates: a collection name lists all of
 * its entries; a multi-reference field of the scoped entry lists the
 * referenced entries (dangling ids skipped, order preserved).
 * Returns { collection, entries } or null when arg names neither.
 */
export function resolveListScope(collections, scopeCollection, scopeEntry, arg) {
  if (!arg) return null
  const named = collections.find((c) => c.name === arg)
  if (named) return { collection: named, entries: named.entries }
  const field = scopeCollection?.fields.find((f) => f.name === arg)
  if (!field || field.type !== 'multi-reference') return null
  const target = collections.find((c) => c.id === field.refCollectionId)
  if (!target) return null
  const entries = refIds(scopeEntry, arg)
    .map((id) => target.entries.find((e) => e.id === id))
    .filter(Boolean)
  return { collection: target, entries }
}

/** display text for a reference-typed field bound directly (no `.field`
 * hop): the referenced entry name(s), comma-joined */
export function refDisplay(collections, field, entry) {
  const target = collections.find((c) => c.id === field.refCollectionId)
  if (!target || !entry) return ''
  return refIds(entry, field.name)
    .map((id) => target.entries.find((e) => e.id === id)?.name)
    .filter(Boolean)
    .join(', ')
}
