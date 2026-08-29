# Media Library — Implementation Plan

Status: complete — M1–M7 implemented and verified (2026-08-22). Security posture documented in `security-media-and-origin.md`.
Decisions locked (2026-08-21): server-stored files, all media types (images/video/audio/documents/fonts), no legacy data-URL migration, global across branches, folders, entry points = AppHeader + image src picker + content mode, all roles full access, server thumbnails, delete warns with usage count, assets have rename / default alt / replace-in-place / details panel.

---

## 1. Core design

### Reference model

`node.src` (and collection entry image values) stop being base64 data URLs and become stable asset URLs:

```
/media/<assetId>            e.g. /media/a1b2c3d4e5f6
```

- **Extensionless and id-based** so **replace-in-place** keeps every reference valid even when the new file has a different extension/mime. The media route serves the bytes with the content-type from the index.
- The three renderers (`ElementRenderer`, `ContentRenderer`, `PublicRenderer`) already consume `srcAttr` as an opaque string — the read side needs no change except alt-text (§6).
- No changes to `ElementNode` persistence shape: `src?: string` (`src/types/editor.ts:35`) and per-locale `locales[code].src` keep working as-is, so `reconcile`, merge, and locale overrides are untouched.

### Storage layout (server)

```
server/data/media/
  index.json                  # the media index (assets + folders), atomic tmp+rename writes
  files/<assetId>             # original bytes, extensionless
  thumbs/<assetId>.webp       # generated thumbnails (images only)
```

- Created lazily with `mkdir(..., {recursive:true})` at write time, matching the existing pattern (`server/index.mjs:326,379`).
- **The index lives server-side, not in the KV store.** Uploads/deletes/replaces must mutate files and index atomically, and the server is the only party that can do that. This also makes the library global across branches for free — it is never inside `superbird-project:<branchId>`, never merged, never copied on branch switch (deliberately *not* the comments embed-and-copy pattern from `useBranches.ts:78`).

### Index schema (new `src/types/media.ts`, shared shape with server)

```ts
export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'font'

export interface MediaAsset {
  id: string            // 16-char hex, crypto.randomBytes (see Security)
  name: string          // display name, editable
  filename: string      // original upload filename (for downloads / details)
  mime: string
  kind: MediaKind       // derived from mime on upload
  size: number          // bytes
  width?: number        // images only (from sharp metadata)
  height?: number
  alt?: string          // default alt text, editable
  folderId?: string
  hasThumb: boolean
  createdAt: string     // ISO
  uploadedBy: string    // user id
}

export interface MediaFolder { id: string; name: string }   // flat, no nesting (v1)

export interface MediaIndex { assets: MediaAsset[]; folders: MediaFolder[] }
```

Types are client-authored in `src/types/media.ts`; the server (`.mjs`, plain JS) mirrors the shape without importing it — same convention as `src/lib/shared/` registries.

---

## 2. Server — new `server/media.mjs` + routing

### Routing (edit `server/index.mjs:432-447`)

Add two branches to the dispatch chain:

```js
if (path === '/api/media' || path.startsWith('/api/media/')) return handleMedia(req, res, path)
if (path.startsWith('/media/')) return handleMediaFile(req, res, path)   // BEFORE handleStatic fallback
```

`/media/*` must be dispatched before the `handleStatic` catch-all, otherwise it resolves against the published site dir (`server/index.mjs:415-429`). Serving order inside `handleMediaFile`: library file by id → fall through to `handleStatic` (so exported hashed files under `SITE/media/` still resolve for the published site).

### Body reading

`readBody` (`server/index.mjs:91-100`) is utf8-string with a 10 MB cap — unsuitable for uploads. Add `readBodyRaw(req, limit)` returning a `Buffer`, cap **200 MB** for `POST /api/media` (video), keep 10 MB everywhere else. Uploads are **raw binary** (no multipart, no base64 JSON): metadata rides in query params + `Content-Type` header. This avoids adding a multipart parser dependency.

### Endpoints (all in `handleMedia`, auth = `sessionUser(req)` or 401, per `server/auth.mjs:255-259`; **no role gate** — all roles decision)

