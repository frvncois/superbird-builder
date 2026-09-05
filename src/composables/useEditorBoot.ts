import { ref } from 'vue'
import { usePersistence } from './usePersistence'
import { useProject } from './useProject'
import { migrateStoredProject } from '@/lib/storage'
import { hydrateStore, storeGet } from '@/lib/store'
import { hydratePublishState } from './usePublish'
import { useMedia } from './useMedia'

// Shared admin-zone boot: hydrate the server-backed store and start
// persistence. Lives at module scope so it runs exactly once no matter
// which admin view (BuildView / PreviewView) mounts first — a deep-link or
// refresh at /admin/preview boots the same project the editor would.
const ready = ref(false)
const bootError = ref<string | null>(null)
let started = false

export function useEditorBoot() {
  if (started) return { ready, bootError, reloadPage }
  started = true
  ;(async () => {
    try {
      // purge pre-server-storage localStorage copies of the project so they
      // can never leak back into a fresh install (theme + setup-name stay)
      for (const k of Object.keys(localStorage)) {
        if (
          k === 'superbird-project' ||
          k === 'superbird-branches' ||
          k === 'superbird-published-baseline' ||
          k === 'superbird-published-info' ||
          k.startsWith('superbird-project:') ||
          k.startsWith('superbird-base:')
        ) {
          localStorage.removeItem(k)
        }
      }
      await hydrateStore([
        'guano-branches',
        'guano-published-baseline',
        'guano-published-info',
      ])
      const meta = storeGet('guano-branches')
      const activeId = meta ? ((JSON.parse(meta).activeId as string) ?? 'main') : 'main'
      // Main's key too: publish/the Unpublished dot always read Main, even
      // when the session resumes straight onto a draft (hydrateStore de-dupes)
      await hydrateStore([`guano-project:${activeId}`, 'guano-project:main'])
      hydratePublishState()

      // fresh install: no stored project yet, so init() will persist the
      // in-memory default. Apply the name captured at setup before that
      // first snapshot is taken, then clear the stash so it can't leak.
      // old key read too: a setup finished on the pre-rename build hands
      // its name to this one exactly once
      const setupName =
        localStorage.getItem('guano-setup-name') ?? localStorage.getItem('superbird-setup-name')
      if (setupName) {
        if (!storeGet(`guano-project:${activeId}`)) {
          useProject().renameProject(setupName)
        }
      }
      localStorage.removeItem('guano-setup-name')
      localStorage.removeItem('superbird-setup-name')

      usePersistence().init() // sync, runs against the warm cache
      ready.value = true

      // the media index is non-critical to boot — load it in the background so
      // a media outage never blocks the editor; the library modal retries on
      // open. Both admin views boot through here, so Preview gets it too.
      void useMedia()
        .loadMedia()
        .catch(() => {})

      // dev convenience: /admin?demo replaces the project with the
      // generated showcase (public/demo-project.json)
      if (new URLSearchParams(window.location.search).has('demo')) {
        // public-dir file — served under the SPA's /admin/ base
        const res = await fetch(import.meta.env.BASE_URL + 'demo-project.json')
        const demo = res.ok && migrateStoredProject(await res.json())
        if (demo) usePersistence().resetTo(demo)
      }
    } catch {
      bootError.value = 'Cannot reach the server — is `npm run serve` running?'
    }
  })()
  return { ready, bootError, reloadPage }
}

function reloadPage() {
  window.location.reload()
}
