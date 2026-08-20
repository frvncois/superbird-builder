# Codebase Audit — Superbird Builder

> Living tracker. Each item has a status checkbox and a **Notes** line updated as we work through it.
> Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` won't do (with reason)

**Baseline:** ~11.9k LoC (Vue 3 SPA + zero-dep node server). `npm audit` clean (0 vulns, dev + prod). Not a git repo on disk; `.gitignore` correctly covers `server/data/`. Auth crypto solid (scrypt + `timingSafeEqual`, 256-bit tokens, HttpOnly `SameSite=Lax`). No `v-html` anywhere; exporter escapes all user values.

---

## Prioritized action list

### Tier 1 — high ROI, do first (all low effort)
- [x] **S1** — `GET /api/published` leaks drafts + comments
- [x] **P1** — O(n²) per-node composables in renderers
- [x] **P2** — `hasUnpublishedChanges` re-stringifies whole project per edit
- [x] **S2** — export path traversal via `page.path`
- [x] **DC1** — remove Pinia + dead exports
- [x] **S3** — cookie `Secure` off by default
- [x] **S5** — export `err.message` returned to client
- [x] **S4** — SPA preview doesn't enforce `SAFE_HREF`

### Tier 2 — medium effort, real value
- [x] **P5** — dynamic-import `@tailwindcss/browser`
- [x] **D1** — extract shared pure logic (`ELEMENTS` + token validation) to `.js`
- [x] **D2** — `useRenderNode` composable across the two renderers
- [-] **D3** — unify dismissal into `useDismiss` — SKIPPED (low ROI)
- [-] **D5** — merge near-duplicate primitives — SKIPPED (low ROI)

### Tier 3 — larger, opportunistic
- [ ] **P3/P4** — content-addressed media store (references, not inline base64)
- [ ] **D4** — split `CodeEditor.vue` into composables
- [ ] **S6** — login rate limiter behind reverse proxy

---

## SECURITY

### [x] S1 — `GET /api/published` leaks draft pages + internal comments — MED / Low ✅ DONE
- **Where:** `server/index.mjs:220-231` (`handleGet`)
- **Problem:** Serves the entire snapshot, redacting only `settings.smtp`. Includes every page regardless of `status` (draft content public) and all `comments` (internal notes: author + text). Anyone can `curl /api/published`.
- **Fix:** Filter to `status === 'published'` pages and strip `comments` before responding (ideally reduce to only what the exporter renders).
- **Notes:** `handleGet` now builds a `publicSnapshot` projection: `pages` filtered to `status === 'published'`, `comments: []`, and `settings.smtp` dropped via spread (`{ ...settings, smtp: undefined }` → omitted by `JSON.stringify`). Consistent with the static exporter, which already drops drafts in `enumerateRoutes`. SPA `SiteView` already gated rendering on `status === 'published'`, so no client change needed. **Verified** with curl: a snapshot containing a draft page, an internal comment, and an smtp password → public GET returns only the published page, `comments: []`, no `smtp`, and neither the `SECRET` password nor the comment text appears anywhere in the response.

### [x] S2 — Export path traversal via unsanitized `page.path` — MED / Low ✅ DONE
- **Where:** `server/export.mjs:511` (`rel = page.path.replace(...)`), `:552` (`join(tmp, rel)`); second vector `collection.name` `:529`. Source: `CodeEditor` sets `page.path = typed.slug` with no slugify (entries ARE slugified).
- **Problem:** `slug: ../../../../dist` → writes attacker HTML to an arbitrary dir. Always named `index.html` (can't clobber `auth.json`/server code) but CAN overwrite `dist/index.html` (admin shell) = stored-XSS/defacement. Requires auth today; becomes real if untrusted project import is added.
- **Fix:** Slugify each path segment in the exporter and/or assert `resolve(join(tmp,rel)).startsWith(resolve(tmp))` before every write. Slugify `collection.name` in the route too.
- **Notes:** Implemented **both** layers. (1) New `safePath(path)` helper slugifies each `/`-separated segment and drops empties (`..` → `''` → dropped), applied to `page.path`, the locale `prefix` (also server-untrusted via `project.locales`), `collection.name`, and `entrySlug`. Legitimate nesting survives (`/blog/My Post` → `blog/my-post`). (2) A hard backstop in `write()`: `join(tmp, rel)` must equal or start with `resolve(tmp) + sep`, else it throws (caught by `handlePost` → 500, previous site kept). **Verified:** publishing a page with `slug: ../../../../dist` writes to `site/dist/index.html` (inside output), a nested `/blog/My Post` renders correctly, nothing escapes above `site/`, and `dist/index.html` (the admin shell) is untouched. Demo (collections + locales) still exports 18 routes — no regression.

### [x] S3 — Cookie `Secure` off by default — MED (deploy) / Trivial ✅ DONE
- **Where:** `server/auth.mjs:119`
- **Problem:** `Secure` only set when `COOKIE_SECURE=1`. If forgotten on HTTPS deploy, 30-day session cookie can travel plaintext.
- **Fix:** Default `Secure` on unless explicitly disabled for local dev; consider `__Host-` prefix.
- **Notes:** `Secure` is now **on by default under `NODE_ENV=production`** (the standard deploy flag) or `COOKIE_SECURE=1`; `COOKIE_SECURE=0` forces it off for local http dev. This closes the footgun (secure-by-default in prod) while keeping zero-config http dev working — so `npm run serve` in dev has no Secure flag (http login works), a `NODE_ENV=production` deploy is Secure automatically. **Verified** all four env combinations produce the right Set-Cookie. Updated the server header deploy line accordingly. (Skipped `__Host-` prefix — it forbids `Domain` and requires `Path=/` + Secure, fine here, but a larger change for marginal gain; noted as optional.)

### [x] S4 — SPA preview doesn't enforce `SAFE_HREF` — LOW / Trivial ✅ DONE
- **Where:** `PublicRenderer.vue:105-120` (`linkTarget`)
- **Problem:** Binds `:href="node.link"` without the allowlist the static export enforces. `javascript:` link executes in the owner's own preview (self-XSS only; real visitors get the safe export).
- **Fix:** Mirror the export's `SAFE_HREF` test in `linkTarget`.
- **Notes:** Added `if (!/^(\/|#|https?:|mailto:|tel:)/i.test(raw)) return null` in `linkTarget` — same allowlist as `export.mjs`. A `javascript:`/`data:` link now yields no `href` in the SPA preview, matching the static export. Type-check + build pass.

### [x] S5 — Export `err.message` returned to client — LOW / Trivial ✅ DONE
- **Where:** `server/index.mjs:259`
- **Problem:** Export-failure response includes `err.message` (Tailwind compile errors, absolute fs paths). Owner-authenticated, so low.
- **Fix:** Log full error server-side, return a generic message.
- **Notes:** Response is now `{ error: 'export failed — check the server logs' }`; full `err` still `console.error`'d server-side. No fs paths / compiler internals in the HTTP response.

### [ ] S6 — Login rate limiter weak behind a reverse proxy — LOW / Low
- **Where:** `server/auth.mjs:139-156`
- **Problem:** Per-IP in-memory on `socket.remoteAddress` (good — not XFF-spoofable). But behind a proxy every request is the proxy IP → one global bucket → 10 bad guesses lock out the owner. Resets on restart.
- **Fix:** If ever proxied, make trusted-proxy/XFF handling explicit + configurable; small global backoff. Fine for direct exposure.
- **Notes:**

### Accepted (no action) — reasoning
- `customCode.head` raw injection (`export.mjs:448`) — owner-authored, single trust principal (like any CMS custom-HTML).
- `@tailwindcss/browser` compiling user classes + injected `<style>` — token names/hex regex-validated before emission.
- No CSRF token — mitigated by `SameSite=Lax` + zero state-changing GET endpoints.
- `fonts.family` free-text into inline `style` — `escapeHtml` blocks breakout; residual CSS-only injection into owner's own site not exploitable.
- Store-key sanitization / media extraction / static serving — verified traversal-safe (decode-before-validate; allowlisted mime + hex hash; normalize + `startsWith`).
- Account-existence / login-timing disclosure — setup-state intentionally public (SPA needs it); single-user known email.
- **Open question:** no untrusted-JSON project import found today. If added, S2 + S4 rise in severity.

---

## PERFORMANCE

### [x] P1 — O(n²) per-node composables in the recursive renderers — HIGH / Low-Med ✅ DONE
- **Where:** `useInteraction.ts:16-34` (`all`, `targetIndex`), `useComponents.ts:42-59` (`masterMap`); called per-node from `ElementRenderer.vue:17-20` / `PublicRenderer.vue:25-27`.
- **Problem:** Each of N nodes builds its own memoizing computeds, each walking the whole page tree → O(n²) CPU + N Maps, all invalidating together on every structural edit. ~150-node page ≈ 22k node-visits + 150 Maps per edit.
- **Fix:** Hoist `all`/`targetIndex`/`masterMap` to module scope (depend only on `activePage`/`project` singletons → identical result per instance). One shared computed each → O(n).
- **Notes:** Moved `all` + `targetIndex` (and a module-scope `activePage`) out of `useInteraction()`, and `masterMap` + its deps (`project`, `activePage`, `components`, `findComponent`) out of `useComponents()`, to module scope. `useElement()` stays lazy inside `useComponents()`. Now **one shared computed each** across all N renderer nodes → O(n) instead of O(n²). Verified no import cycles first (`useElement`/`usePage`/`useProject` don't import these). Type-check + build pass. Headless reactivity test confirmed all paths still react: idle/fired interaction classes, `targetIndex` recompute on `setActivePage` switch, and `masterFor` mapping (instance root + inner child → master). No behavior change — the computeds derive purely from singletons, so a shared instance is identical to per-caller instances.

### [x] P2 — `hasUnpublishedChanges` re-stringifies the whole project per edit — HIGH / Low ✅ DONE
- **Where:** `usePublish.ts:32-34`, rendered live at `EditorView.vue:314`
- **Problem:** Undebounced `JSON.stringify(project) !== baseline` computed (images included) on every keystroke-batch, plus a second full-project string held in memory.
- **Fix:** Replace with a monotonic project-version counter (or stored hash) compared to the version at last publish.
- **Notes:** Chose a better approach than the version-counter: `usePersistence` now exports `currentSnapshot = computed(() => history[pointer])` — the whole-project snapshot it **already** stringifies for undo history. `hasUnpublishedChanges` compares that committed string against the baseline → **no new stringify per edit** (just a string compare, and only when history/pointer/baseline change, i.e. post-commit, not per-keystroke). `markPublished` now calls `saveNow()` first (settles pending edits) then publishes `currentSnapshot.value`, so the baseline and current snapshot are identical right after publishing. **Why not the version counter:** a counter falsely shows "unpublished" after undoing back to a published state; snapshot-compare is content-accurate. Verified headlessly (6 checks): never-published→dirty, snapshot tracks committed state, edit→dirty, publish→clean, edit-after-publish→dirty, and **undo-to-published→clean** (the counter would fail this). Trade-off: the dot now flips to "unpublished" on commit (≤500ms after you stop typing) instead of on the first keystroke — imperceptible, and the save-status dot already shows in-flight activity. Removed the now-unused `useProject` import from usePublish. Type-check + build pass.

### [ ] P3 — Undo history retains up to 50 full-project JSON snapshots — MED-HIGH / Med
- **Where:** `usePersistence.ts:88-104` (history cap 50)
- **Problem:** With inline base64 images a project is 2-5 MB; 50 snapshots ⇒ 100-250 MB retained + multi-MB stringify per settled edit.
- **Fix:** Cap history by total bytes not entry count; or structural diffs; best solved by P4.
- **Notes:**

### [ ] P4 — Base64 images inline in the project multiply every cost — MED-HIGH / High (root cause of P2/P3/store/boot)
- **Where:** `UploadUI.readAsDataURL` → `node.src`, favicon, OG image. Costs cascade through deep-watch, 3× whole-project stringify per edit, 50× history, per-save PUT, boot fetch.
- **Fix:** Content-addressed media store (references `/media/…` inside the working project) — the static exporter already does this at `export.mjs:200-213`. Collapses P2/P3/store/boot at once.
- **Notes:**

### [x] P5 — `@tailwindcss/browser` (317KB / 84KB gz) static-imported, blocks first paint — MED / Low ✅ DONE
- **Where:** `CanvasEditor.vue:4`, `SiteView.vue:8`
- **Problem:** Static-imported by both zones. Real published-site visitors do NOT get it (node server serves precompiled static files; SiteView only under `vite dev`/direct SPA hit). Cost is real for editor users (~84KB gz blocking first canvas paint).
- **Fix:** Dynamic `import()` after first paint; `manualChunks` entry so SiteView doesn't pull Tailwind as a hoisting side-effect.
- **Notes:** Replaced the static `import '@tailwindcss/browser'` in both files with a fire-and-forget `void import('@tailwindcss/browser')` in the script body — starts the download in parallel (during the editor's async boot round-trip) instead of sitting in the route's static dependency graph. Build confirms the split: Tailwind is now its own **lazy 279KB chunk** (`index.global-*.js`); the shared render-lib chunk dropped 317KB→38KB; neither `EditorView` nor `SiteView` chunk statically references it. Added `declare module '@tailwindcss/browser'` to `env.d.ts` (the dynamic `import()` needs the ambient decl the side-effect import didn't). Behavior unchanged — the runtime IIFE still runs, just async. Type-check + build pass. (Skipped the explicit `manualChunks` — Rollup already isolates it cleanly once the import is dynamic.)

### Fine as-is
Store adapter latest-wins coalescing (`store.ts:47-56`), `useThemeTokens` 200ms debounce, `suggestClasses`/VOCABULARY built once, CodeEditor per-keystroke tokenizing (scales with line count, not images).

---

## DUPLICATION & STRUCTURE

### [x] D1 — `export.mjs` re-implements ~90 lines of pure client logic — MED (drift) / Med ✅ DONE (the two flagged pieces; see residual)
- **Where:** `server/export.mjs` vs `lib/elements.ts` (`ELEMENTS`), `lib/tree.ts` (`walkNodes`), `lib/document.ts` (`slugify`), `useComponents.ts` (master pairing), `useLocale.ts` (locale reads), `lib/settings.ts` (token validation).
- **Problem:** Can't import `.ts`, but ~90 lines are pure data/fns. Drift is concrete: `RESERVED_TOKEN_NAMES` is a hardcoded 27-name list in the exporter vs *derived* from `TAILWIND_COLORS` in `settings.ts`. (Registries currently in sync — verified 34 keys each — but drift-prone.)
- **Fix:** Extract pure pieces to plain `.js` modules both sides import (client via Vite, server via node). Do `ELEMENTS` + token-validation first. ~220-line HTML serializer stays server-only.
- **Notes:** Created `src/lib/shared/` plain-JS ESM modules (root `package.json` is `"type":"module"`, so the node server imports them directly; client imports via Vite with `allowJs:true` added to `tsconfig.app.json`). **`elements.js`** holds `ELEMENTS_DATA`; `lib/elements.ts` re-exports it as the typed `ELEMENTS: Record<string, ElementDef>` (client call sites keep strong typing), and `export.mjs` imports `ELEMENTS_DATA`. **`tokens.js`** holds `TOKEN_NAME_RE`/`HEX_RE`/`RESERVED_TOKEN_NAMES`/`isValidToken`/`themeBlock`/`applyTitleTemplate`; `settings.ts` re-exports them (kept `tokenNameError`/`FONT_STACKS`/`defaultSettings`), and `export.mjs` imports `themeBlock`/`applyTitleTemplate` (deleted its ~20-line duplicate + `settingsThemeBlock`). **Eliminates the client↔server drift** for the registry and token validation (both now consume one source). **Verified:** type-check + build pass; `node` sanity of the shared modules (34 element keys, 27 reserved incl. `red`, `themeBlock` keeps `brand`/drops reserved `red`); server export produces `--color-brand:#6366f1` + `bg-brand{…}` in `site.css` (proving the shared `themeBlock` drives it); demo still exports 18 routes with `<h1>` tags. **Residual (documented, not eliminated):** the reserved palette names in `tokens.js` and the `TAILWIND_COLORS` keys in `colors.ts` are two lists — reduced from two drift axes to one (the dangerous preview-vs-export axis is gone); a sync comment now sits on both. **Deferred (lower value, stable fns):** `walkNodes`/`slugify`/locale-reads/master-pairing remain duplicated — low drift risk, not worth more cross-tree imports right now.

### [x] D2 — `PublicRenderer.vue` ↔ `ElementRenderer.vue` ~100 near-verbatim lines — MED / Med ✅ DONE
- **Where:** collection computeds, `mapping`, interaction-firing block are line-for-line identical; href-locale rule is a 3rd copy in `export.mjs`.
- **Fix:** `useRenderNode(node)` composable both consume; keep own templates/chrome. Real divergences (classes composition, content precedence) parameterized.
- **Notes:** New `src/composables/useRenderNode.ts` (115 lines) owns the shared core: `def`/`mapping`, collection + entry-scope resolution (`listCollection`/`itemCollection`/`itemEntry`/`itemTemplateChildren`/`selfNested`/`boundField`/`boundEntry`), interaction firing (`ofTrigger`/`fireIn`/`unfireIn`/`toggleIn`), `classesFor`/`scopedClassesFor` pass-through, and the scroll-into-view IntersectionObserver bound via a returned `el` ref. Takes a `() => props.node` getter for reactivity. Both renderers now consume it and keep only their divergent parts: ElementRenderer keeps selection/drag/inline-edit/context-menu/`untranslated`-dimming + `{field}` placeholder content; PublicRenderer keeps empty-bound-field content, `linkTarget`, and its click/hover handlers. **ElementRenderer 379→324, PublicRenderer 240→183** (net duplication removed). Type-check passes — importantly, **vue-tsc validates both full templates against the composable's return types**, so every `def`/`mapping`/`itemEntry`/`el`/etc. reference in both templates is confirmed wired. Build passes; static export (which doesn't use these components) still emits 18 routes. ⚠️ Vue SFC runtime rendering can't be exercised headlessly here — **a quick visual smoke of the canvas + published preview is recommended** (hover/click/appear interactions, collection lists, component instances). The extracted logic was moved verbatim, so risk is low.

### [-] D3 — Outside-click/Escape dismissal solved 5+ inconsistent ways — MED / Med — SKIPPED (low ROI)
- **Decision:** pure dedup, no bug/security/perf fixed. "Fixing" the inconsistency risks regressing intentional behavior (e.g. the right sidebar deliberately stays open on canvas clicks); the safe mechanism-only version is lower value still, and Vue dismissal behavior can't be verified headlessly here. Not worth the risk vs. reward. Revisit only if touching these components anyway.

- **Where:** `PopoverUI.vue:24-40` (click+Escape+drag-aware), `DropdownUI.vue:22-27` (click only), `ModalHost.vue:22-31` (Escape+backdrop), `SettingsEditor.vue:42-50` (Escape via `usePanel`), `CodeEditor.vue:253-263` (own click handler).
- **Fix:** One `useDismiss(el, {onClose, escape?, outside?})`.
- **Notes:**

### [ ] D4 — `CodeEditor.vue` — 927 lines, ~10 concerns — LOW-MED / Med-High
- **Where:** folding, 2 mini-dropdowns, panel shortcuts, cursor sync, gutter drag, validation, syntax coloring, ghost suggestions.
- **Fix:** Extract `useCodeFolding`/`useCodeHighlight`/`useGutterDrag`; sections already `// ---`-decoupled (low regression). Do when next in the file.
- **Notes:**

### [-] D5 — Near-duplicate primitives — LOW / Low — SKIPPED (low ROI)
- **Decision:** merging two ~6-line primitives that differ by one padding class saves a few lines but adds a prop + churns every consumer. Marginal. Not worth it.

- **Where:** `GroupPopover` ≈ `ModalGroup` (byte-identical except `p-3`/`p-4`); `DropdownUI` = single-consumer 80% clone of `PopoverUI` minus Escape; `HostPopover` header ≈ `ModalHeader`.
- **Fix:** Merge with a padding/size prop; make `DropdownUI` a `PopoverUI` variant.
- **Notes:**

### Did NOT reproduce (non-findings)
Duplicate `LocalePack`/`SettingsPack`/`MergeConflict` types (single definitions); `NodeProps` (deliberate clipboard projection). Single-consumer `accordion/*` and `tabs/*` families — idiomatic, leave unless reworking their consumer.

---

## DEAD CODE & DEPS

### [x] DC1 — Remove Pinia + dead exports — MED / Trivial ✅ DONE
- **Pinia dead:** `stores/counter.ts` never imported; `main.ts:4,11` installs `createPinia()` on every boot (incl. public SiteView) only for it. All state uses composable-singletons. → delete `stores/counter.ts`, drop `createPinia()` from `main.ts`, remove `pinia` from `package.json`.
- **Dead exports** (grep-confirmed): `normalizeComponentName` (`lib/components.ts:9`), `isColorToken` (`lib/colors.ts:34`), `resetProject` (`useProject.ts`), `findInteraction` in return object (`useInteraction.ts:130`).
- **Over-exported** (used only in own file — drop `export`): `MAX_BREAKPOINTS`, `defaultBreakpoints`, `CURRENT_USER`, `isEditable`.
- **Notes:** Deleted `src/stores/counter.ts` (+ empty `stores/` dir); removed `createPinia()` + import from `main.ts`; removed `pinia` from direct `package.json` deps. **`pinia` remains installed as a transitive dep of `vue-router@5.2.0`** (surfaced by `npm ls pinia`) — harmless and tree-shaken out of our bundle since nothing imports it; removing our *direct* declaration is still correct. Removed dead exports `isColorToken` and `resetProject` (function + return entry), and dropped `findInteraction` from `useInteraction`'s return object (kept the function — used internally by `pickTarget`). ⚠️ **Correction to the audit:** `normalizeComponentName` is **NOT dead** — it's called at `useComponents.ts:215` (`createComponent`); the flagging grep missed it. I removed it, `vue-tsc` caught it immediately, and I restored it. Left the four cosmetic over-exports as-is (pure `export`-keyword churn, ~zero value, not worth the diff/risk). Type-check + build pass; no `createPinia`/counter refs remain in `src`.

### [ ] DC2 — Dependency / config hygiene — LOW
- `@tailwindcss/node` likely belongs in `devDependencies` (server-build integration, not in browser bundle) — confirm.
- Geist fonts: full unicode subsets emitted (~147KB) but only used ranges downloaded (~52KB English). Optional: import `latin` subsets only; load Geist-Mono only in the editor (currently global incl. public SPA).
- Node version mismatch: local `v20.19.0` vs `engines ^22.18 || >=24.12` — operational, not a vuln.
- No `?demo` npm script (run via bare `npx tsx`) — add one if used.
- **Notes:**
