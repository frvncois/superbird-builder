import type { Collection, CollectionField } from '@/types/editor'

/** the field types a collection can hold, as the pickers label them */
export const FIELD_TYPES: { label: string; value: CollectionField['type'] }[] = [
  { label: 'Text', value: 'text' },
  { label: 'Number', value: 'number' },
  { label: 'Yes / no', value: 'boolean' },
  { label: 'Choice', value: 'select' },
  { label: 'Image', value: 'image' },
  { label: 'Date', value: 'date' },
  { label: 'Reference', value: 'reference' },
  { label: 'Multi-ref', value: 'multi-reference' },
  { label: 'Gallery', value: 'multi-image' },
]

export const isRefType = (t: string) => t === 'reference' || t === 'multi-reference'

/**
 * Never translated, whatever `localize` says: a quantity, a yes/no and a
 * stored choice key read the same in every language. The worklist and the
 * publish warning both skip them, so "nothing left to translate" stays true.
 */
export const isTranslatableType = (t: string) => t === 'text'

/** a value this field can actually hold, or the reason it cannot. One
 *  implementation: the panel, `upsert_entries` and the import all ask it, so a
 *  value the editor accepts is one the agent can write and vice versa. */
export function fieldValueError(field: CollectionField, value: string): string | null {
  if (value === '') return null // empty always clears
  if (field.type === 'number') {
    return Number.isFinite(Number(value)) ? null : `"${value}" is not a number`
  }
  if (field.type === 'boolean') {
    return value === 'true' || value === 'false' ? null : `"${value}" is not "true" or "false"`
  }
  if (field.type === 'select') {
    const options = field.options ?? []
    if (!options.length) return `"${field.name}" has no options yet — add them to the field first`
    return options.includes(value)
      ? null
      : `"${value}" is not one of ${options.map((o) => `"${o}"`).join(', ')}`
  }
  return null
}

/**
 * Switching a field to a reference type needs a target; default to the first
 * collection so the picker is never dangling. A field that stops being a
 * choice drops its options.
 *
 * An empty list is NEVER stored — absent is the one spelling of "no options",
 * so a field whose options were added and cleared is byte-identical to one
 * that never had any (`computeMerge` compares whole-object JSON, and a stray
 * `[]` would read as an edit on one side of a draft).
 */
export function setFieldType(
  field: CollectionField,
  type: CollectionField['type'],
  collections: Collection[],
) {
  field.type = type
  if (isRefType(type)) field.refCollectionId ??= collections[0]?.id
  else delete field.refCollectionId
  if (type !== 'select' || !field.options?.length) delete field.options
}
