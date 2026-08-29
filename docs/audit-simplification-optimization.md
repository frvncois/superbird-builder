# Superbird Builder — Simplification & Optimization Audit

_Date: 2026-08-21 · Scope: `src/`, `server/` · No code changes made — report only._

**Overall health: strong.** `npm audit` is clean (0 vulns), routes are already lazy-loaded, `@tailwindcss/browser` is already code-split, autosave/token-recompiles are already debounced, the auth core is genuinely solid, and there's essentially no dead code or unused deps. The auth-heavy hot paths and the client/export render duplication are where the real leverage is.

---

## 🔴 HIGH — do these first

### H1. Client renderers and the static exporter reimplement the same render semantics 4× (already drifting)
**Files:** `src/composables/useRenderNode.ts` (shared scaffold only) → `ElementRenderer.vue`, `ContentRenderer.vue:34-64`, `PublicRenderer.vue:45-98`, and reimplemented in plain JS at `server/export.mjs:78-372`.

`useRenderNode` only shares resolution *primitives*. The actual content-precedence, src-precedence, locale reads, link/locale-prefix resolution, and class composition are copy-pasted across all three renderers and the exporter. `displayContent`/`srcAttr` are byte-identical between `ContentRenderer` and `PublicRenderer`; the link scheme-allowlist + locale-prefix algorithm is duplicated in `PublicRenderer.vue:77-98` and `export.mjs:268-282`. **Confirmed live drift:** `export.mjs:106-134` `buildPlainTargets` documents itself as diverging from the SPA's interaction index. CLAUDE.md says "keep the two in sync" with no mechanism enforcing it.

**Fix:** Move pure semantics into `src/lib/shared/` (pattern already used by `elements.js`/`tokens.js`): `resolveContent`, `resolveSrc`, `resolveHref`, and the interaction indexers. Both `useRenderNode` and `export.mjs` import them. Collapses ~4 copies to 1. **Effort: large. Highest correctness payoff.**

### H2. No shared `fetch` wrapper — 401 handling copy-pasted, and *missing* on some paths (latent bug)
**Files:** `src/lib/store.ts:75-107`, `useUsers.ts:22-31` (the de-facto correct helper), `usePublish.ts:42-52`, `useAuth.ts:25-50`, `useEditorBoot.ts:50-52`, `SiteView.vue:39-49`, `SetPasswordView.vue:21-52`.

8 files call `fetch` in ~6 conventions. The `401 → onUnauthorized()` block is duplicated verbatim in 4 of them — but **`useAuth.check`, `useEditorBoot`, and `SiteView` omit it entirely**, so a dead session on those paths won't bounce to login.

**Fix:** Promote `useUsers.json()` to an exported `apiFetch()` in `src/lib/api.ts`; route auth/publish/users/SetPassword through it. `store.ts` keeps its retry queue but calls the shared 401 branch. **Effort: medium. Kills the most duplication + fixes a real bug.**

---

## 🟠 MEDIUM — security

These are the security agent's real findings (auth core itself is sound — scrypt + `timingSafeEqual`, hashed single-use invite tokens, HttpOnly/SameSite cookie, user-enumeration defense all confirmed good).

### S1. SMTP credentials readable by any authenticated user (incl. contributors) — `server/index.mjs:300-318`
The publish endpoint carefully redacts SMTP creds, but the raw project blob (containing `settings.smtp.{user,password,host}` in cleartext) is stored under a predictable key. `handleStore` GET authorizes *any* session — a contributor can `GET /api/store?keys=superbird-project:main` and read the SMTP password. **Fix:** strip `settings.smtp` from `/api/store` responses for non-admins, or keep secrets out of the shared blob. **Sev: med.**

### S2. Editor-authored custom JS runs same-origin as `/admin` + `/api` → editor→admin escalation — `server/export.mjs:375-443`, served by `index.mjs:396-430`
Emitting owner custom code is an expected feature; the risk is the *trust boundary*. The published site is served from the **same origin** as the admin API with a `SameSite=Lax` cookie, and any `editor` (not just admin) can author JS. If a logged-in admin browses a published page, that JS can call admin-only endpoints as them. No CSP is set. **Fix:** serve the published site from a separate origin, and/or emit a strict CSP on exported pages. **Sev: med** (needs-verification — depends on same-origin deploy, which the bundled server does by default).

