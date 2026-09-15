# PLAN — Close the contributor authorization gap (server-authoritative content merge + S4 read redaction)

## Context / decisions

Today the only server-side protection on a contributor's project write
(`contributorProjectRejection` in `server/index.mjs`) checks that a handful of
**sensitive** fields (customCode, smtp, integrations, per-page customCode) are
unchanged. Everything else — page `code`, element structure, components,
collection schema, `settings`, tokens, interactions, animations, locales — is
UI-locked only. A contributor with a hand-crafted `PUT /api/store/guano-project:*`
(or `POST /api/published`) can rewrite all of it. Confirmed by pentest.

**Decisions (from the user):**

1. **Enforcement = server-authoritative merge.** On a contributor project write,
   the server keeps *all structure* from the stored blob and copies in only a
   whitelist of *content* fields from the incoming blob. Structural edits are
   **silently ignored, not rejected** (a legit autosave never loses work; a
   crafted blob simply has its structural parts dropped).
2. **CMS entries = full CRUD.** Contributors may create / edit / delete entries
   within existing collections. Collection *schema* (fields, template, name,
   routeBase, detailRoutes) stays locked.
3. **Contributor-editable content =** text (`node.content`), media (`node.src`),
   translations (`node.locales`, `entry.locales`), comments (`project.comments`),
   per-page/entry SEO (`page.seo`, `entry.seo`) and publish status
   (`page.status`, `entry.status`). **Global `settings.seo` stays locked** — the
   SEO answer meant per-page/entry overrides only.
4. **Include S4 read redaction.** `GET /api/store` currently returns the full
   blob to any role, leaking `settings.smtp` / `settings.integrations` secrets to
   contributors. Redact them on read for contributors. This is now *safe* to do
   precisely because of decision 1: writes ignore incoming `settings`, so a
   redacted round-trip can never blank the real secrets.

**Non-goals:** no change to admin/editor behavior; no change to the DELETE rules
(contributors already limited to their own drafts + `guano-base:*`); no new UI.

## The content allowlist (exact)

For a contributor write, the merged blob is **stored** with only these overlaid
from **incoming**:

| Scope | Field | Rule |
|---|---|---|
| element node (matched by `id`) | `content`, `src`, `locales` | copy from incoming |
| page (matched by `id`) | `seo`, `status`, `updatedAt`, `updatedBy` | copy from incoming |
| collection (matched by `id`) | `entries` | replace wholesale from incoming (full CRUD), sanitized |
| project | `comments` | replace wholesale from incoming |

Everything else comes from **stored**, including: page `code` / `name` / `path` /
`collectionId` / `customCode`; all other node fields (`type`, `classes`,
`interactions`, `animations`, `attributes`, `htmlId`, `background`, `link`,
`arg`, `entryId`, `listQuery`, `children`, line ranges); `components`;
collection schema; `interactions`; `animations`; `breakpoints`; `locales` /
`defaultLocale`; **all of `settings`**; `id`; `name`.

