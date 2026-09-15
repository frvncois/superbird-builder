import { useKeymap } from './useShortcut'
import { useContextMenu } from './useContextMenu'
import { usePersistence } from './usePersistence'
import { togglePalette } from './useCommandPalette'
import { useModal } from './useModal'
import { useViewMode } from './useViewMode'
import PublishDialog from '@/components/shared/PublishDialog.vue'

/**
 * App-wide keyboard shortcuts (registered once from the editor view, which now
 * hosts both Build and Preview). Structural element actions only fire in Build
 * mode; undo/redo/save/publish work in both. Text fields keep their native
 * behaviour because the keymap skips inputs by default.
 */
export function useEditorShortcuts() {
  const {
    copySelection,
    cutSelection,
    pasteOnSelection,
    duplicateSelection,
    deleteSelection,
    wrapSelection,
  } = useContextMenu()
  const { undo, redo, saveNow } = usePersistence()
  const { openModal, stack } = useModal()
  const { isBuild } = useViewMode()

  // structural ops target the canvas selection — inert outside Build mode
  const buildOnly = (fn: () => void) => () => {
    if (isBuild.value) fn()
  }

  // ⌘P opens Publish (all roles — contributors can publish too) — dedupe so
  // holding it can't stack modals
  function openPublish() {
    if (stack.value.some((m) => m.component === PublishDialog)) return
    void openModal(PublishDialog)
  }

  useKeymap([
    // the element panels have no shortcuts — Style, Data, and Interactions
    // open by typing '(' / '[' / '{' on an element token in the code editor
    { key: 'c', mod: true, handler: buildOnly(copySelection) },
    { key: 'x', mod: true, handler: buildOnly(cutSelection) },
    { key: 'v', mod: true, handler: buildOnly(pasteOnSelection) },
    // shift: false so a stray ⌘⇧D (the removed data-panel shortcut) never duplicates
    { key: 'd', mod: true, shift: false, handler: buildOnly(duplicateSelection) },
    // ⌘G wraps the selection in a div. Like ⌘C/D, the code editor handles it in
    // its own keydown (so the caret follows the new div); this fires from canvas
    { key: 'g', mod: true, handler: buildOnly(wrapSelection) },
    { key: ['backspace', 'delete'], handler: buildOnly(deleteSelection) },
    { key: 'z', mod: true, shift: false, handler: undo },
    { key: 'z', mod: true, shift: true, handler: redo },
    // save works even from a focused field, so ⌘S never opens the browser dialog
    { key: 's', mod: true, shift: false, allowInInput: true, handler: saveNow },
    // ⌘E toggles the insert dock; allowInInput so it works from the code editor
    { key: 'e', mod: true, allowInInput: true, handler: buildOnly(togglePalette) },
    // ⌘P publishes; allowInInput so it overrides the browser print dialog everywhere
    { key: 'p', mod: true, shift: false, allowInInput: true, handler: openPublish },
  ])
}
