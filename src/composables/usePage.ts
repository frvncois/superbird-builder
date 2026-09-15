import { computed, ref } from 'vue'
import { useProject } from './useProject'
import { useAuth } from './useAuth'
import { useMotion } from './useMotion'
import { createPage } from '@/lib/factories'
import { buildDocument, extractBodyArg, extractBodyLines, slugify } from '@/lib/document'
import { deepClone, walkNodes } from '@/lib/tree'
import type { Page } from '@/types/editor'

const activePageId = ref<string | null>(null)

export function usePage() {
  const { project } = useProject()
  const { name: authName, email: authEmail } = useAuth()
  const actor = () => authName.value || authEmail.value || 'Someone'

  const pages = computed(() => project.value.pages)

  // A project always has at least one page, so there is always an active one
  const activePage = computed(
    () => pages.value.find((p) => p.id === activePageId.value) ?? pages.value[0]!,
  )

  const homePage = computed(() => pages.value.find((p) => p.path === '/') ?? pages.value[0]!)

  function addPage(name: string, path = `/${slugify(name)}`): Page {
    const page = createPage(name, path, project.value.defaultLocale)
    page.createdBy = page.updatedBy = actor()
    project.value.pages.push(page)
    return page
  }

  /** deep-clones a page — node-level styles/interactions/content live on
   * the nodes (not the code), so a JSON clone with fresh ids keeps them */
  function duplicatePage(id: string): Page | null {
    const page = pages.value.find((p) => p.id === id)
    if (!page) return null
    const clone = deepClone(page) as Page
    clone.id = crypto.randomUUID()
    walkNodes(clone.elements, (n) => (n.id = crypto.randomUUID()))
    delete clone.collectionId // a duplicated collection template is handled separately
    clone.name = `${page.name} copy`
    let path = `${page.path}-copy`
    let n = 2
    while (pages.value.some((p) => p.path === path)) path = `${page.path}-copy-${n++}`
    clone.path = path
    clone.code = buildDocument(
      { name: clone.name, slug: clone.path, status: clone.status, locale: project.value.defaultLocale },
      extractBodyLines(clone.code),
      extractBodyArg(clone.code),
    )
    clone.createdAt = clone.updatedAt = Date.now()
    clone.createdBy = clone.updatedBy = actor()
    project.value.pages.push(clone)
    return clone
  }

  function removePage(id: string) {
    // The home page can never be deleted, so a project always keeps at least one page
    if (id === homePage.value.id) return
    project.value.pages = project.value.pages.filter((p) => p.id !== id)
    if (activePageId.value === id) activePageId.value = homePage.value.id
  }

  function renamePage(id: string, name: string) {
    const page = pages.value.find((p) => p.id === id)
    if (!page) return
    page.name = name
    // keep the @setup block in the page code in sync
    page.code = buildDocument(
      { name: page.name, slug: page.path, status: page.status, locale: project.value.defaultLocale },
      extractBodyLines(page.code),
      extractBodyArg(page.code),
    )
  }

  /** edit the identity fields that live in the @setup block (name/slug/status).
   * These are code-owned, so we rebuild the block — the same path renamePage
   * uses — rather than mutating page.* alone (which the next code edit would
   * overwrite from the stale @setup). Stamps updatedAt/updatedBy. */
  function updatePageMeta(id: string, patch: { name?: string; slug?: string; status?: string }) {
    const page = pages.value.find((p) => p.id === id)
    if (!page) return
    if (patch.name !== undefined) page.name = patch.name
    if (patch.slug !== undefined) page.path = patch.slug
    if (patch.status !== undefined) page.status = patch.status
    page.code = buildDocument(
      { name: page.name, slug: page.path, status: page.status, locale: project.value.defaultLocale },
      extractBodyLines(page.code),
      extractBodyArg(page.code),
    )
    page.updatedAt = Date.now()
    page.updatedBy = actor()
  }

  function setActivePage(id: string) {
    // drop the outgoing page's plays (the marquee that kept ticking, the held
    // end states) — the new page's own triggers re-fire on mount
    if (id !== activePageId.value) useMotion().stopAll()
    activePageId.value = id
  }

  return {
    pages,
    activePage,
    homePage,
    addPage,
    duplicatePage,
    removePage,
    renamePage,
    updatePageMeta,
    setActivePage,
  }
}