Notes:
- **`node.background` is treated as structural** (a visual/layout choice, "node-only
  state like classes" per the type doc) — kept from stored. If product later wants
  contributors to swap background media, add it to the node overlay list; it's a
  one-line change.
- The **page set and order** come from stored → contributors cannot add, delete,
  or reorder pages. Same for the **collection set** → cannot add/remove collections,
  only entries within them.
- Entry overlay keeps entry identity flexible (full CRUD) but the collection it
  lives in must already exist in stored.

## Step 1 — New module `server/contributor-merge.mjs`

Pure, dependency-light, no throwing. Reuses the shared sanitizers the exporter
already imports as `.js` (safe from the server; do **not** import `src/lib/tree.ts`
— it's TypeScript and the server only imports compiled `.js` from
`src/lib/shared/`; write a tiny inline walker instead).

```js
import { isRich, sanitizeRich } from '../src/lib/shared/richtext.js'
import { SAFE_SRC } from '../src/lib/shared/urls.js'

// recursive id->node index over `.children`
function indexNodes(nodes, out = new Map()) {
  if (!Array.isArray(nodes)) return out
  for (const n of nodes) {
    if (n && typeof n.id === 'string') out.set(n.id, n)
    indexNodes(n?.children, out)
  }
  return out
}

// sanitize a contributor-supplied content string (defense-in-depth; the
// exporter also sanitizes at render, but the canvas/preview may v-html)
const cleanContent = (v) =>
  typeof v !== 'string' ? undefined : (isRich(v) ? sanitizeRich(v) : v)
const cleanSrc = (v) => (typeof v === 'string' && SAFE_SRC.test(v) ? v : undefined)

// overlay allowed fields from incoming node onto a CLONE of the stored node,
// recursing children by matching stored structure (never incoming structure)
function overlayNode(storedNode, incomingById) {
  const inc = incomingById.get(storedNode.id)
  const out = { ...storedNode }
  if (inc) {
    const c = cleanContent(inc.content); if (c !== undefined) out.content = c
    const s = cleanSrc(inc.src);         if (s !== undefined) out.src = s
    if (inc.locales && typeof inc.locales === 'object') {
      out.locales = sanitizeLocales(inc.locales) // {code:{content?,src?}}
    }
  }
  out.children = Array.isArray(storedNode.children)
    ? storedNode.children.map((ch) => overlayNode(ch, incomingById))
    : storedNode.children
  return out
}
```

Exported entry point:

```js
/**
 * @returns {{ ok: true, merged: string } | { error: string }}
 * storedStr: the current blob for this key (or null for a new draft)
 * mainStr:   guano-project:main blob (fallback baseline for a new draft)
 * incomingStr: the contributor's raw PUT/publish body
 */
export function mergeContributorProject(storedStr, mainStr, incomingStr) { ... }
```

Logic:
1. Parse `incoming`; on failure `return { error: 'invalid project snapshot' }`.
2. Baseline = parse(`storedStr`) ?? parse(`mainStr`). If neither parses →
   `return { error: 'contributors cannot create a project' }` (mirrors current
   fail-closed behavior when Main is gone).
3. Deep-clone baseline as `merged` (it is the source of truth for structure).
4. **Pages:** for each `merged.pages[i]`, build `indexNodes(incoming page (matched
   by id) .elements)`; overlay each node; then overlay page-level `seo`, `status`,
   `updatedAt`, `updatedBy` from the matched incoming page. Pages with no incoming
   match are left untouched. Ignore incoming pages with no stored match.
5. **Collections:** for each `merged.collections[i]`, if incoming has a collection
   with the same `id`, replace `.entries` with `sanitizeEntries(incoming.entries)`;
   keep all schema fields from stored.
6. **Comments:** `merged.comments = sanitizeComments(incoming.comments)` (or keep
   stored if incoming isn't an array).
7. `return { ok: true, merged: JSON.stringify(merged) }`.

Helpers to write (all guard types, never throw):
- `sanitizeLocales(obj)` → keep only `{ [code]: { content?: cleanContent, src?: cleanSrc } }`, drop empty.
- `sanitizeEntries(arr)` → array of `{ id, name, slug, values, locales?, status?, seo?, createdAt, updatedAt?, createdBy?, updatedBy? }` with string/`string[]` values coerced/dropped as appropriate; rich values run through `cleanContent`. Reject non-objects.
- `sanitizeComments(arr)` → pass through the existing comment shape (id, anchor, body, replies, resolved, author, ts); coerce text fields to strings. Comments are already low-risk (rendered as text), but strip anything non-serializable.

Keep the module free of Node built-ins so it can be exercised with the
`.tmp-test.ts` harness from CLAUDE.md.

## Step 2 — Wire into `handleStore` PUT (`server/index.mjs`)

Replace the contributor branch inside the `PUT` block:

```js
if (req.method === 'PUT') {
  const body = await readBody(req)
  if (body === null) return fail(res, 400, 'too large')
  let toWrite = body
  if (user.role === 'contributor' && isProjectKey(key)) {
    const stored = await readFileOrNull(storeFile(key))
    const main   = await readFileOrNull(storeFile('guano-project:main'))
    const r = mergeContributorProject(stored, main, body)
    if (r.error) return fail(res, 403, r.error)
    toWrite = r.merged            // persist the MERGED blob, not the raw body
  }
  await writeAtomic(storeFile(key), toWrite)
  ...broadcastStoreEvent...
  return send(res, 200, JSON.stringify({ ok: true }))
}
```

- Add a small `readFileOrNull(path)` helper (try/catch → null), or inline.
- **Delete** the now-unused `contributorProjectRejection` + `sensitiveProjectFields`
  + `stableStringify` **only if** nothing else references them. `handlePost`
  currently calls `contributorProjectRejection` too — see Step 3; after that both
  callers are gone, so remove all three. (Grep first.)

## Step 3 — Wire into `handlePost` (publish) (`server/index.mjs`)

A contributor publish must ship the *merged* snapshot, not their raw body, or
they can push structural changes straight to the live site bypassing the store.

In `handlePost`, after `parsed` is validated, replace the contributor
`contributorProjectRejection` block with:

```js
if (user?.role === 'contributor') {
  const stored = await readFileOrNull(storeFile('guano-project:main'))
  const r = mergeContributorProject(stored, stored, raw)
  if (r.error) return fail(res, 403, r.error)
  raw = r.merged
  parsed = JSON.parse(raw)   // re-parse so export uses the merged tree
}
```

(Publish baseline is always `guano-project:main` for both args — a contributor
publishes the live site, not a draft.) Everything downstream
(`writeAtomic(SNAPSHOT, raw)`, `exportSite(parsed, ...)`, github config read) then
operates on the merged blob. `raw`/`parsed` are currently `const` in that
function — change to `let`.

## Step 4 — S4 read redaction in `handleStore` GET (`server/index.mjs`)

In the `GET /api/store` batch loop, for a contributor strip secrets from each
project-key blob before returning:

```js
for (const key of keys) {
  let val = await readFileOrNull(storeFile(key))
  if (val && user.role === 'contributor' && isProjectKey(key)) {
    val = redactSecretsForContributor(val)  // returns a string
  }
  out[key] = val
}
```

`redactSecretsForContributor(str)`: parse; if `settings` present, set
`settings.smtp = null` and `settings.integrations = null`; re-stringify. On parse
failure return the original string (it's the contributor's own draft; no secret
is exposed that Main didn't already gate). Put this helper in
`contributor-merge.mjs` (same content-boundary concern) and import it.

- Scope redaction to **`smtp` + `integrations`** (the actual secrets). `customCode`
  is *public output* (it ships in the exported site) and is already write-locked,
  so redacting it on read adds nothing — leave it. Confirm with a grep of what the
  Preview/contributor client reads from `settings`; if it needs `integrations`
  *shape* (not keys) to render, redact only the secret leaf fields instead of
  nulling the whole object. Given contributors are Preview-only and don't render
  settings UI, nulling is expected to be safe — verify by loading Preview as a
  contributor after the change (Step 6).

## Step 5 — Leave DELETE as-is (verify only)

The existing contributor DELETE rules (own drafts + `guano-base:*` only, never
`guano-project:main` or arbitrary keys) are correct and unaffected. No change.

**Secondary note (low risk, optional):** a contributor can PUT arbitrary content
to `guano-base:<id>` keys (not a `guano-project:` key, so unguarded). The only use
of a base snapshot is 3-way merge conflict detection, which defaults to Main's
side, and — with server-authoritative merge now in place — a draft can only ever
land *content* into Main regardless of a poisoned base. So this cannot escalate
to structural change. Leave it, or optionally apply the same merge guard to
`guano-base:*`. Document the choice; don't silently expand scope.

## Step 6 — Verification

Automated (pure-logic, per CLAUDE.md `.tmp-test.ts` harness):
- `mergeContributorProject`: structural incoming edit (renamed page code, added
  page, changed component master, swapped `settings.smtp`, added interaction) →
  merged equals stored for all those fields.
- Allowed edits round-trip: changed `node.content` / `node.src` / `node.locales`,
  new `entry`, deleted `entry`, edited `comment`, `page.seo` / `page.status` →
  all present in merged.
- Malformed incoming (missing arrays, wrong types, `null`) → no throw, structure
  preserved.
- `src` with `javascript:` → dropped; rich `content` with `<script>` → stripped
  by `sanitizeRich`.
- New-draft path (stored=null) uses Main as baseline; both null → error.
- `redactSecretsForContributor` nulls smtp/integrations, leaves the rest.

Live re-run of the pentest **as a logged-in contributor** (get a contributor
session cookie, then):
- `PUT /api/store/guano-project:main` with a structurally-mutated blob → 200, but
  re-GET shows structure unchanged, only content applied.
- `POST /api/published` with structural mutation → exported site unchanged
  structurally.
- `GET /api/store?keys=guano-project:main` → smtp/integrations null.
- Legit content edit via Preview UI still saves and publishes correctly (no
  regression, no lost work).

Also run `npm run type-check` (the only static gate) — the new module is `.mjs`
so it's outside vue-tsc, but the `src/lib/shared` imports must resolve.

## Files touched

- **new** `server/contributor-merge.mjs` — merge + redact + sanitizers.
- `server/index.mjs` — `handleStore` PUT + GET, `handlePost`; remove dead
  `contributorProjectRejection` / `sensitiveProjectFields` / `stableStringify`
  (after grep-confirming no other refs); add `readFileOrNull` helper.
- `BACKLOG.md` — mark S4 done; note the write-boundary is now server-enforced
  (update the "UI-enforced only" caveat) and the `guano-base` decision.
- `CLAUDE.md` — update the users/auth paragraph: the contributor structural
  restriction is **no longer UI-only** — server-authoritative content merge on
  project writes + publish, and secret redaction on read.

## Rollback / safety

Merge-on-write is transparent to admin/editor (guarded by
`user.role === 'contributor'`). If the merge helper has a bug that drops a legit
content field, a contributor loses that *content* edit (recoverable — re-edit),
never structure, and never another role's work. The change is confined to the
contributor branch of three handlers plus one new pure module.
