import { computed, ref } from 'vue'
import { currentSnapshot, usePersistence } from './usePersistence'
import { storeGet, storeSet } from '@/lib/store'

/** mirror of the last-published snapshot so the Unpublished dot
 * survives editor reloads (server-stored; hydrated by the boot flow) */
const BASELINE_KEY = 'superbird-published-baseline'

// snapshot of the project at the last publish; null = never published.
// (migrations can make an old save differ from its own published
// baseline — worst case one false "Unpublished".)
const publishedSnapshot = ref<string | null>(null)

/** stats of the last successful publish (Publishing settings tab) */
const INFO_KEY = 'superbird-published-info'
const publishedInfo = ref<{ publishedAt: number; routes: number; bytes: number } | null>(null)

/** called from the editor boot flow once the store cache is hydrated */
export function hydratePublishState() {
  publishedSnapshot.value = storeGet(BASELINE_KEY)
  try {
    publishedInfo.value = JSON.parse(storeGet(INFO_KEY) ?? 'null')
  } catch {
    publishedInfo.value = null
  }
}

export function usePublish() {
  /** true whenever the project differs from the last published state.
   * Compares the persistence layer's already-computed committed snapshot
   * — no per-edit stringify, and content-accurate (undoing back to the
   * published state correctly clears it). */
  const hasUnpublishedChanges = computed(
    () => publishedSnapshot.value === null || currentSnapshot.value !== publishedSnapshot.value,
  )

  /** publishes the current project to the server; throws on failure */
  async function markPublished(): Promise<void> {
    // settle any pending edit so the committed snapshot is what we publish
    usePersistence().saveNow()
    const snapshot = currentSnapshot.value
    const res = await fetch('/api/published', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: snapshot,
    })
    if (!res.ok) {
      const detail = await res.json().catch(() => null)
      throw new Error(detail?.error ?? `publish failed (${res.status})`)
    }
    const stats = await res.json().catch(() => null)
    publishedSnapshot.value = snapshot
    publishedInfo.value = {
      publishedAt: Date.now(),
      routes: stats?.routes ?? 0,
      bytes: stats?.bytes ?? 0,
    }
    storeSet(BASELINE_KEY, snapshot)
    storeSet(INFO_KEY, JSON.stringify(publishedInfo.value))
  }

  return { hasUnpublishedChanges, markPublished, publishedInfo }
}
