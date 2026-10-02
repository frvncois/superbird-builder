# Session notes — 2026-10-02

Notes from today's planning conversation, so it can be resumed later. No code was changed.
Two plan files were written, both **uncommitted** at the repo root:
- `FORMS-PLAN.md`
- `TREE-SOURCE-PLAN.md`

---

## 1. Client ask: forms and API keys on the published site

**Question:** do we have a backend for this, and what's the security situation?

**Findings (state of `main` @ `4247496`):**
- **The form elements exist** (`:form`, `:input`, `:textarea`, `:select`, `:checkbox`,
  `:radio`) and export as real HTML. But nothing receives a submission: the exported
  `<form>` has no `action`. `action` and `method` aren't in the attribute allowlist
  (`src/lib/shared/attributes.js:9`), so the exporter fully owns them.
- **A secrets vault exists.** `GET/PUT /api/integrations-config` (`server/index.mjs:1160`)
  stores the Stripe secret key, the mailing API key and the SMTP password in
  `server/data/publish.json`. Admins and editors write; reads return only `…Set: true`;
  the keys are never in the project blob or an export; contributors get them redacted.
  The design is good.
- **No server code reads those keys yet.** They are stored and never used.
- **The published site is purely static.** With the zip or GitHub publish methods there
  is no server at all.
- **The backlog already sketches this feature.** It's "P2 — form submissions"
  (`BACKLOG.md:181`), with "`/security-review` mandatory".

**Security points raised:**
- **Secret keys never ship to the browser.** Only publishable keys can go in the page.
  Custom code is the risk: an admin can paste a secret straight into a page script. One
  idea is a publish warning on key-looking strings (`sk_live_`, `Bearer`).
- **The form endpoint would be the only unauthenticated write in the product.** It needs
  rate limits, body caps, spam protection, a field allowlist taken from the published
  form, PII handling and no open relay.
- **Zip/GitHub-hosted sites would mean cross-origin posting.** v1 is therefore limited to
  the server publish method.
- **Third-party APIs follow the GitHub-token model.** The server holds the key and
  chooses the destination; it is never a generic proxy.
- **Agent policy should also cover form routing and submission reads.**

## 2. `FORMS-PLAN.md` — v1 implementation plan (written)

**v1 scope:**
- A `:form` on a server-published site posts to the instance.
- The server validates it against a manifest written at publish, stores it as JSONL,
  and emails a notification.
- Admins and editors view submissions and export CSV.
- MCP gets read-only access behind a policy switch.

**Out of scope:** uploads, Stripe, collection-backed storage, captcha, and zip/GitHub forms.

**Key decisions in it:**
1. **Email over SMTP**, with a small hand-rolled client and no nodemailer. The existing
   "mailing" integration is a newsletter provider and can't send transactional email.
2. **SMTP host, port, user and from move server-side.** This is a **security finding**:
   today the host sits in the project blob, which editors, drafts and agent tokens can
   write. Once the server sends mail, pointing the host at an attacker's machine would
   leak the password in the first `AUTH`. Fixed in Phase 0, before anything else.
3. **Notification recipients are server-side and admin-only**, never on the node. This
   stops lead exfiltration through a draft, a merge or an agent.
4. **Validation uses the publish manifest**, never the live project or the posted field
   names.
5. **`:form-success` and `:form-error` child elements**, following the `:list-empty`
   precedent.
6. **No "site token".** It would be a static constant and prove nothing. Spam protection
   is a honeypot, a minimum fill time, rate limits and the allowlist.

**Also found:**
- **Bug:** submitting a form in Play mode reloads the editor, because
  `PreviewRenderer.vue` has no submit handling.
- **`slidingLimiter` (`server/index.mjs:258`) never evicts keys.** That's unbounded
  growth under a public endpoint, so it must get a sweep.

**Size:** about 10 days over Phases 0–5. **Status:** sequenced AFTER the tree-source
work (section 3), and needs a small update then (`[+]` markers →
nothing, `validateDocument` → `validateTree`).

## 3. Is the DSL (`:div`, `:heading`, …) overkill?

**My first answer:** split the question.
- **The element vocabulary** (`shared/elements.js`, about 43 types) is cheap. Keep it.
- **The text DSL as source of truth** is the heavy part:
  - `reconcile` (an LCS line diff) exists only to keep node identity across a re-parse;
  - display markers and the marker-sync watcher;
  - two structure backends, page text versus master trees;
  - line-number addressing.

  Its only remaining value was a compact format for agents.