### S3. Contributor content-only rule is bypassable via raw store PUT — `server/index.mjs:300-337`
Known/documented gap (`docs/security-structural-enforcement.md`), but it compounds S2: a contributor can `PUT` a blob setting `settings.customCode` — which the UI never lets them touch. **Fix (minimum):** block contributors from writing `customCode`. **Sev: low** (accepted, but flag the customCode edge).

### S4–S6. Lower-severity server hardening
- **S4** `server/index.mjs:166` — rate limiting keyed on raw socket IP, ignores `X-Forwarded-For` (behind a proxy all clients share one bucket); `/api/auth/update` unthrottled. **Sev: low.**
- **S5** `server/index.mjs:415-419` — `handleStatic` index fallback skips the `startsWith(SITE)` containment check (believed non-exploitable due to leading-slash normalize; defense-in-depth). **Sev: low.**
- **S6** `server/index.mjs:364` — `PUBLISH_TOKEN` compared with `===` instead of `timingSafeEqual`. **Sev: low.**
- **Housekeeping:** `.gitignore` has no `.env` entry (nothing secret is tracked today, but add it defensively).

**XSS: clean.** No `v-html`/`innerHTML`/`eval` anywhere; export escapes all content/attrs/SEO, href+src are scheme-allowlisted. The only raw-HTML sink is the intended `customCode` feature.

---

## 🟠 MEDIUM — structure & performance

