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
  dataMarkerOf,
  withDataMarker,
  hasOpenArgBracket,
} from './syntax'
export type { Diagnostic } from './syntax'

// components: instance detection, name normalization, master serialization,
// and instance-block expansion (styles/interactions live on the master)
export {
  isComponentType,
  normalizeComponentName,
  serializeNode,
  expandComponentInstances,
} from './components'

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
// setStyleTokens feeds the project's design-token names into the (module-level)
// class vocabulary so bg-<token>/text-<token>/border-<token> validate — the MCP
// toolset calls it on every project load, mirroring useSettings' watcher
export {
  applyClass,
  isValidClass,
  matchClass,
  sameProperty,
  isStateClass,
  setStyleTokens,
} from './styles'
export type { ApplyClassResult, StyleProperty, StyleSection } from './styles'
export { STYLE_SECTIONS } from './styleCatalog'

// --- rich-text sanitizer + URL allowlists (src/lib/shared/, plain JS) — the
// content tool stores element text through the SAME sanitizer the editor and
// the static exporter use, and gates media src on the same scheme allowlist
export { isRich, sanitizeRich } from './shared/richtext.js'
export { SAFE_HREF, SAFE_SRC } from './shared/urls.js'

// --- custom attribute allowlist (src/lib/shared/attributes.js) — the MCP
// sanitizes attributes with the SAME allowlist the editor and exporter use
export { sanitizeAttributes, isAllowedAttribute } from './shared/attributes.js'

// --- design-token validation (src/lib/shared/tokens.js) + settings defaults
export { isValidToken, TOKEN_NAME_RE, HEX_RE, RESERVED_TOKEN_NAMES } from './shared/tokens.js'
export { defaultSettings } from './settings'

// --- page factory (src/lib/factories.ts) — create_page mirrors the editor
export { createPage } from './factories'

// --- shared element/node types (compile-time only; erased at runtime)
export type { ElementNode } from '@/types/editor'
