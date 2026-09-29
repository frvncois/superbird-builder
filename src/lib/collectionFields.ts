import type { Collection, CollectionField } from '@/types/editor'

/** the field types a collection can hold, as the pickers label them */
export const FIELD_TYPES: { label: string; value: CollectionField['type'] }[] = [
  { label: 'Text', value: 'text' },
  { label: 'Image', value: 'image' },
  { label: 'Date', value: 'date' },
  { label: 'Reference', value: 'reference' },
  { label: 'Multi-ref', value: 'multi-reference' },
  { label: 'Gallery', value: 'multi-image' },
]

export const isRefType = (t: string) => t === 'reference' || t === 'multi-reference'

/** switching a field to a reference type needs a target; default to the first
 *  collection so the picker is never dangling */
export function setFieldType(
  field: CollectionField,
  type: CollectionField['type'],
  collections: Collection[],
) {
  field.type = type
  if (isRefType(type)) field.refCollectionId ??= collections[0]?.id
  else delete field.refCollectionId
}
