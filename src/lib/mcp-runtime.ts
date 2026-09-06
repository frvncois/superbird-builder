// MCP runtime entry point.
//
// The `guano mcp` subcommand (packages/guano/mcp/) runs in plain Node and needs
// the SAME structure/style logic the browser editor uses — parsing, reconcile,
// document scaffolding, the element registry, and class application. Those live
// in TypeScript under src/lib/. Rather than port them (and risk drift), this
// file re-exports exactly the functions the MCP server calls; a Vite lib build
// (vite.mcp.config.ts) bundles this module + its transitive deps into a single
// DOM-free ESM file at packages/guano/runtime/mcp-runtime.mjs.
//
// INVARIANT: everything reachable from here must be free of Vue and browser
// globals. styleCatalog.ts was refactored to hold icon *names* (not lucide
// components) precisely so applyClass can be bundled here. If you add a re-export
// that drags in Vue/DOM, refactor the import graph — do not externalize it.

// --- DSL parsing, identity-preserving reconcile, validation (src/lib/syntax.ts)
export {
  parseSyntax,
  reconcile,
  validateDocument,
  normalizeSyntax,
  lexLine,
  isBodyOpenLine,
  elementBlockLines,
  // display-only code markers ((+) styled, {+} interactions) — the MCP keeps
  // them in step when it writes node.classes / node.interactions, because the
  // editor's marker truth-sync does NOT run on load (only on later change)
  styleMarkerOf,
  withStyleMarker,
  interactionMarkerOf,
  withInteractionMarker,
  hasOpenArgBracket,
} from './syntax'
export type { Diagnostic } from './syntax'

// component-instance detection (styles/interactions live on the master)
export { isComponentType } from './components'

// --- canonical page document scaffold (src/lib/document.ts)
export {
  buildDocument,
  enforceDocument,
  extractBodyLines,
  extractBodyArg,
  extractBodyDecor,
  parseSetup,
  replaceSetup,
  setSetupLocale,
  slugify,
} from './document'
export type { PageMeta } from './document'

// --- element registry + node factory (src/lib/elements.ts)
export {
  ELEMENTS,
  createNode,
  isKnownElement,
  isLeafElement,
  typeOptionsFor,
} from './elements'
export type { ElementDef } from './elements'

// --- tree helpers (src/lib/tree.ts)
export { walkNodes, findNode, findParent, hasAncestorOfType, deepClone } from './tree'

// --- class application + validation (src/lib/styles.ts)
export {
  applyClass,
  isValidClass,
  matchClass,
  sameProperty,
  isStateClass,
} from './styles'
export type { ApplyClassResult, StyleProperty, StyleSection } from './styles'
export { STYLE_SECTIONS } from './styleCatalog'

// --- shared element/node types (compile-time only; erased at runtime)
export type { ElementNode } from '@/types/editor'
