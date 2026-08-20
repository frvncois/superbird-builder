import { useKeymap } from './useShortcut'
import { useContextMenu } from './useContextMenu'
import { usePersistence } from './usePersistence'
import { useCheatSheet } from './useCheatSheet'
import { togglePalette } from './useCommandPalette'

/**
 * App-wide keyboard shortcuts (registered once from the editor view).
 * Element actions target the current selection; text fields keep their
 * native behaviour because the keymap skips inputs by default.
 */
export function useEditorShortcuts() {
  const { copySelection, cutSelection, pasteOnSelection, duplicateSelection, deleteSelection } =
    useContextMenu()
  const { undo, redo, saveNow } = usePersistence()
  const { open: openCheatSheet } = useCheatSheet()

  useKeymap([
    { key: 'c', mod: true, handler: copySelection },
    { key: 'x', mod: true, handler: cutSelection },
    { key: 'v', mod: true, handler: pasteOnSelection },
    { key: 'd', mod: true, handler: duplicateSelection },
    { key: ['backspace', 'delete'], handler: deleteSelection },
    { key: 'z', mod: true, shift: false, handler: undo },
    { key: 'z', mod: true, shift: true, handler: redo },
    // save works even from a focused field, so ⌘S never opens the browser dialog
    { key: 's', mod: true, allowInInput: true, handler: saveNow },
    // ⌘E toggles the insert dock; allowInInput so it works from the code editor
    { key: 'e', mod: true, allowInInput: true, handler: togglePalette },
    { key: '?', handler: openCheatSheet },
  ])
}
