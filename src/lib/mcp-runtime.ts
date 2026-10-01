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
  // the node-only state a node carries (classes/content/bindings/…): one
  // definition, shared by reconcile's reparent guard and by set_page_code's
  // `fresh`. They had drifted when spelled out separately.
  hasNodeState,
  stripNodeState,
  NODE_STATE_KEYS,
  BUILTIN_LIST_SOURCES,
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
  REF_SLOT,
  refOf,
  withoutRef,
} from './syntax'
export type { Diagnostic } from './syntax'

// components: instance detection, name normalization, master serialization,
// and instance-block expansion (styles/interactions live on the master)
export {
  isComponentType,
  normalizeComponentName,
  hoistBlockRef,
  serializeNode,
  expandComponentInstances,
  adoptStructure,
  cloneForMaster,
  stripExtractedInstanceState,
  alignInstanceLines,
} from './components'
export type { AdoptResult, OrphanedNode } from './components'

// whole-project component operations. Pure and DOM-free, so the agent path
// runs the editor's own code instead of a copy that has to be kept in step.
export {
  rewriteInstanceBlock,
  isClosedBlock,
  pushMasterStructure,
  alignMirrors,
  // the verbs the Components drawer offers a human — rename, duplicate,
  // regroup, detach, delete — so an agent is not left with a smaller set
  setComponentMeta,
  componentUsage,
  renameComponent,
  duplicateComponent,
  setComponentCategory,
  detachInstance,
  deleteComponent,
} from './componentOps'

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

// inline SVG for the `:icon:` element — the sanitizer every renderer trusts.
// The icon TABLE is deliberately not re-exported: it is the whole Lucide set,
// and the tools import it on demand (see loadIcons in mcp/tools.mjs)
export { sanitizeInlineSvg, lucideSvg, lucideNameOf } from './shared/svg.js'

// variants: picks → classes. The exporter takes `effectiveClasses` from this
// bundle too — it needs the full style catalog, which is TypeScript
export { effectiveClasses, pickedKeys, variantKey, VARIANT_NAME_RE } from './variants'
export {
  addVariantAxis,
  renameVariantAxis,
  removeVariantAxis,
  addVariantOption,
  renameVariantOption,
  removeVariantOption,
  setVariantDefault,
  setVariantAxes,
  setInstancePick,
  setVariantClasses,
} from './variantOps'
export { mergeClassLayers, sameLayerProperty } from './styles'

// component instances — the one pairing walk, and the chain it resolves
export {
  buildInstanceMap,
  canNest,
  componentReaches,
  dependencyOrder,
  nestedComponentNames,
  isInstanceWrapper,
  resolvePicks,
  resolveInstanceValue,
  inheritedInstanceValue,
  isNodeHidden,
  setNodeHidden,
} from './shared/instances.js'

// --- custom attribute allowlist (src/lib/shared/attributes.js) — the MCP
// sanitizes attributes with the SAME allowlist the editor and exporter use
export { sanitizeAttributes, isAllowedAttribute } from './shared/attributes.js'

// which nodes a route renders under an entry scope — the publish check for a
// binding whose target it can never reach (see shared/entryScope.js)
export { buildScopeRoots, isEntryScopeRoot } from './shared/entryScope.js'

// --- per-locale SEO purge (src/lib/shared/locales.js) — page/project SEO
// overrides live outside the node `locales` buckets, so removing a locale has
// to clear them too, identically in the editor and here
export { purgeLocaleSeo, countLocaleSeo } from './shared/locales.js'

// --- design-token validation (src/lib/shared/tokens.js) + settings defaults
export {
  isValidToken,
  isEmittableToken,
  isReservedToken,
  tokenError,
  TOKEN_NAME_RE,
  HEX_RE,
  RESERVED_TOKEN_NAMES,
  isThemeValue,
} from './shared/tokens.js'

// --- custom webfonts (src/lib/shared/fonts.js) — agents register fonts as
// data, NOT as hand-written @font-face in customCodeHead (head code is
// exporter-only, so those fonts never render in the editor or preview)
export { fontError, fontFormatForUrl, FONT_FORMATS } from './shared/fonts.js'

// motion engine — the validators and vocabulary agents need to author
// animations, plus the compiler so a tool can report a timeline's length.
// DOM-free by construction (see src/lib/shared/motion.js).
export {
  MOTION_PROPS,
  EASINGS,
  EASING_KEYS,
  compileAnimation,
  validateAnimation,
  validateBinding,
  APPEAR_MODES,
  validateMotionSettings,
  TRANSITION_PRESET_IDS,
  TRANSITION_DEFAULTS,
  SCROLL_LERP_MIN,
  SCROLL_LERP_MAX,
} from './shared/motion.js'
export { defaultSettings } from './settings'

// --- slider (carousel) config — validated against the SAME rules the editor's
// Data panel writes through, so an agent can't author a config the UI refuses
export { SLIDER_DEFAULTS, validateSliderConfig, resolveSliderConfig } from './shared/slider.js'

// --- interaction key identity + vocabulary (src/lib/shared/interactionKeys.js).
// The MCP validates bindings against the SAME trigger/action lists the editor,
// exporter and published runtime use — and state being keyed by
// (interaction, target) rather than by binding is what makes an open button and
// a close button drive one effect, so agents can build modals at all.
export {
  INTERACTION_ACTIONS,
  INTERACTION_CLOSE_ON,
  INTERACTION_ONCE,
  INTERACTION_TRIGGERS,
  DEFAULT_SCROLL_AT,
  interactionStateKey,
  interactionGroupKey,
  isSymmetricTrigger,
} from './shared/interactionKeys.js'

// --- project/page factories (src/lib/factories.ts) — create_page mirrors the
// editor, and createProject lets the SERVER seed a fresh instance's Main blob
// so a headless install doesn't wait for somebody to open /admin in a browser
export { createPage, createProject, defaultBreakpoints } from './factories'

// --- shared element/node types (compile-time only; erased at runtime)
export type { ElementNode } from '@/types/editor'

// the bundled component library — so the exporter's own tests, and any tool
// that adds a library entry, build components with the editor's code
export {
  CATALOG,
  CATALOG_TOKENS,
  catalogEntry,
  catalogDependencies,
  materializeCatalogEntry,
} from './catalog'
