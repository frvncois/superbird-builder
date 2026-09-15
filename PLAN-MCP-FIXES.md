# MCP stress-test fixes — SHIPPED

Source: the agent stress test that rebuilt a Vue/Strapi site through `guano mcp`
(headline: ~4 min authoring vs ~14 min working around the platform).
GSAP / interaction-richness was out of scope for this pass.

Everything in Phases 1–3 of the original plan is implemented, plus the large
Phase 2.4 item. Phase 4 items were deliberately not built — see *Not done*.

---

## What shipped

### P0 — trust and data loss

**`get_status` reports what Main holds** (`tools.mjs` `projectStats`). New
`main: {pages, publishedPages, elements, components, collections, entries,
locales}` and a computed `mainIsEmpty`, mirroring a freshly seeded project so it
survives a rename. The display name now prefers `settings.seo.siteName` over the
default "Untitled project", and a non-empty Main carries a `mainWarning`.

**`set_target` refuses a non-empty Main once.** Targeting `main` while it holds
content returns `{ok: false, reason: 'main-not-empty', main: {...}}` with the
counts, and requires `acknowledgeMain: true` to proceed — the `forcePurge`
pattern. The golden rule in `GUIDE.md` now keys off `mainIsEmpty`, never the
project name.

**`onMaster` + `src` (Bug 1) was a RENDERER gap, not a write bug.** The MCP
stored `src` on the master correctly; both renderers fell back to the master for
*content* but not for `src`. Fixed in `server/export.mjs` (`attrsFor`) and
`src/composables/useRenderNode.ts` (`srcInfo`), so a shared logo set once with
`onMaster` renders in every instance. `background` was already master-aware.
Regression-tested against a real export (verified the test fails without the fix).

**Upload rate limiting (L1).** `server/media.mjs`: the cap is now a named
`UPLOAD_LIMIT_PER_WINDOW = 120`/minute (was an unnamed 30 — actual disk use is
bounded by `QUOTA`, so the count limit only needs to stop a runaway loop), and
every 429 carries `retryAfterSeconds`. `ApiError` propagates it. `upload_media`
now **waits out the window and continues** mid-batch (bounded), and reports
partial success honestly: `saved: uploaded > 0`, `partial: true`, `requested`,
and a note telling the agent to retry only `failures[].index`.

### P1 — capability gaps

**Local file uploads (L2).** `upload_media` accepts a per-item absolute `path`
(read from disk — the MCP is a local stdio process with the user's own reach) and
a top-level `manifestPath` pointing at a local JSON array. `name` defaults to the
filename; mime is inferred from the extension and re-validated server-side by
magic bytes. This removes the ~80k-token cost of base64-ing a font through
context. Preference order documented as path → url → dataUrl.

**Master state is readable (Bugs 3 & 5).** `get_page` with `elements: "all"` now
emits the real `masterClasses` string (previously documented but never
implemented — only a boolean `styledOnMaster` existed). New
`includeInteractions: true` emits `interactions[]` / `masterInteractions[]` with
`bindingId`, making an inherited binding removable via `unbindInteractionIds`.
`list_components {includeNodes: true}` returns every master node's id, classes,
content, src and bindings for a whole-component audit in one call.

**Inherited styling is visible, and avoidable (Bug 4).** `set_page_code` now
reports `reconciled: {kept, keptWithState, keptBlank, created}` plus an
`inherited[]` list and a note. New `fresh: true` re-derives structure normally
but strips every node's classes/content/src/background/htmlId/attributes/
bindings/locales/listQuery and re-syncs the code markers — for replacing a page
with unrelated content.

**Repeatable media field (L3) — `multi-image`.** A collection field holding a
list of media urls. `:collection-list[<field>]` repeats once per image the entry
actually has (no more empty `<img>` for absent gallery slots); bound directly to
a single `:image` it renders the first url. Implemented via a synthetic list
scope in `src/lib/shared/fields.js` (`mediaListScope`), so it reuses the existing
list machinery and mints no routes. Wired through: types, `storage.ts`
normalization, both renderers, `export-media.mjs` extraction (all urls in the
array), the DSL validator's list-arg names, `CodeEditor` autocomplete, the MCP
(`update_collection` enum, `upsert_entry(ies)` array handling, `knownNames`), and
a DataEditor gallery UI (per-image picker, reorder, clear-to-remove).

### P2

**Class validator (L4).** `src/lib/styles.ts`: added `basis` to the spacing
prefix, a fraction form (`basis-1/2`, `w-2/3`, `-translate-x-1/2`), and size
keywords (`max-w-full`, `basis-auto`, `min-w-fit`, …). Added a `sizeFamily`
conflict group so the new forms replace rather than stack (`w-1/2` replaces
`w-full`; `max-w-*` stays independent of `w-*`, matched longest-prefix-first).

**`forcePurge` purges per-locale SEO (Bug 2).** The editor's
`useLocale.deleteLocale` had the *same* gap, so the fix is a shared
`src/lib/shared/locales.js` (`purgeLocaleSeo` / `countLocaleSeo`) used by both.
`countLocaleOverrides` now counts SEO, so the refusal message is honest.
Recovery for already-orphaned data: `update_settings {seo: {locales: {fr: null}}}`
deletes a code (the seo.locales merge is now per-code, not wholesale), and
`set_page_seo` permits a pure-clear write for an unregistered locale.

**Favicon (L8).** `ProjectSettings.favicon` already existed and the exporter
already emitted it — only the MCP didn't expose it. Added to `get_settings` and
`update_settings` (SAFE_SRC-validated, `""` clears).

---

## Not done (deliberate)

- **Inline SVG element (L5).** Needs a strict SVG sanitizer with its own security
  tests; a bad one is a stored-XSS vector. `GUIDE.md` now states the limitation
  and the `<img>` workaround explicitly, including the `currentColor` loss.
- **Truly empty leaf (L6).** Would need a content sentinel threaded through both
  renderers for a narrow case; the styled-`:div` workaround is documented.
- **`:link` as a container (L7).** A real parser/normalizer change. The
  `:div` + `@target` idiom works and is documented. Revisit if it recurs.

---

## Verification

No test runner is configured, so this was verified with throwaway scripts
(`.tmp-*`, since removed) per CLAUDE.md, all passing:

- **Full static export** of a fixture project — asserts the master `src` renders
  on every instance page, a 3-image entry emits exactly 3 `<img>` and a 1-image
  entry exactly 1, and no `<img>` lacks a `src`. Confirmed non-vacuous by
  reverting the export fix and watching it fail.
- **MCP toolset against an in-memory instance** — empty vs populated Main,
  the `set_target` refusal and acknowledgement, `keptWithState` / `inherited` /
  `fresh` (including marker cleanup), locale SEO purge and orphan recovery,
  favicon validation.
- **Round 2** — `multi-image` end to end (field, array + lone-value upsert,
  list-arg validation), `masterClasses` in both modes, `list_components`
  node audit, binding-id round trip, `basis-1/2` + `max-w-full`.
- **Uploads** — local path (name/mime inference, absolute/missing/unsupported
  refusals), manifest, rate-limit wait, partial-success shape.
- `vue-tsc --build` clean, `npm run build` clean, `node --check` on every
  touched `.mjs`, `npm run build:mcp-runtime` re-run and its exports verified.

`GUIDE.md` (served as the MCP `instructions`) was updated throughout: golden
rule 5, the workflow recipe, partial-batch semantics, the upload preference
order and rate limit, `get_page` master/binding reads, reconcile + `fresh`,
galleries, the validator vocabulary, favicon, locale purge, unbinding, and a
rewritten gaps section.
