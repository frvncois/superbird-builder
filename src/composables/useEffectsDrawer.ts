import { effectScope, ref, watch } from 'vue'
import { useProject } from './useProject'
import type { EffectKind } from '@/lib/effectTriggers'

// Which effect the bottom drawer is editing, if any.
//
// An effect — a style change or a timeline — is PROJECT-level and shared by
// every element using it, so it is edited in the drawer under the canvas rather
// than in the element panel. That is the whole point of the drawer: editing a
// shared thing among per-element rows made a change that retimed the site read
// as a change to the one element, and reaching it used to take over the panel,
// so you lost sight of which element you were on.
//
// The drawer deliberately SURVIVES a selection change and a panel change: you
// open it to tune one effect while clicking around the elements that use it.
// Only the effect going away clears it.
//
// State is IDS, NEVER OBJECTS. Undo, a branch switch and a merge each replace
// the whole `project` ref with a deep clone — object identities change while ids
// survive. A held object would become a detached orphan that silently swallows
// every subsequent keystroke.

export type { EffectKind }

/** what the drawer can be pointed at: a named effect (one or both halves), or
 *  a bare half no effect has claimed */
export type DrawerKind = EffectKind | 'effect'

export interface DrawerSelection {
  kind: DrawerKind
  id: string
  /** created by this visit — the footer offers Cancel (a cascading discard) */
  created: boolean
}

const open = ref(false)
const selected = ref<DrawerSelection | null>(null)

const { project } = useProject()

/** is the selection still something to edit? */
function resolves(sel: DrawerSelection): boolean {
  const list =
    sel.kind === 'effect'
      ? project.value.effects
      : sel.kind === 'interaction'
        ? project.value.interactions
        : project.value.animations
  return !!list?.some((item) => item.id === sel.id)
}

let watchersStarted = false

function startWatchers() {
  if (watchersStarted) return
  watchersStarted = true
  // detached: this state outlives every component that reads it, so the
  // watcher must outlive them too (same pattern as the component sync)
  effectScope(true).run(() => {
    watch(
      () =>
        [
          selected.value,
          project.value.interactions,
          project.value.animations,
          project.value.effects,
        ] as const,
      () => {
        if (selected.value && !resolves(selected.value)) selected.value = null
      },
    )
  })
}

export function useEffectsDrawer() {
  startWatchers()

  /** open the drawer on an effect (the panel's effect names, the library) */
  function openEffect(kind: DrawerKind, id: string, created = false) {
    selected.value = { kind, id, created }
    open.value = true
  }

  /** a brand-new effect has been accepted: the footer goes back to Delete */
  function keepEffect() {
    if (selected.value) selected.value = { ...selected.value, created: false }
  }

  function closeDrawer() {
    open.value = false
    // walking away KEEPS a new effect (only Cancel discards), so it must stop
    // offering Cancel — otherwise reopening later would invite discarding
    // something the author has already lived with.
    keepEffect()
  }

  function toggleDrawer() {
    if (open.value) closeDrawer()
    else open.value = true
  }

  return { open, selected, openEffect, keepEffect, closeDrawer, toggleDrawer }
}
