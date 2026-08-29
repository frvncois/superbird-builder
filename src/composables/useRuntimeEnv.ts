import { ref } from 'vue'
import type { RuntimeEnv } from './useRenderNode'

// Reactive browser environment for runtime condition rules (published-site
// SPA preview). Reading `env()` inside a computed tracks the viewport ref,
// so conditions re-evaluate on resize — mirroring site.js on the export.

const viewport = ref(typeof window !== 'undefined' ? window.innerWidth : 1280)
let started = false

export function useRuntimeEnv() {
  if (!started && typeof window !== 'undefined') {
    started = true
    window.addEventListener('resize', () => (viewport.value = window.innerWidth))
  }

  function env(): RuntimeEnv {
    return {
      viewport: viewport.value,
      now: Date.now(),
      query: (param) => new URLSearchParams(window.location.search).get(param),
    }
  }

  return { env }
}
