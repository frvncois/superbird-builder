import { useKeymap } from './useShortcut'
import { useContextMenu } from './useContextMenu'
import { usePersistence } from './usePersistence'
import { useDocumentation } from './useDocumentation'
import { togglePalette } from './useCommandPalette'

/**
 * App-wide keyboard shortcuts (registered once from the editor view).
 * Element actions target the current selection; text fields keep their
 * native behaviour because the keymap skips inputs by default.
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
  const { open: openDocumentation } = useDocumentation()

  useKeymap([
    // the element panels have no shortcuts — Style, Data, and Interactions
    // open by typing '(' / '[' / '{' on an element token in the code editor
    { key: 'c', mod: true, handler: copySelection },
    { key: 'x', mod: true, handler: cutSelection },
    { key: 'v', mod: true, handler: pasteOnSelection },
    // shift: false so a stray ⌘⇧D (the removed data-panel shortcut) never duplicates
    { key: 'd', mod: true, shift: false, handler: duplicateSelection },
    // ⌘G wraps the selection in a div. Like ⌘C/D, the code editor handles it in
    // its own keydown (so the caret follows the new div); this fires from canvas
    { key: 'g', mod: true, handler: wrapSelection },
    { key: ['backspace', 'delete'], handler: deleteSelection },
    { key: 'z', mod: true, shift: false, handler: undo },
    { key: 'z', mod: true, shift: true, handler: redo },
    // save works even from a focused field, so ⌘S never opens the browser dialog
    { key: 's', mod: true, shift: false, allowInInput: true, handler: saveNow },
    // ⌘E toggles the insert dock; allowInInput so it works from the code editor
    { key: 'e', mod: true, allowInInput: true, handler: togglePalette },
    { key: '?', handler: () => openDocumentation() },
  ])
}
