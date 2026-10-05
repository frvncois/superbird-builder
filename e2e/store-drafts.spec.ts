import { test, expect } from '@playwright/test'
import { computeMerge } from '../src/lib/merge'
import type { Effect, Project } from '../src/types/editor'

// The 3-way draft merge (`computeMerge`) had no coverage at all, which is how
// F3 shipped: every top-level id-keyed list is merged by one helper, but
// `effects` was spread onto the result CONDITIONALLY, so an empty merged list
// — a draft that deleted the last effect — left `...mine` (Main's) in place and
// the deletion read as "nothing changed". Pure, like the merge itself: the
// merge runs client-side in `useBranches`, with no server round-trip to drive.

const effect = (id: string, name: string): Effect => ({
  id,
  name,
  interactionId: `i-${id}`,
  animationId: `a-${id}`,
})

function project(effects?: Effect[]): Project {
  const base: Project = {
    pages: [
      {
        id: 'p1',
        name: 'Home',
        slug: '',
        status: 'published',
        elements: [{ id: 'b1', type: 'body' }],
      },
    ],
    components: [],
    collections: [],
    interactions: [],
    animations: [],
    breakpoints: [],
    comments: [],
    locales: ['en'],
    defaultLocale: 'en',
    settings: { tokens: [] },
  } as unknown as Project
  if (effects) base.effects = effects
  return base
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

test('a draft that deletes the last effect is applied, not reverted', () => {
  const base = project([effect('e1', 'Fade in')])
  const main = clone(base)
  const branch = project([]) // the draft deleted it

  const { merged, conflicts } = computeMerge(base, main, branch)

  expect(conflicts).toEqual([])
  expect(merged.effects ?? []).toEqual([])
})

test('a draft that deletes one of two effects keeps the other', () => {
  const base = project([effect('e1', 'Fade in'), effect('e2', 'Slide up')])
  const main = clone(base)
  const branch = project([effect('e2', 'Slide up')])

  const { merged, conflicts } = computeMerge(base, main, branch)

  expect(conflicts).toEqual([])
  expect(merged.effects?.map((e) => e.id)).toEqual(['e2'])
})

test('a draft that adds an effect merges it into an untouched Main', () => {
  const base = project()
  const main = clone(base)
  const branch = project([effect('e1', 'Fade in')])

  const { merged, conflicts } = computeMerge(base, main, branch)

  expect(conflicts).toEqual([])
  expect(merged.effects?.map((e) => e.name)).toEqual(['Fade in'])
})

test('a draft that renames an effect Main also renamed conflicts, defaulting to Main', () => {
  const base = project([effect('e1', 'Fade in')])
  const main = project([{ ...effect('e1', 'Main name') }])
  const branch = project([{ ...effect('e1', 'Draft name') }])

  const { merged, conflicts } = computeMerge(base, main, branch)

  expect(conflicts.map((c) => c.key)).toEqual(['effect:e1'])
  expect(merged.effects?.[0].name).toBe('Main name')
})

test('a project with no effects on any side stays byte-identical', () => {
  // the key is deleted again when the merge finds none, which is what keeps
  // the next merge's JSON.stringify signatures stable
  const base = project()
  const { merged } = computeMerge(base, clone(base), clone(base))
  expect('effects' in merged).toBe(false)
  expect(JSON.stringify(merged)).toBe(JSON.stringify(base))
})
