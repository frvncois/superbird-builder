# AUDIT.md — Codebase audit (Pass 1 of REVIEW.md)

Date: 2026-08-29 · Baseline: commit `456566b` on `main` · Scope: `src/` (94 .vue, 69 .ts), `server/` (5 files), `scripts/` — ~24.6k LOC.
Method: three parallel read-only audit agents (dead code / duplication / architecture+patterns+size), each finding verified by grep incl. dynamic `import()`, `<component :is>`, template refs, string registries, and `server/`+`scripts/` usage.

**Playbook deviations (owner should know):** `MASTER.md` does not exist — CLAUDE.md was used as the architecture source of truth. No e2e suite or test runner exists — "full rebuild + e2e" is substituted with fresh `rm -rf dist && npm run build` (vue-tsc + vite). The host components named in REVIEW.md §4 (OverlayHostUi, ToastHost, TooltipHost, ContextMenuHost) do not exist in this repo; the actual equivalents audited are `ModalHost`, `ConfirmModal`, `ContextMenu`, popovers.

---

## 1. DEAD CODE

No orphaned files, no unused dependencies, no commented-out code blocks. Non-obvious edges verified live: `server/site-runtime.js` is read by path at `server/export.mjs:22`; `scripts/generate-demo.ts` writes `public/demo-project.json` consumed at `useEditorBoot.ts:70`; `src/lib/shared/*.js` used by client + server + scripts; all views lazy-loaded via router.

### MED — dead exported symbols (zero references anywhere, incl. own file)
| # | Path | Lines | Symbol |
|---|---|---|---|
| D1 | `src/lib/tieredBox.ts` | 127–135 | `gapScheme` const |
| D2 | `src/lib/components.ts` | 9–20 | `normalizeComponentName()` |
| D3 | `src/lib/styles.ts` | 1041–1063 | `defaultClass()` |
| D4 | `src/lib/roles.ts` | 17 | `roleBlurb` const |

### LOW — unnecessary `export` keyword (code used internally only; keep code, could drop `export`)
`tieredBox.ts:25 getStep`, `tieredBox.ts:139 BORDER_STEPS`, `components.ts:24 serializeNode`, `syntax.ts:23 linkFromToken`, `syntax.ts:35 lexLine`, `syntax.ts:484 suggestNextLine`, `styles.ts:964 isValidClass`, `valueClass.ts:7 ACCEPTED_UNITS`, `valueClass.ts:137 matchesNamedFormat`, `media.ts:4 KIND_MIMES`, `useProject.ts:9 MAX_BREAKPOINTS`, `useComments.ts:18 CURRENT_USER`, `useCommandPalette.ts:10 openPalette`. (13 items)

### UNSURE — exported types never imported by name but part of the inferred public API of exported functions (do not touch)
18 type exports, e.g. `syntax.ts:331 Diagnostic`, `document.ts:3 PageMeta`, `styles.ts:1008 ApplyClassResult`, `usePersistence.ts:7 SaveStatus`, `types/editor.ts:130 CommentReply`. Full list in audit notes; all annotate exported values.

---

## 2. DUPLICATION

Intentional per CLAUDE.md (listed, not counted): `server/export.mjs` deliberately reimplements the `useRenderNode` render semantics in plain JS (incl. its own `slugify` :70–78, `entrySlug` :78, href scheme allowlist), sharing registries via `src/lib/shared/`.

### HIGH
| # | Finding | Copies | Proposed home |
|---|---|---|---|
| F1 | `displayContent` precedence computed; Public+Content **byte-identical**, ElementRenderer adds `untranslated` tracking | `PublicRenderer.vue:54–70`, `ContentRenderer.vue:56–72`, `ElementRenderer.vue:62–86` | `useRenderNode.ts` |
| F2 | `srcAttr` computed (same 3-way split) | `PublicRenderer.vue:72–81`, `ContentRenderer.vue:79–88`, `ElementRenderer.vue:93–101` | `useRenderNode.ts` |
| F3 | `richContent` computed — 3 identical copies | `PublicRenderer.vue:84–86`, `ContentRenderer.vue:75–77`, `ElementRenderer.vue:89–91` | `useRenderNode.ts` |
| F9 | Deep clone `JSON.parse(JSON.stringify())` — 10+ sites, no helper; plus a repeated clone-then-reassign-UUIDs pattern (`usePage.ts:33–35`, `useCollections.ts:143–145`) | `useElement.ts:38–40,305,315`, `useCollections.ts:120,142,185`, `usePage.ts:33`, `useContextMenu.ts:125`, `merge.ts:233` | `src/lib/tree.ts` (`deepClone`, `cloneWithNewIds`) |
| F10 | `slugify` reimplemented: canonical `document.ts:36–43`; full re-impl `docs.ts:64`; **weaker variant `usePage.ts:22`** (`replace(/\s+/g,'-')` only — latent bug: punctuation survives into slugs); partial chain `useCollections.ts:38` | see left | `lib/document.ts` — NOTE: unifying `usePage.ts:22` changes emitted slugs → behavior change, deferred to QUESTIONS.md |
| F20 | Atomic write (`writeFile(tmp)`+`rename`) — proper helper exists at `auth.mjs:33–38` but reimplemented inline | `index.mjs:370–371`, `index.mjs:422–424`, `media.mjs:230–231` | shared server util |
| F21 | `send(res,…)` helper duplicated verbatim; `index.mjs` also repeats `send(res,401,{error:'unauthorized'})` ~8× where `media.mjs` has a `fail` helper | `index.mjs:91–93`, `media.mjs:67–69` | shared server util |

