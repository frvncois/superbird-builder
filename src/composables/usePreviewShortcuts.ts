import { useKeymap } from './useShortcut'
import { usePersistence } from './usePersistence'

/**
 * Minimal keyboard shortcuts for content mode: undo/redo and save. The
 * keymap skips editable targets, so ⌘Z inside the inline text editor does a
 * native contenteditable undo, not a project-wide one. (Save is allowInInput
 * so ⌘S never opens the browser dialog while editing.)
 */
export function useContentShortcuts() {
  const { undo, redo, saveNow } = usePersistence()

  useKeymap([
    { key: 'z', mod: true, shift: false, handler: undo },
    { key: 'z', mod: true, shift: true, handler: redo },
    { key: 's', mod: true, shift: false, allowInInput: true, handler: saveNow },
  ])
}
