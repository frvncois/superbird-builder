import { useKeymap } from './useShortcut'
import { usePersistence } from './usePersistence'
import { useModal } from './useModal'
import { useAuth } from './useAuth'
import PublishDialog from '@/components/shared/PublishDialog.vue'

/**
 * Minimal keyboard shortcuts for Preview: undo/redo, save, and ⌘P publish. The
 * keymap skips editable targets, so ⌘Z inside the inline text editor does a
 * native contenteditable undo, not a project-wide one. (Save/Publish are
 * allowInInput so ⌘S / ⌘P never open the browser's dialogs while editing.)
 */
export function usePreviewShortcuts() {
  const { undo, redo, saveNow } = usePersistence()
  const { openModal, stack } = useModal()
  const { canBuild } = useAuth()

  function openPublish() {
    if (!canBuild.value) return
    if (stack.value.some((m) => m.component === PublishDialog)) return
    void openModal(PublishDialog)
  }

  useKeymap([
    { key: 'z', mod: true, shift: false, handler: undo },
    { key: 'z', mod: true, shift: true, handler: redo },
    { key: 's', mod: true, shift: false, allowInInput: true, handler: saveNow },
    { key: 'p', mod: true, shift: false, allowInInput: true, handler: openPublish },
  ])
}
