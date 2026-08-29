import { ref } from 'vue'
import type { MediaAsset, MediaKind } from '@/types/media'

/**
 * Controls the media library modal (mirrors useDocumentation's open/close
 * singleton) with an added "select" mode: openSelect() resolves a promise with
 * the picked asset (or null if the modal closes without a pick), so callers —
 * the image src picker, content-mode swap — can `await` a choice.
 */
const open = ref(false)
/** when set, the modal is in select mode and filters to these kinds */
const selectAccept = ref<MediaKind[] | null>(null)

let resolvePick: ((asset: MediaAsset | null) => void) | null = null

export function useMediaLibrary() {
  /** browse/manage mode (AppHeader) */
  function openLibrary() {
    finishPick(null) // abandon any in-flight select
    selectAccept.value = null
    open.value = true
  }

  /** select mode: resolves with the chosen asset, or null if closed/cancelled.
   *  `accept` limits the grid to those kinds (undefined = all). */
  function openSelect(accept?: MediaKind[]): Promise<MediaAsset | null> {
    finishPick(null)
    selectAccept.value = accept ?? null
    open.value = true
    return new Promise((resolve) => {
      resolvePick = resolve
    })
  }

  /** called by the modal when the user picks in select mode */
  function pick(asset: MediaAsset) {
    finishPick(asset)
    close()
  }

  function close() {
    open.value = false
    finishPick(null) // closing without a pick resolves the pending promise
    selectAccept.value = null
  }

  function finishPick(asset: MediaAsset | null) {
    if (resolvePick) {
      resolvePick(asset)
      resolvePick = null
    }
  }

  return { open, selectAccept, openLibrary, openSelect, pick, close }
}