**The user's position:** fix it **before launch**. The DSL seems useless, and the MCP
gains nothing from agents learning a new syntax.

**Decision:** the tree becomes authoritative, `page.code` is deleted, and agents use a
**strict HTML subset**. The user chose this over "JSON tree + ops" and over "keep the
DSL for agents only".

## 4. `TREE-SOURCE-PLAN.md` — plan (written)

Built from two full inventories, one of the editor side and one of the MCP side.

**Facts that make it tractable:**
- `export.mjs` and `contributor-merge.mjs` never read `page.code`.
- `merge.ts` sees `code` only inside a page's `JSON.stringify`.
- Nothing in the browser parses text any more.
- The component-master backend (`componentOps.ts:410-759`) is already a complete
  tree-native structure backend, which pages can adopt.

**The format:**
- **Tags:** real HTML tags where possible. Behaviour elements keep their own names
  (`<collection-list source="post">`, `<slider>`, `<list-empty>`); components are
  PascalCase (`<Card>`).
- **Parser:** case-sensitive and hand-rolled, not parse5, which would lowercase `<Card>`.
- **Attributes:**
  - `class` ↔ `classes`
  - `data-ref` ↔ ref
  - `data-id` (8-hex id prefix): output only, honoured on input for adoption
  - `data-field` / `source` ↔ arg
  - `href` ↔ link
  - `data-bind-<attr>` ↔ fieldAttrs
  - `data-hidden` ↔ editor hide
  - `data-variant-<axis>` ↔ variants
  - inner HTML of a leaf → content, via `sanitizeRich`
- **Not in the HTML:** interactions, animations, locales, slider config, listQuery and
  form config. They stay with their dedicated tools.
- **Components:** an instance is read with its parts' content, and a filled `<Card>` is
  writable in one call. Classes or structure changes inside an instance are refused.
- **Adoption on write:** `data-id`, then `data-ref`, then a tree LCS (the existing
  `alignMirror` algorithm), otherwise a new node.
- **`version`:** a hash of the canonical HTML plus page meta. It changes only when what
  `get_page` shows changes. Markers are gone.
- **New tools:** `set_page_html`, plus `edit_structure` (batched
  insert/replace/move/remove/wrap). Line addressing is removed everywhere.

**Phases:**

| Phase | What | Days |
|---|---|---|
| 0 | Corpus snapshot (exported HTML must stay byte-identical) + node-id snapshot | 0.5 |
| 1 | Editor tree-native: one structure backend; delete the line ops in `useElement`; tree clipboard; delete the `syncStructure` watcher; push = tree realign; `validateTree`. `code` becomes a write-only mirror for MCP | 4–5 |
| 2 | `src/lib/html/` serialize / parse / apply + round-trip property test | 3 |
| 3 | MCP tools rewritten, GUIDE (−20–25 KB), `check:mcp` ≤ 65 KB, e2e conversion | 4–5 |
| 4 | Boot migration of every store blob, `guano-base:*` included (`schemaVersion: 2`, backup in `store.pre-v2/`); collapse aliases container/grid/heading/dropdown → div/h2/select; delete the DSL code | 2–3 |
| 5 | CLAUDE.md / README / BACKLOG / FORMS-PLAN updates + a real Claude Desktop dogfood session | 1–2 |

About 3 weeks in total.

**Open product question:** merging the `container`/`grid`/`heading`/`dropdown` aliases.
Should "Grid" and "Container" survive in the insert dock as presets (a div plus classes)?

**Small latent bug found:** `usePage` rename, meta edits and duplicate call
`buildDocument` without the body decor, which strips the `:body` line's markers until
the next node-state change. The migration retires it.

---

## Where to pick up

1. Review `TREE-SOURCE-PLAN.md`, especially the HTML format table and the alias merge.
   Answer the Grid/Container dock question.
2. Start at Phase 0 (the corpus script), on a branch, not `main`.
3. Once the tree-source work lands, update `FORMS-PLAN.md` per its Phase 5.2, then
   execute it. Run `/security-review` before merging its Phase 3.
4. Decide whether to commit the three markdown files: the two plans and these notes.

Pre-existing working-tree state at session start (not touched today):
- `COMPONENTS-PLAN.md` and `SESSION-FIXES-PLAN.md` are deleted.
- `package-lock.json` and `src/composables/useInlineEdit.ts` are modified.
- `src/composables/usePreviewEditing.ts` is untracked.
