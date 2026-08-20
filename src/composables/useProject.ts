import { computed, ref } from 'vue'
import { createProject } from '@/lib/factories'
import type { Breakpoint } from '@/types/editor'

const project = ref(createProject('Untitled project'))

/** the project always keeps at least one breakpoint, and never more than six */
export const MIN_BREAKPOINTS = 1
export const MAX_BREAKPOINTS = 6

/** standard device widths, large → small; inserts pick from these */
const STANDARD_WIDTHS = [2560, 1920, 1680, 1440, 1280, 1024, 768, 640, 480, 390, 320]

function nameFor(width: number): string {
  if (width >= 1920) return 'Large desktop'
  if (width >= 1024) return 'Desktop'
  if (width >= 640) return 'Tablet'
  return 'Mobile'
}

export function useProject() {
  // shared across all pages — they map to global CSS media queries
  const breakpoints = computed(() => project.value.breakpoints)

  function renameProject(name: string) {
    project.value.name = name
  }

  /**
   * The standard width an insert at this index would get: the largest
   * one that fits strictly between the neighboring breakpoints, so
   * duplicates are impossible. Undefined when the slot is exhausted.
   */
  function widthAt(index: number): number | undefined {
    const list = project.value.breakpoints
    const upper = list[index - 1]?.width ?? Infinity
    const lower = list[index]?.width ?? 0
    return STANDARD_WIDTHS.find((w) => w < upper && w > lower)
  }

  function canAddBreakpoint(index: number): boolean {
    return project.value.breakpoints.length < MAX_BREAKPOINTS && widthAt(index) !== undefined
  }

  /**
   * Inserts a breakpoint at the given index. Breakpoints run large →
   * small, so it inherits from the breakpoint before it; when inserted
   * first, it inherits from the one after.
   */
  function addBreakpoint(index: number): Breakpoint | null {
    const list = project.value.breakpoints
    if (list.length >= MAX_BREAKPOINTS) return null
    const width = widthAt(index)
    const parent = list[index - 1] ?? list[index]
    if (!width || !parent) return null

    const breakpoint: Breakpoint = {
      id: crypto.randomUUID(),
      name: nameFor(width),
      width,
      height: parent.height,
    }
    list.splice(index, 0, breakpoint)
    return breakpoint
  }

  function removeBreakpoint(id: string) {
    if (project.value.breakpoints.length <= MIN_BREAKPOINTS) return
    project.value.breakpoints = project.value.breakpoints.filter((b) => b.id !== id)
    // comments pinned in that frame (on any page) have nowhere to live anymore
    project.value.comments = project.value.comments.filter((c) => c.breakpointId !== id)
  }

  return {
    project,
    breakpoints,
    renameProject,
    canAddBreakpoint,
    addBreakpoint,
    removeBreakpoint,
  }
}
