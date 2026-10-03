import { effectScope, watch } from 'vue'
import { useProject } from './useProject'
import { useAuth } from './useAuth'
import { syncPageCode } from '@/lib/pageCode'
import type { ElementNode, Page } from '@/types/editor'

/**
 * TRANSITIONAL: keeps each page's `code` in step with its tree.
 *
 * Nothing in the browser reads `page.code` any more — the tree is the source of
 * truth for structure. The agent API still reads it: it serves the indentation
 * DSL, addresses edits by line number, and hashes the code for its `version`
 * contract. So the code is maintained as a derived mirror until the MCP moves
 * to HTML (TREE-SOURCE-PLAN.md, Phase 3), and this composable goes with it.
 *
 * It replaces `useMarkerSync`, which kept only the three display-only markers
 * in step; the markers are now just part of what the mirror emits.
 *
 * Gated on `canBuild`: a contributor's structural write is dropped by the
 * server's content merge, so mirroring for them would only ever produce a
 * rejected save.
 */
let started = false

/**
 * Everything the code encodes, per page.
 *
 * Deliberately NOT the code itself — the mirror writes that, and watching it
 * would re-trigger this. It is also not the whole page: `seo`, `customCode` and
 * the stamps change far more often than structure does, and regenerating every
 * page's text for them would be pure waste.
 */
function pageSignature(page: Page): string {
  const parts: string[] = [page.name, page.path, page.status]
  const visit = (nodes: ElementNode[], depth: number) => {
    for (const node of nodes) {
      parts.push(
        // the token line: type, ref, arg, link…
        `${depth}:${node.type}:${node.ref ?? ''}:${node.arg ?? ''}:${node.link ?? ''}:` +
          // …and the state the three markers mirror
          `${node.classes?.trim() ? 1 : 0}${node.interactions?.length ? 1 : 0}` +
          `${node.animations?.length ? 1 : 0}${node.content ? 1 : 0}${node.src ? 1 : 0}` +
          `${node.svg ? 1 : 0}${node.slider ? 1 : 0}${node.hidden === undefined ? 0 : 1}`,
      )
      visit(node.children, depth + 1)
    }
  }
  visit(page.elements, 0)
  return parts.join('\x00')
}

export function useCodeMirror() {
  if (started) return
  started = true
  // detached: this is app-wide, and a watcher created inside a component's
  // setup dies with that component (the `useThemeTokens` lesson)
  effectScope(true).run(() => {
    const { project } = useProject()
    const { canBuild } = useAuth()
    const signatures = new Map<string, string>()

    watch(
      // one walk: the getter's value IS what the handler compares against, so
      // an edit does not sign every page twice
      () => project.value.pages.map((page) => [page.id, pageSignature(page)] as const),
      (pages) => {
        if (!canBuild.value) return
        const live = new Set<string>()
        for (const [id, signature] of pages) {
          live.add(id)
          if (signatures.get(id) === signature) continue
          signatures.set(id, signature)
          const page = project.value.pages.find((p) => p.id === id)
          if (page) syncPageCode(page, project.value.defaultLocale)
        }
        for (const id of [...signatures.keys()]) if (!live.has(id)) signatures.delete(id)
      },
      // immediate only to seed the signatures: `migrateStoredProject` has
      // already brought a loaded project's code into step, before history
      // starts, so nothing is written here on boot
      { immediate: true },
    )
  })
}
