import { effectScope, ref, watch } from 'vue'
import { useProject } from './useProject'
import { usePanel } from './usePanel'
import { useElement } from './useElement'
import { useInteraction } from './useInteraction'

// Which library effect the Interactions panel is editing, if any.
//
// The panel is otherwise one flat scroll — animation cards, interaction cards,
// both libraries and the site-wide section. Creating or editing an effect
// replaces ALL of it with a single focused view: an effect is project-level
// and shared across elements, and editing it inline among per-element cards
// made it read as per-element.
//
// State is IDS, NEVER OBJECTS. Undo, a branch switch and a merge
// each replace the whole `project` ref with a deep clone — object
// identities change while ids survive. A held object would become a detached
// orphan that silently swallows every subsequent keystroke.
//
// What closes the view (the watchers below):
//   · the effect stops resolving  — deleted, or the project was replaced
//   · the panel changes or closes — otherwise reopening lands in a stale detail
//   · the selection moves to a DIFFERENT element — typing `{` on another token
//     selects it without touching activePanelId, which would otherwise leave
//     this showing an effect unrelated to what is now selected
// Deselecting entirely does NOT close it: the panel works with no selection,
// and you may have arrived here from the library with nothing selected.

export type EffectKind = 'interaction' | 'animation'

export interface EffectDetail {
  kind: EffectKind
  id: string
  /** created by this visit to the panel — Cancel discards it */
  created: boolean
}

const detail = ref<EffectDetail | null>(null)

/** the Add chooser — the libraries and presets, reached from the list's Add
 *  button. Same drill-in shape as the detail view, same closers below. */
const chooser = ref(false)

/** the binding row the list shows open — module state, because the list is
 *  unmounted while the chooser or a detail view has the panel, and the row a
 *  chooser action just added must be the open one when the list comes back */
const openBindingId = ref<string | null>(null)

const { project } = useProject()
const { activePanelId } = usePanel()
const { selectedElement } = useElement()
const { pickingFor } = useInteraction()

/** is the effect still in the library? */
function resolves(open: EffectDetail): boolean {
  const list = open.kind === 'interaction' ? project.value.interactions : project.value.animations
  return !!list?.some((item) => item.id === open.id)
}

let watchersStarted = false

function startWatchers() {
  if (watchersStarted) return
  watchersStarted = true
  // detached: this state outlives every component that reads it, so the
  // watchers must outlive them too (same pattern as the component sync)
  effectScope(true).run(() => {
    watch(
      () => [detail.value, project.value.interactions, project.value.animations] as const,
      () => {
        if (detail.value && !resolves(detail.value)) detail.value = null
      },
    )
    watch(activePanelId, () => {
      detail.value = null
      chooser.value = false
    })
    watch(
      () => selectedElement.value?.id,
      (id, was) => {
        if (id && was && id !== was) {
          detail.value = null
          chooser.value = false
        }
      },
    )
  })
}

export function useEffectDetail() {
  startWatchers()

  function openDetail(kind: EffectKind, id: string, created = false) {
    // A pick in flight would lose its Escape handler when the list unmounts,
    // and SettingsEditor's Escape defers to pickingFor — leaving Escape dead
    // for the rest of the session.
    pickingFor.value = null
    // a brand-new effect is applied and done with: Done lands on the list,
    // not back in the chooser it was created from
    if (created) chooser.value = false
    detail.value = { kind, id, created }
  }

  function closeDetail() {
    detail.value = null
  }

  function openChooser() {
    pickingFor.value = null
    chooser.value = true
  }

  function closeChooser() {
    chooser.value = false
  }

  return { detail, openDetail, closeDetail, chooser, openChooser, closeChooser, openBindingId }
}
