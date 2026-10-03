import type { Breakpoint, ElementNode, Page, Project } from '@/types/editor'
import { createNode } from './elements'
import { pageToCode } from './pageCode'
import { defaultSettings } from './settings'

export function defaultBreakpoints(): Breakpoint[] {
  return [
    { id: crypto.randomUUID(), name: 'Desktop', width: 1440, height: 900 },
    { id: crypto.randomUUID(), name: 'Tablet', width: 768, height: 1024 },
    { id: crypto.randomUUID(), name: 'Mobile', width: 390, height: 844 },
  ]
}

/** a page's root: the `:body` wrap every document is built around */
export function createBody(arg?: string): ElementNode {
  const body = createNode('body')
  if (arg) body.arg = arg
  return body
}

export function createPage(name: string, path: string, locale = 'en'): Page {
  const now = Date.now()
  const page: Page = {
    id: crypto.randomUUID(),
    name,
    path,
    status: 'published',
    // the DSL mirror the agent API still reads; derived from the tree, and
    // deleted with the DSL itself (see lib/pageCode)
    code: '',
    elements: [createBody()],
    createdAt: now,
    updatedAt: now,
  }
  page.code = pageToCode(page, locale)
  return page
}

// A project always has at least its home page
export function createProject(name: string): Project {
  return {
    id: crypto.randomUUID(),
    name,
    pages: [createPage('Home', '/')],
    components: [],
    collections: [],
    interactions: [],
    animations: [],
    breakpoints: defaultBreakpoints(),
    comments: [],
    locales: ['en'],
    defaultLocale: 'en',
    settings: defaultSettings(),
  }
}