### MED
| # | Finding | Copies | Note |
|---|---|---|---|
| F4 | hover/click interaction handlers (`ofTrigger`/`fireIn`/`unfireIn`) — 3 identical | `ElementRenderer.vue:218–223`, `PublicRenderer.vue:144–149`, `ContentRenderer.vue:240–245` | → `useRenderNode.ts` |
| F5 | `classes` composition core (master/scoped + `backgroundInfo.hostClass`) — 3 near-copies, each adds extras | `ElementRenderer.vue:137–142`, `PublicRenderer.vue:93–97`, `ContentRenderer.vue:97–101` | → `useRenderNode.ts` base computed |
| F6 | `altAttr` computed — 2 identical | `ContentRenderer.vue:91–93`, `ElementRenderer.vue:104–106` | → `useRenderNode.ts` |
| F7 | `editableText` + `useInlineEdit` wiring — 2 close copies, differ in `escBehavior`/`onExit` | `ElementRenderer.vue:165–197`, `ContentRenderer.vue:110–139` | risky (behavioral options differ) |
| F8 | `linkTarget` `@item` resolution + href scheme allowlist | `PublicRenderer.vue:104–114`, `ContentRenderer.vue:174–183` | → `lib/navigation.ts` |
| F11 | `timeAgo` drifted copy ("5m ago"/"yesterday" vs lib's "5 minutes ago") | `lib/time.ts:2–23` vs `BranchesEditor.vue:65–73` | unifying changes displayed strings → QUESTIONS.md |
| F13 | `formatBytes` (`lib/media.ts:26`) bypassed by hand-rolled KB math | `SettingsPanel.vue:332` | unifying changes displayed string → QUESTIONS.md |
| F17 | Outside-click/Escape hand-rolled where `useDropdown.ts` exists: `MenuUI.vue:33–49` (verbatim reimpl), `CodeEditor.vue:248–252` (status menu). (`InsertDock.vue:123–138` / `ContextMenu.vue:85–99` add capture/keyboard-nav — UNSURE, leave) | see left | MenuUI is the clean win |
| F22 | `readBody` (`index.mjs:97`) vs `readBodyRaw(req,limit)` (`media.mjs:92`) | similar, not identical (size limit) | unify only if limits preserved → QUESTIONS.md |
| F24 | "replace tokens matching prefix" pattern in style controls | `SizeControl.vue:38–39`, `StyleEditor.vue:284–285`, `GapControl.vue:46`, `BorderStyleControl.vue:23`, `SpacingBoxControl.vue:78` | → `lib/valueClass.ts` if semantics prove identical; else QUESTIONS.md |

### LOW (left for human triage)
F12 `entrySlug` inline at `useCollections.ts:101` vs `navigation.ts:9` (UNSURE) · F14 whitespace tokenize ×4 (`useRenderNode.ts:137`, `useClassField.ts:9`, `StyleEditor.vue:99,161`) · F15 no shared `clamp` (context-specific uses) · F16 clipboard-copy+flag ×2 (`InviteDialog.vue:53–55`, `UsersSettings.vue:93` — divergent shapes; a new composable for 2 sites fails the no-new-generic-helpers rule; re-ranked from MED) · F18 focus-on-mount one-liner ×2–4 (re-ranked from MED, same reason) · F23 `JSON.parse(body)` try/catch ~10× in `index.mjs` · F25 style-control props/emits boilerplate · F26 hover-reveal action-row class string ~8× (would need a NEW component) · F27 locale fallback reads — clean, no finding. F19 confirm-delete flows — **no finding**, well centralized.

---

## 3. SEPARATION VIOLATIONS

**No true breaches.** The architecture holds:
- A1 `server/*` → `src/`: **CLEAN** — `export.mjs:14–19` imports only `src/lib/shared/*`; `site-runtime.js` imports nothing from src. Published output carries zero editor code.
- A3 `src/lib/shared/`: **CLEAN** — no vue, no `@/`, only shared→shared imports.
- A4 public site chunk: **CLEAN** — `SiteView` → `PublicRenderer` pulls only render-core composables (no useElement/usePanel/useComments/media library). *Foldering nuance (LOW):* `components/site/ContentRenderer.vue` + `CommentLayer.vue` are admin-only (import `useInlineEdit`, `useMediaLibrary`, `useComments`) but live in `site/` — misleading placement, not a bundle leak.
- A5 `src/types/`: **CLEAN** — type-only.
- A2 `src/lib/` purity (all LOW): `store.ts:1` imports `ref` from vue (documented intentional reactive cache — the only runtime-Vue lib file); `roles.ts:1` type-only import from a composable (backwards direction; `Role` could live in `src/types/`); `styles.ts`/`docs.ts`/`elementIcons.ts`/`elementPalette.ts` import `type Component` from vue (type-only, acceptable).

---

## 4. INCONSISTENT PATTERNS

| # | Finding | Where | Rank |
|---|---|---|---|
| P1 | **Destructive delete without ConfirmModal**: collection delete (template page + all entries!) and entry delete fire immediately — inconsistent with locale/media/branch deletes in the same header which all confirm | `AppHeader.vue:176` (`removeCollection`), `:207` (`removeEntry`); `useCollections.ts:127–130,196` | **MED** — fixing adds a dialog = behavior change → QUESTIONS.md |
| P2 | Hand-rolled inline "add locale" `<input>` where `InputUI` exists | `AppHeader.vue:254–263` | LOW |
| P3 | Hand-rolled Build/Content segmented switch (2 raw buttons) | `AppHeader.vue:274–288` | LOW |
| P4 | Raw save-status pill button (indicator+action, borderline) | `AppHeader.vue:301–308` | LOW |
| P5 | Third localStorage use beyond documented exceptions: `superbird-setup-name` first-run handoff | `SetupView.vue:33` → `useEditorBoot.ts:49–54` | LOW (likely intentional) |
| P6 | Escape handled via raw listeners in comment mode (borderline centralizable) | `useCommentMode.ts:25`, `CommentMarker.vue:49` | LOW |

Clean: modal shells all route through `ModalHost` (ModalDialog is layered on it, not competing); no `window.confirm`; only one unconditional `<Teleport>` (`InsertDragChip.vue:11`, justified drag chip); structural mutations fully centralized (zero tree splices outside `useElement`/`syntax`/`tree`); singleton-composable pattern followed; shortcuts properly routed through `useShortcut`/`useKeymap`.

---

## 5. OVERSIZED MODULES (>300 lines)

| Lines | File | Verdict | Rank |
|---|---|---|---|
| 1801 | `editor/code/CodeEditor.vue` | **Multiple jobs** (~7): folding, status dropdown, clipboard/keys, Shift-lift + reorder ghost animation, cursor/selection sync, gutter drag-reorder, validation/jump. Clean composable extractions exist. | **HIGH** |
| 1063 | `lib/styles.ts` | ~575 lines are the `STYLE_SECTIONS` data catalog (208–785) + class logic; data/logic split possible | **MED** |
| 746 | `server/export.mjs` | Render-mirror (307–566) + media extraction (170–271) + CSS compile + route orchestration; render half should stay intact per CLAUDE.md sync mandate | **MED** |
| 514 | `server/index.mjs` | HTTP entry routing across auth/store/publish/media/static — typical server entrypoint | MED (UNSURE) |
| 831 | `lib/docs.ts` | Documentation data — one cohesive job | LOW |
| 708 | `composables/useElement.ts` | The documented single home for structural mutations — one job by design | LOW |
| 592 | `lib/syntax.ts` | Cohesive DSL engine (lexer/parser/reconcile/validate/suggest) | LOW |
| 538 | `editor/style/StyleEditor.vue` | Mostly one job | LOW (UNSURE) |
| 534/403 | `server/media.mjs` / `server/auth.mjs` | Cohesive subsystems | LOW |
| 446–323 | `DataEditor` 446, `SettingsPanel` 389, `MediaLibraryModal` 382, `ElementRenderer` 376, `CanvasEditor` 359, `ContentRenderer` 343, `merge.ts` 342, `AppHeader` 341, `useComponents` 324, `InsertDock` 323 | Each one cohesive subsystem | LOW |

---

## Count summary

| Section | HIGH | MED | LOW | UNSURE |
|---|---|---|---|---|
| 1. Dead code | 0 | 4 | 13 | 19 |
| 2. Duplication | 7 | 10 | 9 | 3 |
| 3. Separation | 0 | 0 | 6 (all clean/notes) | 0 |
| 4. Patterns | 0 | 1 | 5 | 1 |
| 5. Oversized | 1 | 3 | ~16 | 2 |

**Triage note for later passes (owner away):** act on HIGH+MED only; every LOW stays here for human review. MED items whose fix would change visible behavior or output (F10 usePage slug, F11, F13, F22, P1) go to QUESTIONS.md, not code.