### M1. Two copies of the keyboard-reorder algorithm — `CodeEditor.vue:748-794` vs `useElement.ts:502-553`
Single-element `moveSelected` and multi-element `moveSelectionGroup` implement the same descend/escape/swap logic in two files (the latter's comment admits it "mirrors moveSelected"). Also architecturally wrong: `moveSelected` should live in `useElement`. **Fix:** unify into one `moveSelection(dir)`. **Effort: medium.**

### M2. `NodeProps` copy-paste snapshot omits `arg`/`entryId` — likely paste bug — `useElement.ts:10-20`
The copy-paste `NodeProps` type manually lists fields and drops `arg`/`entryId`, so pasting a `collection-item` likely loses its picked-entry binding. **Fix:** `type NodeProps = Pick<ElementNode, ...>` so the compiler forces a decision. **Effort: small. Verify whether the omission is a real bug.**

### P1. IntersectionObserver created for *every* node × every breakpoint frame — `useRenderNode.ts:83-93`
`onMounted` unconditionally creates + observes an IO for every node, but only `appear`-interaction nodes need it. A 200-node page × 4 breakpoints ≈ 800 observers churned on every page switch. **Fix:** guard creation on `appear` presence (or share one module-scope observer). **Effort: small. Best impact/effort in the whole audit.**

### P2. `reconcile()` runs a full O(n·m) LCS DP matrix on every keystroke — `lib/syntax.ts:163-210`
Typing calls `reconcile` with no explicit `map`, allocating an (n+1)×(m+1) `Uint32Array` per character. ~160k cells/keystroke on a 400-line page → visible lag on large pages. **Fix:** fast-path single contiguous edits (common prefix/suffix compare) and fall back to LCS only for paste/multi-line. **Effort: medium. Must re-test node-identity invariants.**

### P3. Component-sync watcher re-joins *all* page code on every mutation — `useComponents.ts:180-191`
`watch(() => project.value.pages.map(p => p.code).join(' '))` rebuilds a concatenation of every page's full source on every keystroke just to compute the watch key. **Fix:** watch a bumped `codeRevision` counter instead. **Effort: medium.**

### P4. `styledLines` re-tokenizes the whole file with per-line regex on every keystroke — `CodeEditor.vue:1009-1071`
Recomputes all lines' syntax highlighting (new arrays for every row) on each keystroke, defeating Vue's keyed `v-for`. **Fix:** memoize per-line tokenization keyed by `(lineText, depth, dim)`. **Effort: medium.**

### M3. Large multi-responsibility files (split for maintainability, no logic change)
- `CodeEditor.vue` (1506 lines, ~14 jobs) → extract `useCodeFolding`, `useReorderGhost`, `useSyntaxHighlight`, `useCodeAutocomplete`.
- `styles.ts` (1003 lines) → split catalog / vocabulary / applyClass.
- `useElement.ts` (584) — houses the shared mutation logic; less urgent.

**Effort: large. Do opportunistically, not as a standalone push.**

### M4. Modal/popover inconsistency — 3 modal-invocation conventions; destructive confirms done 3 ways
`ConfirmModal` in some places, hand-rolled buttons in `InteractionsEditor.vue:92-95`, and **no confirm at all** in `BranchesEditor.vue:119-122` (deletes a branch silently). The "Delete locale" `ConfirmModal` is duplicated verbatim in `SettingsPanel.vue:342-348` and `AppHeader.vue:360-364`. **Fix:** standardize on `ModalDialog` + `ConfirmModal`; route branch/interaction deletes through it. **Effort: medium.**

---

## 🟢 LOW — dead code & quick tidy-ups

**Genuine dead code (zero call sites, grep-verified — delete):**
- `defaultClass` — `styles.ts:981` (~25 lines) · **med**
- `normalizeComponentName` — `components.ts:9` · med
- `openPalette` — `useCommandPalette.ts:10` (+ its return-object entry) · low

**Small consolidations:**
- `deepClone`/`newId` helpers — `JSON.parse(JSON.stringify())` inlined 9×, `crypto.randomUUID()` ~24×; add to `lib/tree.ts` (prefer `structuredClone`).
- Near-identical `CreateComponentModal` ≈ `CreateCollectionModal`; `GroupPopover` ≡ `ModalGroup` (only padding differs); `HostPopover` header ≈ `ModalHeader`.
- `User`/`Invite`/`Profile` shape re-declared 4× (`useUsers`, `useAuth`, `server/auth.mjs`).
- `pendingFocus` consume pattern copy-pasted in 3 editors → `usePanelFocus`.
- Recurring `text-xs text-muted-foreground` (×15) → a `Caption` component.
- `useCommandPalette` dual API (standalone fns + return object) — pick one.
- Dozens of `export`s used only within their own file (cosmetic; near-zero payoff — skip unless you like it tidy).

**Not problems** (checked, ruled out): `factories.ts`, `tieredBox.ts`, `src/lib/shared/*`, all migrations, all 8 deps, all 69 `.vue` components — all live. No circular imports. No TODO/FIXME/commented-out blocks.

---

## Prioritized action list

| # | Action | Impact | Effort | Type |
|---|--------|--------|--------|------|
| 1 | **P1** — guard IntersectionObserver on `appear` | High | Small | Perf |
| 2 | **H2** — shared `apiFetch`, fixes missing-401 bug | High | Med | Dup+bug |
| 3 | **M2** — `NodeProps = Pick<…>`, verify paste bug | Med | Small | Bug |
| 4 | **S1** — strip SMTP creds from `/api/store` for non-admins | Med | Small | Security |
| 5 | Delete `defaultClass`, `normalizeComponentName`, `openPalette` | Low | Small | Dead code |
| 6 | **S6/S5/S4** — `timingSafeEqual`, static-path guard, XFF; add `.env` to `.gitignore` | Low | Small | Security |
| 7 | **M1** — unify the two reorder implementations | Med | Med | Dup |
| 8 | **P3** — cheap watch key for component sync | Med | Med | Perf |
| 9 | **P2 / P4** — fast-path reconcile LCS + memoize tokenization | Med (High on big pages) | Med | Perf |
| 10 | **M4** — standardize modals/confirms (adds missing branch-delete confirm) | Med | Med | Structure |
| 11 | **S2/S3** — decide custom-code trust boundary (CSP / separate origin / block contributor customCode) | Med | Med–Large | Security |
| 12 | **H1** — shared render semantics in `lib/shared/` | High (correctness) | Large | Dup+drift |
| 13 | **M3** + LOW consolidations (deepClone, modal merges, etc.) | Low–Med | Large | Structure |

**Suggested first batch (high value, low risk): 1–6.** Mostly small, independently shippable, and includes the one confirmed perf win, the missing-401 bug, and the SMTP leak.

_No test runner is configured — exercise any `reconcile`/parse changes with a throwaway `tsx` script per CLAUDE.md._