| Method & path | Body | Response | Notes |
|---|---|---|---|
| `GET /api/media` | — | `MediaIndex` | |
| `POST /api/media?name=<filename>&folder=<id?>` | raw bytes, `Content-Type` | `MediaAsset` | validates mime against an allowlist; derives `kind`; sharp metadata + thumb for images |
| `POST /api/media/<id>/replace` | raw bytes, `Content-Type` | `MediaAsset` | same id; overwrites `files/<id>`; regenerates/removes thumb; updates mime/kind/size/dims |
| `PATCH /api/media/<id>` | JSON `{name?, alt?, folderId?}` | `MediaAsset` | `folderId: null` moves to root |
| `DELETE /api/media/<id>` | — | `{ok:true}` | removes file + thumb + index entry; no server-side usage block (client warns) |
| `GET /api/media/<id>/usage` | — | `{ total, branches: [{branchId, count}] }` | see below |
| `POST /api/media/folders` | JSON `{name}` | `MediaFolder` | |
| `PATCH /api/media/folders/<id>` | JSON `{name}` | `MediaFolder` | |
| `DELETE /api/media/folders/<id>` | — | `{ok:true}` | assets inside move to root |

Public (no auth — the published site needs them):

| Path | Serves |
|---|---|
| `GET /media/<id>` | `files/<id>` with indexed mime; `ETag: <size>-<mtime>` + `no-cache` revalidation (bytes change on replace, URL doesn't) |
| `GET /media/thumb/<id>` | `thumbs/<id>.webp`, same caching |

Index writes use the existing atomic tmp-then-rename pattern (`server/index.mjs:326-331`). All mutations are serialized through a single in-process promise queue (one Node process, matches the store's latest-wins philosophy).

### Usage scan (`GET /api/media/<id>/usage`)

Cheap and cross-branch: read every `server/data/store/superbird-project__*.json` blob and count occurrences of the literal string `"/media/<id>"`. Covers `node.src`, locale overrides, entry values, favicon, ogImage across **all branches** without understanding the document shape. Good enough for a warning count; the client details panel can additionally do a precise walk of the *active* project for "used on page X" naming.

### Thumbnails

- New dependency: **`sharp`** (server-only). Generate `thumbs/<id>.webp` at max 480px on the long edge, quality ~70, on upload/replace. Also read `width`/`height` metadata.
- Skip thumbs for: SVG (grid renders the original — small anyway), video/audio/documents/fonts (grid shows a kind icon; video previews use a `<video>` element client-side). `hasThumb: false` for these.
- sharp failure (corrupt image) → keep the upload, log a warning, `hasThumb: false`. Never fail an upload over a thumbnail.

### Security hardening (deny-by-default)

Media/upload endpoints are the classic CMS breach surface (Strapi CVE-2019-19609 and its unauth-endpoint family, endless WordPress plugin unrestricted-upload → shell/stored-XSS CVEs). Every control below is a server-side gate — client checks are UX only.

**Authentication & authorization**

- `handleMedia` opens with `if (!sessionUser(req)) return send(res, 401, …)` — **before** any body read, path parse, or disk touch. There is no unauthenticated `/api/media/*` route, period (the Strapi lesson: forgotten unauth endpoints).
- The only public routes are the two byte-serving GETs (`/media/<id>`, `/media/thumb/<id>`) — the published site needs them. They serve bytes only: no directory listing, no index/metadata, 404 for anything not in the index. `index.json` sits **outside** the served `files/`/`thumbs/` dirs and is unreachable by construction.
- The `GET /api/media` index (which exposes uploader identities and folder structure) is authed like everything else.
- Asset ids: 16 hex chars from `crypto.randomBytes` (64 bits — not enumerable). Public serving is by unguessable id, same model as unlisted URLs.

**CSRF**

- The session cookie is already `HttpOnly; SameSite=Lax` (+`Secure` in prod, `server/auth.mjs:243-246`), which blocks cross-site non-GET requests carrying the cookie in modern browsers.
- Defense-in-depth: every **mutating** `/api/media` request additionally validates the `Origin` header (when present) against the request `Host`; mismatch → 403. Cheap, and covers older browsers / future cookie-policy drift.

**Upload validation — never trust the declared Content-Type** (the polyglot/spoofed-mime class)

- Strict mime **allowlist** per kind; anything else → 415. Explicitly forbidden regardless of declared type: `text/html`, `application/javascript`, `application/xhtml+xml`, generic `application/xml`, anything executable.
- **Magic-byte verification** of the actual buffer against the declared mime: raster images via `sharp.metadata()` (the decoder is the sniffer), plus signature checks for the rest (`%PDF`, `wOF2`/`wOFF`/`\0\1\0\0` fonts, `ftyp` mp4, EBML webm, `RIFF` wav/webp, `ID3`/`0xFFFB` mp3, `OggS`). Declared mime that doesn't match sniffed content → 415. A PHP/HTML file renamed to `.jpg` with a spoofed header dies here.
- SVG (text, no reliable magic bytes): must parse as XML with an `<svg` root, and is **sanitized on upload** — strip `<script>`, `<foreignObject>`, `on*` attributes, and `javascript:`/external `href` values before writing to disk. Stored bytes are already inert.
- Client `filename` is **metadata only** — never used in any filesystem path. Sanitized on intake: control chars stripped, length-capped (128), and quote/CR/LF-escaped before ever appearing in a `Content-Disposition` download header (header-injection guard).

**Serving hardening (stored-XSS class)**

- Storage is extensionless and ids are validated `/^[a-f0-9]{16}$/` before any `path.join` — traversal is structurally impossible; anything failing the regex 404s without touching disk.
- All `/media/*` responses send `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` — even if a hostile file slipped every intake check, it can't run script or load subresources when opened directly on our origin. Content-Type always comes from the server-side index, never from the file or request.
- The MIME additions to `server/index.mjs:62-83` (audio, pdf, fonts) are for **exported hashed files** only; the library route never falls back to extension-based typing.

**Resource exhaustion (DoS)**

- `readBodyRaw` enforces the cap **while streaming** — the request is destroyed the moment the limit is crossed (413), not after buffering 200 MB. Per-kind caps: images 20 MB, video/audio 200 MB, documents/fonts 25 MB.
- `sharp` is invoked with `limitInputPixels` (~268 MP) so a 100×100-byte pixel bomb can't OOM the process; SVG is never fed to sharp.
- A total library disk quota (env `MEDIA_QUOTA`, default 2 GB) → 507 when exceeded; a light per-session upload rate limit (30/min) → 429.

**Hygiene**

- Errors return generic messages — no filesystem paths, no stack traces.
- Uploads/replaces/deletes record `uploadedBy` from the session (already in the schema) — an audit trail exists even with all-roles access. If the all-roles decision is ever tightened, delete/replace gating to `canBuild` is a two-line change at the top of those branches.
- Add the media-upload trust model to `docs/` alongside `security-structural-enforcement.md`.

---

## 3. Client data layer

### `src/composables/useMedia.ts` — singleton, API-backed

Module-level refs (the `useAuth`/`useBranches` server-hydrated flavor, **not** project-derived):

```ts
const assets = ref<MediaAsset[]>([])
const folders = ref<MediaFolder[]>([])
const loaded = ref(false)
```

Exposed API: `loadMedia()` (GET, idempotent, called from `useEditorBoot` after `hydrateStore` — both admin views boot through it, so content mode gets it too), `upload(file, folderId?)` (fetch POST raw `file` body with `Content-Type: file.type`; returns the asset), `replaceAsset(id, file)`, `updateAsset(id, patch)`, `removeAsset(id)`, `createFolder/renameFolder/removeFolder`, `usage(id)`, and lookups `assetById(id)`, `assetForSrc(src)` (parses `/media/<id>`), `mediaUrl(asset)`, `thumbUrl(asset)`. 401 responses hard-redirect to `/admin/login`, mirroring `lib/store.ts`.

### `src/composables/useMediaLibrary.ts` — modal controller singleton

Mirrors `useDocumentation.ts` (open/close + ref), extended with **select mode**:

```ts
open()                                            // manage mode (AppHeader)
openSelect(accept: MediaKind[] | undefined): Promise<MediaAsset | null>
// stores a pending resolver; the modal resolves it on pick or null on close
```

Select mode filters the grid to `accept` kinds, changes the primary action to "Use", and hides destructive bulk actions. One singleton means the modal component is mounted once per admin view and works identically in editor and content mode.

---

## 4. Modal UI — new components in `src/components/editor/`

All built from existing primitives (`ButtonUI`, `InputUI`, `SelectUI`, `RowUI`, `TooltipUI`, `BadgeUI`, `DropdownUI`, tabs in `src/components/tabs/`).

- **`MediaLibraryModal.vue`** — `<ModalHost size="full">` (the `DocumentationModal.vue:65` two-pane pattern: `w-[min(92vw,1200px)] h-[88vh]`). Layout: left sidebar (folders), main area (toolbar + grid), right rail (details panel, shown when an asset is selected). Handles select-mode via `useMediaLibrary`.
- **Folder sidebar** (inline in the modal or `MediaFolderList.vue`): "All media" + per-kind filters (Images / Video / Audio / Documents / Fonts) + user folders with rename/delete via `DropdownUI` row menu; "New folder" at the bottom. Delete folder → assets move to root (matches server behavior).
- **Toolbar**: search input (name + filename, client-side), Upload button (`<input type=file multiple>` → sequential `upload()` calls), and in select mode a prominent hint of what's being picked.
- **`MediaGrid.vue`**: responsive CSS grid of tiles — thumb (`thumbUrl`) for images, `<video preload="metadata">` poster frame for video, kind icon (lucide) for the rest; name + size caption. Click selects (details rail), double-click in select mode = pick. **Drag-and-drop upload** onto the grid (dragover overlay), and drag a tile onto a sidebar folder to move it.
- **`MediaDetails.vue`** (right rail): preview, editable name (`InputUI`), editable default alt (`TextareaUI`, images only), read-only rows (`RowUI`): kind, mime, size, dimensions, uploaded date + by, folder (`SelectUI` to move). Actions: **Replace file** (file input → `replaceAsset`; cache-bust previews with `?v=<timestamp>` after replace since the URL is stable), **Download** (link to `/media/<id>` with `download` attr using `filename`), **Delete**.
- **Delete flow**: on Delete click, call `usage(id)`; render `ConfirmModal` (`src/components/modal/ConfirmModal.vue`) with `message` = "Used in N places across M branches. Images using it will appear broken." (or "Not used anywhere." ) → confirm → `removeAsset`.

Mounting: `<MediaLibraryModal v-if="mediaOpen" @close="closeMediaLibrary" />` in **both** `EditorView.vue` (next to `DocumentationModal`, `EditorView.vue:46`) and `ContentView.vue`.

---

## 5. Entry-point integration

1. **AppHeader** — wire the existing stub at `src/components/editor/AppHeader.vue:130-136` (the `Images`-icon item currently only calls `close()`): `@click="(openMediaLibrary(), close())"`. Available in both header modes; not gated by `canBuild` (all-roles decision).
2. **Editor content panel** (`src/components/editor/ContentEditor.vue:150-162` + the `UploadUI` at `:228-229`): replace the `UploadUI` data-URL flow for image/video nodes with a media picker control — current-asset thumbnail + name, "Choose from library" button → `openSelect([type])` → on resolve, write `mediaUrl(asset)` through the existing `src` computed setter (which already routes to `setNodeSrc` or `setEntryValue`, including locale overrides via `useLocale.ts:134-155` — no changes needed there). Keep a secondary "Upload" affordance that uploads to the library first, then applies the new asset's URL — **every file goes through the library; `FileReader.readAsDataURL` is retired from this path.** `UploadUI.vue` stays for non-media uses (favicon/ogImage can migrate later or in the same pass — see §8 stretch).
3. **Content mode** (`src/components/site/ContentRenderer.vue` `pickMedia()` at `:95-115`): replace the transient file-input + `readAsDataURL` body with `const asset = await openSelect([kind]); if (asset) …` writing `mediaUrl(asset)` to the same two targets (`setEntryValue` at `:107` / `setNodeSrc` at `:109`). Cmd+click and context-menu `editRequest` triggers (`:118-128`) are unchanged.
4. Fonts: uploadable/organizable in the library (kind `font`) but **not** wired into `ProjectSettings.fonts` (`src/types/editor.ts:170`) in v1 — flagged as follow-up.

---

## 6. Alt text

`ElementNode` has no `alt` field and none is added. Default alt lives on the asset; resolution at render time:

- Each renderer's image branch adds `:alt="altAttr"` where `altAttr = assetForSrc(srcAttr)?.alt ?? ''`:
  - `ElementRenderer.vue` (src at `:60-68`, bindings `:272`, `:284`)
  - `ContentRenderer.vue` (src at `:45-53`, bindings `:229`, `:239`)
  - `PublicRenderer.vue` (bindings `:164`, `:173`)
- Export: `attrsFor` in `server/export.mjs` (src handling at `:262-263`) emits `alt="…"` by looking the asset up in the media index (§7). Per-node alt override is a possible v2 (would need a code-safe field like `classes`); not in scope.

---

## 7. Export & publish (`server/export.mjs`)

`extractMedia` (`server/export.mjs:149-192`) currently only interns `data:` URLs; `/media/<id>` refs pass through `rewrite` unchanged — the HTML would be right but **no bytes would land in `SITE/media/`**, and extensionless URLs wouldn't survive static hosting. Changes:

1. `exportSite` reads `server/data/media/index.json` at start (empty index if missing).
2. Extend `intern(value)`: if `value` matches `/media/<id>` and the id is in the index → read `files/<id>`, `hash = sha1(bytes).slice(0,12)`, emit `media/<hash>.<ext>` (ext from the asset's mime via `MIME_EXT`, extended with the new audio/document/font types), register in `files` and `paths` exactly like the data-URL path. Keep the `data:` branch intact (favicon/ogImage may still hold legacy data URLs).
3. The existing scan surface (`:171-187` — node src + locale overrides, favicon, ogImage, components, collection image values) already covers everything; only `intern` grows a branch.
4. Unreferenced library assets are **not** exported (publish = referenced-only snapshot).
5. The exported site is fully static and hash-named → immutable long-cache stays valid; a later replace-in-place re-publishes under a new hash.
6. Thread the index into `renderPage`/`attrsFor` for alt emission (§6).

Publish flow (`POST /api/published` → `runExport`) is otherwise unchanged; contributor-forbidden gate untouched.

---

## 8. Sequencing

Each milestone leaves the app working; `npm run build` (vue-tsc) is the gate, plus manual verification with `npm run dev` + `npm run serve`.

1. **M1 — Server core**: `server/media.mjs` (index I/O, upload, replace, patch, delete, folders, file serving with ETag/CSP/nosniff, streaming `readBodyRaw`, magic-byte sniffing, SVG sanitizer, Origin check), routing branches in `index.mjs`, `sharp` dependency, mime allowlist. Verify with `curl`: the happy path (upload → GET index → GET `/media/<id>` → replace → delete) **and the negative suite** — unauthenticated request to every `/api/media` route (expect 401), HTML/JS upload with spoofed `image/png` Content-Type (expect 415), SVG with `<script>`/`onload` (expect sanitized bytes on disk), oversized body (expect early 413), traversal ids like `../../auth` and `%2e%2e` (expect 404, no disk access), cross-origin `Origin` header on a mutation (expect 403), and a direct browser open of an uploaded SVG (expect CSP-blocked script).
2. **M2 — Client data layer**: `src/types/media.ts`, `useMedia.ts`, `useMediaLibrary.ts`, `loadMedia()` in `useEditorBoot`.
3. **M3 — Modal**: `MediaLibraryModal` + grid + folders + details + delete-with-usage `ConfirmModal`; wire the AppHeader stub; mount in both views. Manage-mode complete.
4. **M4 — Pickers**: select mode; `ContentEditor` src control swap; `ContentRenderer.pickMedia` swap. From here, new media flows through the library end-to-end in both surfaces.
5. **M5 — Export + alt**: `export.mjs` intern branch + index-driven alt; renderer `alt` attrs; publish → verify exported HTML, hashed files in `SITE/media/`, working published site.
6. **M6 — Polish**: drag-drop upload, drag-to-folder, multi-file upload progress, video poster tiles, usage details ("page X") in the rail, `MIME` map additions.

Stretch (explicitly out of v1 scope): favicon/ogImage picker migration, fonts→settings wiring, per-node alt override, dedup-by-hash on upload, S3 backend.

7. **M7 — Follow-up: security review of the existing server** (after the media work lands). The hardening in §2 applies only to the new media surface; the pre-existing endpoints were built without it. Run `/security-review` over `server/index.mjs` + `server/auth.mjs` with this checklist:
   - **`/api/store`** (`server/index.mjs:300-337`): no Origin check on PUT/DELETE, no rate limit, any authed role can overwrite any key — including other branches' project blobs and `superbird-branches`. Assess whether contributor writes should be constrained server-side (relates to the known UI-only gap in `docs/security-structural-enforcement.md`).
   - **`/api/users` + auth/invite flows**: Origin check on mutations, rate-limiting login and invite-accept (brute-force), invite token TTL/single-use verification, session fixation/rotation on login.
   - **`POST /api/published`**: Origin check; whether the `Bearer TOKEN` escape hatch (`server/index.mjs:361-369`) is rate-limited and constant-time compared.
   - **Cross-cutting**: apply the same `Origin`-vs-`Host` helper and per-session rate limiter built in M1 to all mutating routes; generic error bodies everywhere; `nosniff` on `handleStatic` responses.

---

## 9. Risks & edge cases

- **Replace + browser cache**: stable URL means stale caches; mitigated by `no-cache` + ETag on `/media/<id>` and `?v=` busting in editor previews after replace. Published site is unaffected (hashed filenames).
- **Grid with library not loaded / asset deleted**: `assetForSrc` returns undefined → renderers just show the raw URL (broken image), details show "missing asset". Never throw.
- **Large uploads**: 200 MB cap on the media route only; report 413 with a readable message surfaced in the modal.
- **SVG scripts**: CSP header on serve (see §2); worth a line in `docs/security-structural-enforcement.md`'s neighborhood.
- **Concurrent editors**: last-write-wins on `index.json` via the serialized queue; acceptable at this product's scale (same guarantee as the KV store).
- **sharp install**: native binary; pinned in `package.json`, Node ≥22.18 satisfied. If install fails on an exotic platform, uploads still work (`hasThumb:false` path).
