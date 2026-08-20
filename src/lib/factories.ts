import type { Breakpoint, Page, Project } from '@/types/editor'
import { buildDocument } from './document'
import { parseSyntax } from './syntax'
import { defaultSettings } from './settings'

export function defaultBreakpoints(): Breakpoint[] {
  return [
    { id: crypto.randomUUID(), name: 'Desktop', width: 1440, height: 900 },
    { id: crypto.randomUUID(), name: 'Tablet', width: 768, height: 1024 },
    { id: crypto.randomUUID(), name: 'Mobile', width: 390, height: 844 },
  ]
}

export function createPage(name: string, path: string, locale = 'en'): Page {
  const code = buildDocument({ name, slug: path, status: 'published', locale }, [])
  return {
    id: crypto.randomUUID(),
    name,
    path,
    status: 'published',
    code,
    elements: parseSyntax(code),
  }
}

// A project always has at least its home page
export function createProject(name: string): Project {
  return {
    id: crypto.randomUUID(),
    name,
    pages: [createPage('Home', '/')],
    components: [],
    collections: [],
    breakpoints: defaultBreakpoints(),
    comments: [],
    locales: ['en'],
    defaultLocale: 'en',
    settings: defaultSettings(),
  }
}
