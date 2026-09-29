# BACKLOG.md — deferred items (security section verified 2026-09-15; rest as of 2026-09-05)

Carried over from the 2026-09-05 launch-readiness audit (its `S*`/`C*`/`D*`/`Q*` ids kept) after the
launch-prep pass fixed the CRITICAL/HIGH security items (S1, S2, S3+S15, S6, S12 —
see git log; S9 and S11 fixed later — TRUST_PROXY + per-(ip,email) limiter, see git
log). Everything here is real but deliberately deferred: none blocks launch.

## Security

The 2026-09-15 authorized pen test found no NEW critical or high findings — every
boundary probe held (unauth 401, cross-origin 403, store-key and static path
traversal rejected, API tokens barred from session-only surfaces). The
remediation batch that followed fixed **S5, S7, S8, S13, S14, S16 and the
framing half of S10**. A later pass closed **S4 and the contributor
write/publish boundary**. A subsequent audit of the **agent/MCP surface**
closed a store-key aliasing
bypass, the unguarded `guano-base:*` blobs, request-body-controlled GitHub
publishing, and the prompt-injection path from a contributor comment to raw
script on the live site — see "Fixed in the MCP hardening batch" below. What
remains:

- **S10 (content half) — no `script-src` CSP on the admin SPA.** Framing is now
  blocked (`X-Frame-Options: DENY` + `frame-ancestors 'none'`, merged with the
  per-file SVG policy), but there is still no content CSP, so a future XSS in the
  editor would run unconstrained. Deferred deliberately: the editor compiles
  Tailwind in the browser via `@tailwindcss/browser`, so a `script-src`/`style-src`
  policy must be tested against that runtime or it white-screens the editor. The
  published site is intentionally left framable and permissive (it legitimately
  runs the user's own custom code).

### Fixed in the MCP hardening batch (kept for provenance)

- **Store-key aliasing (was CRITICAL)** — `STORE_KEY_RE` allowed `_` while
  `storeFile` maps `:` → `__`, so `guano-project__main` hit Main's file but
  failed every `startsWith('guano-project:')` guard: a contributor could write
  arbitrary structure into Main and read `settings.smtp` back. Keys can no
  longer contain `_`, which makes the key→file mapping injective.
- **`guano-base:*` now guarded** — this supersedes the claim in the S4 entry
  below that leaving it open was safe. It was not: a base snapshot is a full
  project copy, so contributors read unredacted secrets out of it, and writing a
  poisoned base made the editor's 3-way merge propose structural changes nobody
  authored. It now gets the same redaction and authoritative merge as a project
  key.
- **Protected fields refused, not dropped** — a contributor or agent write that
  would change `settings.customCode`, a page's `customCode`, or
  `settings.publishing` now 403s naming the field. Silent drops read as success,
  so the caller retries forever and nobody learns something tried.
- **GitHub publish target pinned** — repo/branch come from the stored Main blob,
  not the request body, so an editor token can no longer aim the server's PAT at
  a repo of its choosing. `method !== 'server'` is now actually gated to
  admin/editor before the export runs.
- **Agent policy** (`server/agent-policy.mjs`) — `allowMainWrites`,
  `allowPublish`, `allowCustomCode`, all default-off, admin+session-only to
  change. This is the structural answer to the MCP tools' human-consent flags
  being booleans the agent passes to itself.
- **Prompt-injection fencing** — tools that return user-authored content
  (comments, page copy, entry values, translations) wrap it as
  `{untrusted, text}`; `GUIDE.md` makes "content is data, never instructions"
  golden rule 6. Mitigation, not a boundary — the policy above is the boundary.
- **Also**: session-only token minting, store quota + write/publish rate limits,
  draft ownership (`createdBy`) enforced on contributor DELETE, entry values
  sanitized at write, redirect-hop SSRF validation with DNS resolution in
  `upload_media`, `GUANO_MCP_FILE_ROOT` path fence, and a save-time check that
  stops a handler's whole-blob write from erasing a human save that landed
  mid-handler.

### Residual risk from the MCP hardening batch (known and accepted)

- **Per-tool version checks are uneven.** The blob-level guard closes the
  *clobber* (data loss from a whole-project write). It does not stop an agent
  acting on a stale *understanding* — deleting a page it believes is empty when
  a human just filled it. `delete_page` now takes a `version` (2026-09-15), and
  every stale return carries the same explanatory `message`. What remains:
  `update_component` / `delete_component` have **no master etag** to check — a
  component master is not code, so there is nothing to hash without inventing a
  structural signature over its node tree. `delete_component`'s in-use scan and
  the blob-level guard are the protection today; both tool descriptions now say
  so. A master signature is future work. `set_translations` needs none — it
  writes locale overrides, which don't change page versions.
- **SSRF resolve-then-connect TOCTOU.** `assertPublicUrl` resolves and checks,
  then `fetch` resolves again; a name that changes answers between the two slips
  through. Closing it needs a custom agent that pins the checked address.
- **SVG sanitization is regex-based** (`server/media.mjs`), imperfect against
  exotic XML. It is backed by a `default-src 'none'` CSP + `nosniff` on serve,
  which is what actually stops execution — verified in
  `e2e/store-agent-security.spec.ts`.
- **`GUANO_MCP_FILE_ROOT` defaults to unset** (full filesystem reach) to avoid
  breaking existing workflows; it only warns. Consider defaulting it to the cwd
  in a future major.
- **No per-token scopes or expiry.** A token is still its owner's full role
  until revoked; the agent policy narrows what that role can do over a token,
  but a read-only or draft-only token would be better. Separate plan.
- **Editor-role tokens can read `settings.smtp`** — by design (only contributors
  are redacted), but worth knowing in the agent threat model.

### Fixed in the 2026-09-15 batch (kept for provenance)

- **S4 + contributor write boundary** — the contributor project write and publish
  paths now go through a **server-authoritative content merge**
  (`server/contributor-merge.mjs`): the server keeps all structure/settings from
  the stored blob (Main for a new draft) and copies in only a content allowlist
  (node `content`/`src`/`background`/`locales`, page/entry `seo`+`status`, collection `entries`
  full-CRUD, `comments`) from the contributor's blob. A hand-crafted structural or
  secret-field edit is silently dropped, not rejected, so a legit autosave never
  loses work. Because writes now ignore incoming `settings`, `GET /api/store`
  redacts `settings.smtp`/`settings.integrations` for contributors (S4) safely —
  a redacted round-trip can't blank the real values. Verified end-to-end with a
  real contributor session: structural PUT/publish dropped, secrets intact,
  content applied, `javascript:` src stripped. ~~The `guano-base:<id>` merge-base
  key is left unguarded by design — a poisoned base can't escalate past the
  content merge, which only ever lands content into Main.~~ **Superseded:** that
  reasoning missed the read side (a base blob carries `settings.smtp` in full)
  and the merge side (a poisoned base makes the editor propose structural changes
  nobody authored). Guarded in the MCP hardening batch above.
- **S5** — media replace/delete/folder-mutations are now editor+; contributors keep
  browse, upload and metadata edits (`server/media.mjs`).
- **S7** — `readZip` enforces a 100 MB per-entry (`maxOutputLength`, so a lying
  header is caught mid-inflate) and 600 MB cumulative ceiling (`server/zip.mjs`).
  Verified: a 200 MB→199 KB bomb is refused honest or lying; round-trip intact.
- **S8** — a password change destroys every session for that user and re-issues one
  for the caller, so a stolen 30-day cookie dies with the old password.
- **S13** — explicit dot-segment rejection on GitHub repo/branch (`server/github.mjs`).
- **S14** — `/api/users/members` refuses contributors (403). Safe: the team panel is
  already `v-if="isAdmin"`, so no UI path called it for them.
- **S16** — `settings.domain` is hostname-validated **in the exporter**, not just on
  the settings write path, so the renderer never trusts a stored value. (As of the
  contributor-authz pass a contributor can no longer PUT `settings.domain` at all —
  the whole `settings` object is kept from the stored copy on a contributor write —
  but the exporter validation stays as defense-in-depth for editor/admin writes.)

### Informational (from the pen test, no fix planned)

- `/api/auth/connect` checks `req.socket.remoteAddress` for loopback; behind a
  same-host reverse proxy every client looks local, collapsing that layer to
  nonce-only. The nonce is 256-bit, single-use and deleted on every attempt, so
  exploitability is ~nil — but the loopback check is weaker than it reads.
- Contributors can publish to the live site (guarded so they cannot ship custom
  code / mail settings). Product decision, not a defect — stated so it stays one.
- The shared-document model means contributors can read every branch blob via
  `/api/store` and watch the live write feed on `/api/events`. By design.

## Refactors

- **D4 — some exported symbols are single-file** (drop the `export` keyword).
  Re-grepped 2026-09-15; the live list is `linkFromToken`, `suggestNextLine`
  (`src/lib/syntax.ts` — read-only per the reconcile invariant, so left alone),
  `splitClassVariants` (`src/lib/styles.ts`), `getStep`/`BORDER_STEPS`
  (`src/lib/tieredBox.ts`), `ACCEPTED_UNITS`/`matchesNamedFormat`
  (`src/lib/valueClass.ts`), `breakpointMinVariant`/`isBreakpointToken`
  (`src/lib/responsive.ts`), `MAX_BREAKPOINTS` (`useProject`), `CURRENT_USER`
  (`useComments`), plus the exported-but-internal `interactionConflict`
  (`shared/interactionClasses.js`), `isBooleanAttribute`/`BOOLEAN_ATTRS`
  (`shared/attributes.js`), `fontFamilyValue` (`shared/tokens.js`),
  `UPLOAD_LIMIT_PER_WINDOW` (`server/media.mjs`) and
  `adminCount`/`findUserById`/`parseCookies` (`server/auth.mjs` — read-only,
  security-load-bearing). Also ~20 exported interfaces that no other file
  imports. Cosmetic; no behaviour rides on it.
- **Foldering nit:** `components/site/CommentLayer.vue` is admin-only but lives
  in `site/` (pure move + import updates); `lib/roles.ts` type-imports `Role`
  from a composable — move the type to `src/types/editor.ts`.

## Product gaps from the CHSFD parity plan (rest of it shipped 2026-09-13)

Everything in that plan shipped except these three. They are design work, not
patches; each was scoped in the plan and the scoping is reproduced here.

- **P1 — SHIPPED 2026-09-15.** Client refs are in the DSL: `:div#hero:` parses
  into a code-owned `node.ref`, `reconcile` adopts by ref before falling back
  to the line diff, `validateDocument` enforces uniqueness plus the `:body` and
  component-block rules, and MCP addresses by `ref` / `setRef` / `targetRef`
  with `get_page {elements:"refs"}` listing them. Deliberately cut, as small
  follow-ups rather than blockers:
  - ~~ref autocomplete~~ and ~~no ref UI~~ — both moot since the code editor was
    removed: a human names a ref by renaming a row in the Layers tree
    (`LayerRow` → `setElementRef`), and nothing types refs any more.
  - **move + rename in one edit still mints a new node.** The ref pre-pass
    needs the ref to be unchanged to match, and the same-line fallback needs
    the line to be unchanged; an edit doing both defeats each. Rare, and the
    node's state is lost rather than misassigned, so it is safe — just not
    free.
- **P2 — form submissions.** The form *elements* shipped; there is no backend.
  Sketch: `node.form?: { mode: 'store'|'email'|'both'; to?; subject?; redirect?;
  collectionId? }` on `:form`; the export emits
  `<form method="post" action="/api/forms/<pageId>/<nodeId>">` + honeypot + a
  per-site submission token, with a progressive-enhancement handler in
  `site-runtime.js` that posts via `fetch` and swaps in a success state through
  an interaction stateKey. `server/forms.mjs` would be **the most exposed
  endpoint in the product** (unauthenticated), so: origin check, per-IP rate
  limit (reuse the auth limiter), body cap, honeypot, and a field allowlist
  derived from the *stored* project's declared inputs — never from posted
  names. Append to `server/data/forms/<pageId>-<nodeId>.jsonl`. Email goes
  through `settings.integrations.mailing` with the provider key held
  server-side in `publish.json` (same pattern as the GitHub token) — do not add
  nodemailer. Admin gets a Submissions panel (list + CSV), admin/editor only;
  MCP gets a read-only `list_form_submissions`. **`/security-review` is
  mandatory before shipping this one.** File upload (multipart) and Stripe
  Checkout are follow-ups in the same module, not blockers.
- ~~**P3 — page transitions and smooth scroll.**~~ **Shipped**, as one
  `settings.motion` key (not the two the plan named) carrying `appearMode`,
  `transitions` and `scroll`; Settings → Interactions plus a summary section in
  the Interactions side panel. Residue: the `scrolled` interaction trigger
  still reads `window.scrollY` (`useRenderNode.ts`), so it is inert on the
  Preview surface, whose scroll container is not the window — a one-line fix
  (listen on the site scroll container) worth doing next time that file is
  open. Also unbuilt: a Preview story for `position: sticky` under the lerp
  scroller, which the original plan flagged.
- **Sliders — SHIPPED.** `:slider` is a first-class container (arg = repeat per
  entry like `:collection-list`, no arg = one slide per child), configured in
  the Data panel through node-owned `node.slider`, with `src/lib/shared/slider.js`
  as the one engine for both renderers, the exporter and the published
  `/assets/slider.js`. Deliberate v1 cuts, none of them blockers:
  - **arrows and dots are built-in chrome, not DSL elements** — position and
    colour are fixed (the host's `relative` plus the constants in `slider.js`).
    Arrows-outside-the-track layouts and custom dot markup need either real
    `:slider-arrow` tokens or a `chrome` style hook.
  - **contributors can't edit slider config.** `server/contributor-merge.mjs`
    overlays only the content allowlist, so `node.slider` written by a build
    role survives a contributor's autosave but a contributor's own change to it
    is silently dropped. Deliberate (it is structure, not content); if a
    contributor ever needs to flip autoplay, it needs an explicit overlay line.
  - **no vertical sliders, no per-slide alignment, no free-scroll mode.**
  - **the runtime measures perView from the DOM** rather than shipping the
    breakpoint table, which assumes uniform slide widths. True by construction
    today; a future per-slide width feature would break it.
  - **a bound `:slider[post]` shows no `[+]` marker.** The data marker lives in
    the `[…]` slot, which the arg owns — same rule as everywhere else, and the
    editor and MCP agree, so nothing drifts. It just means the sliders most
    likely to be configured are the ones whose code line doesn't advertise it.
  - **extracting a configured slider into a component** leaves the original
    instance configured and gives every other instance defaults, because
    `node.slider` is per-instance state that `adoptStructure` doesn't copy.
    Parity with `listQuery`/`entryId`, but more surprising here since the whole
    carousel behaviour lives in that field.
  - **`sliderHostExtraClass` only looks for bare positioning tokens**, so a host
    styled `max-[390px]:absolute` still gets `relative` appended and the winner
    below 390px comes down to stylesheet order.
- **P4 — marquee ergonomics.** `pauseOn: 'hover'` on an `AnimationBinding`
  (runtime pauses the timeline while the trigger is hovered) covers the common
  case. Drag + inertia would be a new `'drag'` trigger on the animation
  runtime — lowest value on the whole list; do it last or not at all.

Inline SVG / `currentColor` icons was the fifth item; it is tracked as **M6**
below. The plan's extra detail: a new `icon` element whose `content` holds an
inline SVG sanitized by a shared `src/lib/shared/svg.js` (lift the existing
`sanitizeSvg` out of `server/media.mjs` so both surfaces use one
implementation), rendered as raw inner HTML with `fill`/`stroke` forced to
`currentColor`, plus an `svg` field on `edit_elements` and a "use inline"
action on media-library SVGs.

## Launch (pre-publish)

- **License — DECIDED 2026-09-15: AGPL-3.0-only, with an MIT carve-out for the
  exported-site runtimes** (`site-runtime.js`, `motion-runtime.js` and their
  sources) so no copyleft question can attach to a published site. Shipped:
  `LICENSE` (AGPL text) + `LICENSE-EXCEPTIONS.md` at the repo root and copied
  into both packages, `"license": "AGPL-3.0-only"` in all three package.jsons,
  SPDX headers on the MIT files, README licensing section. Rationale: sole
  copyright holder keeps the dual-license/hosted-service option open; MIT
  would give it away, Elastic 2.0 costs the "open source" claim. No longer a
  blocker.
- **Publish order matters:** `packages/guano` first (`create-guano` depends on
  it existing in the registry), then `packages/create-guano`. `prepack` builds
  and stages automatically.
- **Day-of checklist:** npm names `guano` / `create-guano` still free; license
  + three `package.json` fields set; `git pull` clean and
  `rm -rf dist && npm run build && npm run test:e2e` green; fresh-machine test
  (`npm create guano test && cd test && npm i && npm run dev`); publish in
  order; `git tag v0.1.0 && git push --tags`; README badges (npm version, node
  engines) + fix the create-guano npm links; smoke the *published* packages,
  not the local tarball; point the repo description/homepage at the product,
  not "builder"; announce and watch npm + issues for 48h.

## Tooling

- **C6 — `pickingFor` holds the binding OBJECT, not its address.**
  `useInteraction.ts` keeps `pickingFor` as the binding itself so it resolves
  even for bindings on component masters outside the page tree. But undo,
  a branch switch and a merge replace the whole `project` ref with a deep
  clone, so a pick started before a ⌘Z points at a detached binding and
  `pickTarget` writes `targetId` into an object nothing renders — silently. The
  right shape is `{nodeId, bindingId}` resolved at pick time, but it touches
  `ElementRenderer`, both editors and four `pickingFor === binding` identity
  comparisons, so it wants its own pass. Low frequency (pick, then undo,
  then click) and no data loss, just a no-op pick.
- **C7 — `npm run test:e2e` silently requires a prior `npm run build`** (the e2e
  server serves `dist/`). Now stated in CLAUDE.md's Commands section; a real
  pre-step (or a `pretest:e2e` script) would still be better than a note.

## Layers / structure

- **The e2e fixture has unclosed `:div` blocks and leaf-form `:list-item:` lines**
  (`e2e/fixtures/project.json`, Home page), so `validateDocument` reports diagnostics on
  it. The parser is lenient, so it renders, but each unclosed div swallows the siblings
  that follow it. It is test data only now (the `?demo` URL and its generator were
  removed), so this costs nothing in the product — but fixing it changes the fixture's
  structure, so check the UI specs that assert on its content.

- **The element clipboard does not cross between a page and a component.** ⌘C on the
  board and ⌘V on a page (or the reverse) does nothing: the page clipboard is dedented
  code plus per-node props, and a master has no code. Either side alone works.
- **Deleting or retyping a node in a component master drops any per-instance content on
  that node.** The push maps instance lines by `alignInstanceLines`, which cannot match a
  line that no longer exists or whose type changed. Undo restores it.
- **Multi-selection is still one contiguous run of siblings** (`selectedElementIds`), so
  the tree offers no ctrl-click across branches.
- **`parentIndex` (`useRenderNode`) and `targetIndex` (`useInteraction`) remain
  active-page only**, so they are wrong for a node rendered on the components board.

## Components library

- **Two components can end up sharing a name after a merge.** Main and a draft
  each adding the same library entry creates two `ComponentDef`s with the same
  `name` under different ids; `computeMerge` is id-keyed, so both survive and
  `findComponent` (name lookup) takes the first. Every `:Name` instance then
  resolves to whichever that is. The hazard predates the library — any two
  hand-made components could collide — but copying catalog entries makes it
  likely rather than theoretical. Fix would be a post-merge name de-duplication
  pass that renames the losing side and rewrites its instances
  (`renameComponent` in `src/lib/componentOps.ts` already does the rewrite).
- **Deleting a component leaves its interactions and design tokens behind.**
  Deliberate: both are shared libraries and the detached elements still use
  them. But nothing ever garbage-collects an effect no binding references.
- **Tabs is wired for exactly three tabs.** Its default-panel state is expressed
  as "tab 1 is the off position of every effect", so a fourth tab means adding
  its bindings by hand. A real variant/state system would be the answer; a
  class-toggle model cannot express "one of N" without O(N) bindings.

## MCP (v1 limits)

The `guano mcp` server (`packages/guano/mcp/`) shipped Phases 0–8. Known, deliberately-deferred limits:

- **M1 — no in-server HTTP transport.** v1 is a stdio CLI (`guano mcp`) that
  talks to a running instance over the HTTP API. A streamable-HTTP `/mcp`
  endpoint on the node server is out of scope (would let remote agents connect
  without a local process).
- **M2 — no optimistic locking on the store.** Writes are latest-wins. Page and
  element tools take a `version` hash (sha256 of the page code) that guards
  line-based edits against a stale read, but collection/comment/interaction
  writes are id-keyed and unguarded — a concurrent human edit to the same item
  can still be clobbered. Drafts are the mitigation (the human picks the target).
- **M3 — no zip/github publish over MCP.** `publish` only runs the `server`
  export method; zip/github stay editor-only.
- **M4 — comments are read/written on the target blob.** They're shared across
  drafts and never merged, so a reply added to a draft isn't visible on Main
  until the human is on that target. No `create_comment` tool (reply only).
- **M5 — RESOLVED.** Component masters *are* editable over MCP: `edit_elements`
  redirects class and interaction edits on an instance element to the mapped
  master, `onMaster: true` writes shared content/src, `update_component` replaces
  the structure, and `list_components {includeNodes: true}` +
  `get_page {elements: "all"}` (`masterClasses`) read the shared state back.
- **M6 — no inline SVG element.** An uploaded SVG can be an `:image:` `src`, but
  it renders as an `<img>`, so it cannot inherit `currentColor` / follow a design
  token. A real `:svg:` leaf needs a strict sanitizer (allowlisted shape
  elements + presentation attributes, no script/handlers/foreignObject/external
  href) with its own security tests before it can ship.
- **M7 — no truly empty leaf.** `content: ""` clears back to the element's
  placeholder, so a text leaf can't render empty; build decorative rules and
  spacers from styled `:div` containers instead.
- **M9 — interactions are class-swap only.** Hover/click/appear toggling Tailwind
  classes. No timeline or scroll-driven animation (scroll smoothing, per-character
  text reveals, clip-path wipes, marquees, route transitions), and no tool for
  breakpoints, domain/smtp/publishing config, per-page script injection, media
  folder management, asset rename/delete, collection rename, or creating comment
  threads.

Stress run #2 ("field-notes", 2026-09-13) — deferred items. Fixed in the same
pass (not listed here): dead cross-instance binds refused, `entryId` exposed for
`:collection-item`, rich-text hrefs locale-prefixed on export, entity
double-escaping, breakpoint gate reading `innerWidth`, bare template routes
exported, silent `delete_collection` dangling refs, outline/ring/accent/sr-only
validator families, worklist draft/locale-label flags, `opsApplied` counter,
full `list_components {includeNodes}` state.

- **M10 — `htmlId` is not reproduced per component instance (run #2 B5).** Only
  the source instance keeps its element `id`s, so `label[for]`, anchors and
  aria wiring inside a shared block work on one page only. Copying the master's
  id to every instance would emit duplicate ids when a page holds two instances
  of one component — a proper fix needs a per-instance id scheme (e.g.
  `<htmlId>-<instance>` with matching rewrite of `for`/`href="#…"` inside the
  same instance). Documented as a limit in the guide meanwhile.
- **M11 — no warning when a binding's breakpoint scope is narrower than the CSS
  showing its trigger (run #2 F4).** A `md:hidden` hamburger scoped to Mobile
  (≤390 px) is visible but dead from 391–767 px. Cross-checking a binding's
  breakpoints against the trigger's responsive classes is expressible (both are
  known at bind time); documented in the guide meanwhile.
- **M12 — set_page_code regenerates instance node ids when re-expanding
  unchanged one-line component references (run #2 F6).** Captured ids survive
  node-state carry, but an id-addressed follow-up batch written before the call
  goes stale. The expansion could adopt the existing instance subtree when the
  reference is unchanged.
- **M13 — RESOLVED (2026-09-15).** A fresh install IS drivable headless: the
  server seeds `guano-project:main` at `POST /api/auth/setup` (with the project
  name from the form) and, for pre-existing installs, lazily on the first
  agent-token store request — both through `ensureProjectSeeded` in
  `server/index.mjs`, which builds the document with `createProject` out of the
  MCP runtime bundle. The lazy branch is agent-only on purpose: an
  unconditional one would fire during the browser's boot hydration and suppress
  the one-time setup-name rename.
- **M14 — no draft→Main merge over MCP (run #2 F10).** Applying a draft needs a
  human in the editor's Drafts panel. Deliberate for now (merge review is the
  human checkpoint), but a `merge_draft` tool that refuses on conflicts (or
  takes an explicit per-conflict resolution) would close the last headless gap.
- **M15 — client tools/list can lag the running server (run #2 F1).** The
  stress agent's client showed schemas missing params the server accepted
  (get_guide.section, itemsPath, updateFields, scrub.smooth) after a restart —
  a stale installed `guano` package or host-side schema cache. The guide header
  hash (`get_guide` vs `get_status`) is the current staleness tell.

Stress run #3 ("tide-tables", 2026-09-13) — deferred items. Fixed in the same
pass (not listed here): breakpoint-scoped entrances no longer baked invisible,
stagger tail counted by both runtimes (cascades finish), scrub truly inert
under ?noanim/reduced-motion, localize:false fields render base-only with
translation writes refused and flip warnings, attributes master-routed on
component instances, stray src on bound list wrappers, get_page diagnostics +
SEO readback, set_page_seo itemsPath, full binding options in
includeInteractions, forcePurge purge counts + dead-switcher-link warnings,
divide-* validator family, childless containers keep block form in
serialization (the textarea orphan), master-id targetId gets a real error.

- **M16 — :collection-item embeds the template's full chrome (run #3 MED).**
  It renders the template BODY verbatim, shared components included, so a
  template with SiteNav/SiteFooter ships a duplicate header/footer and
  duplicate html ids inside the host page. Documented in the guide (use
  listQuery.pick for slots); a real fix wants a "fragment" notion — either
  skip top-level component instances when embedding, or a per-collection
  "embed root" marker. Needs design: skipping components silently would break
  templates whose card IS a component.
- **M17 — 404 pages are default-locale only (run #3 LOW).** One root
  404.html (lang=en) serves every locale. Fix wants a per-locale
  `<code>/404.html` in the export plus handleStatic picking by path prefix.
- **M18 — attributes are not localizable (run #3 friction).** placeholder,
  aria-label, alt (and SEO-adjacent strings inside attributes) ship
  untranslated and never appear in the worklist. Needs a per-locale
  attributes bucket (node.locales[code].attributes?) plus worklist rows —
  a localization-model change, not a patch.
- **M20 — `looksStructural` misses glyph-and-number rulers (run #3).** "00h ──
  03h ──" reads as prose to the heuristic (has letters+digits). A
  mostly-non-letter ratio check could catch it; low stakes, watch for false
  positives on short CJK strings before adding.
- **M21 — `@item` link wrap (`<a class="contents">`) cannot show a focus ring
  (run #3 friction).** display:contents boxes don't paint outlines. The run's
  workaround (focus-within: styling on the card) works; a real fix could move
  the focus style to the wrapper's child automatically or document the
  focus-within pattern in the styling section.

Regression run #4 ("tide-tables revisited", 2026-09-14) — all 8 items PASS; the
run #3 fixes hold against their exact failure signatures. Follow-ups applied in
the same pass: symmetric warning when localize flips back to true (restored
override count), list_components description matches its real payload, guide
warns that aria-label overrides translated content in every locale.

- **M15 (updated) — CONFIRMED: Claude Desktop caches tools/list across MCP
  process restarts.** Run #4's client showed pre-fix schemas while a direct
  stdio handshake against the same server returned the new ones, and the fresh
  handbook hash came through (get_guide is a live call; the schema list is
  cached). Remedy: fully quit + relaunch Claude Desktop (or toggle the server
  in settings) after changing tool schemas. The get_guide/get_status version
  header remains the staleness tell.
- **M22 — stored page code is not migrated to the container-form serialization.**
  Pages holding a pre-fix instance block keep the leaf-form `:textarea:` (and a
  get_page diagnostic) until they are resent through set_page_code, which heals
  them with zero orphans. Acceptable as-is since the diagnostic is visible;
  a lazy migrate-on-read would remove the manual step.

Stress run #5 ("guano.dev", 2026-09-13) — full product-site build, shipped on
the draft. Fixed in the same pass: `prose` accepted by the validator (its CSS
always shipped), `seo.ogImage` exposed in update_settings (exporter already
rendered it), `attributes.translate: "no"` excludes subtrees from the
translation worklist (and reaches the HTML), per-page :body styling documented
prominently, set_page_seo echoes only the bucket it wrote + titleTemplate-is-
not-applied-to-overrides documented, rich-text sanitizer's real tag list
(block tags included) documented, 0-based diagnostics documented.

- **M23 — no field-driven styling (run #5 B4).** A collection text field
  ("accent": lilac/ember/…) cannot select a class on the elements that render
  the entry, so per-entry accent colors need an image-field workaround (SVG
  dots). A `class:<field>` binding or a per-entry class token field needs
  design: validation (which classes may a field emit?) and export/editor
  parity. Worth pairing with a "badge" pattern in the guide.
- **M24 — elements:"refs" is per-node, not compressed (run #5 friction).** On
  a 190-node page it still returns ~190 rows; that is its contract (addresses
  for every node), but a range/tree-compressed form could cut the payload.

Mini-pass #6 ("guano.dev polish", 2026-09-14) — translate="no", ogImage and
prose all worked first try; the human merged run #5's draft to Main in the
editor (the first real merge). Fixed in the same pass: signed rotate/translate
now conflict with their unsigned base (the chevron-rotation bug), fonts.family
rebinds --font-sans so the font-sans class keeps the project font, the
interaction transition setup evicts the element's own transition classes
instead of duplicating (both renderers), update_settings gained `domain`
(absolute og:image/canonical + publish warning when ogImage is relative),
get_page accepts elements:"refs"/"none", delete_interaction/delete_animation
scope their marker sync to nodes that actually lost a binding (a project-wide
sweep silently advanced versions of untouched pages) and report changed-page
versions, prose documented as a neutral base to layer accents on.

- **M25 — a merged-and-deleted draft leaves no trace for the next session
  (run #6 pre-flight).** set_target with the old id fails with "no draft";
  get_status could record "merged into Main at <time>" per removed draft.
  Needs the editor's merge flow to write a small tombstone the MCP can read.
