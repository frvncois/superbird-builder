import { effectScope, watch } from 'vue'
import { useProject } from './useProject'
import { useAuth } from './useAuth'
import { applyNodeMarkers } from '@/lib/syntax'
import { walkNodes } from '@/lib/tree'

/**
 * Keeps each element line's display-only markers — `[+]` own data, `(+)`
 * styled, `{+}` interactions — in step with the node state they mirror.
 *
 * They are still written because the agent API shows them to agents and its
 * `version` contract depends on them; nothing in the browser needs them any
 * more. This used to live in the code editor, which meant styling done while
 * that column was closed silently left them stale.
 *
 * Gated on `canBuild`: a contributor's marker write is a structural change the
 * server drops, so it would only ever produce a rejected save.
 */
let started = false

export function useMarkerSync() {
  if (started) return
  started = true
  // detached: this is app-wide, and a watcher created inside a component's
  // setup dies with that component
  effectScope(true).run(() => {
    const { project } = useProject()
    const { canBuild } = useAuth()

    // the state the markers mirror, across every page — NOT the code, so a
    // marker write can't re-trigger this
    const signature = () => {
      const parts: string[] = []
      for (const page of project.value.pages) {
        walkNodes(page.elements, (n) => {
          parts.push(
            `${n.id}:${n.classes ?? ''}:${n.interactions?.length ?? 0}:${
              n.animations?.length ?? 0
            }:${n.arg ?? ''}:${n.content ? 1 : 0}:${n.src ? 1 : 0}:${n.slider ? 1 : 0}`,
          )
        })
      }
      return parts.join('\x00')
    }

    watch(signature, () => {
      if (!canBuild.value) return
      for (const page of project.value.pages) {
        const next = applyNodeMarkers(page.code, page.elements)
        if (next !== page.code) page.code = next
      }
    })
  })
}
