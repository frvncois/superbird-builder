# RENAME.md — superbird → guano, one deliberate pass (2026-09-05)

Every "superbird"/"sb_"/"SB_" surface found by case-insensitive grep, with its
treatment. Rule: **rename outright** when both reader and writer ship in the same
build (runtime-internal names); **rename with read-compat** when old data or old
artifacts (backups, env configs, data dirs on disk) must keep working.

## Rename outright (same-build reader+writer, no persisted old copies)

| Surface | File(s) | New name |
|---|---|---|
| Client store key prefix (project) | `src/composables/usePersistence.ts:29` | `guano-project:<branchId>` |
| Client store keys (branches meta, base) | `src/composables/useBranches.ts:24,34` | `guano-branches`, `guano-base:<id>` |
| Client store keys (published baseline/info) | `src/composables/usePublish.ts:11,19` | `guano-published-baseline`, `guano-published-info` |
| Boot hydrate key list | `src/composables/useEditorBoot.ts:36-45,53` | guano-* |
| Server project-key gate + main read | `server/index.mjs` (`isProjectKey`, `currentProjectName`) | `guano-project:` |
| Media usage scan file prefix | `server/media.mjs` (`scanUsage`) | `guano-project__` (store dir is migrated at boot, so only new names exist) |
| Zip download filenames | `server/index.mjs` (2×), `src/composables/usePublish.ts:102`, `src/components/shared/SettingsPanel.vue:226` | `guano-site.zip`, `guano-project.zip` |
| Drag-and-drop MIME | `src/components/editor/media/MediaGrid.vue:22`, `src/components/shared/MediaLibraryModal.vue:135` | `application/x-guano-asset` |
| GitHub API user-agent | `server/github.mjs:36` | `guano` |
| Server banner comment + startup log | `server/index.mjs:1,795` | guano |
| Site runtime banner | `server/site-runtime.js:1` | Guano |
| e2e key references | `e2e/store-roles.spec.ts` | guano-* |
| e2e data-dir env | `playwright.config.ts` | `GUANO_DATA_DIR` |
| CLAUDE.md storage-key/package mentions | `CLAUDE.md` | guano-* |

## Rename with read-compat (old data must keep working)

1. **Store keys on disk** — new prefix `guano-`; **one-time boot migration**
   (`migrateStoreDir`, `server/index.mjs`): renames `superbird-*.json` →
   `guano-*.json` inside `<data>/store/` at startup and again after a project-package
   import swap. Idempotent (never clobbers an existing new-name file), each rename
   logged. The client never sees old keys after migration.
2. **Project package format** — manifest now writes `format: "guano-package"`;
   import accepts **both** `guano-package` and `superbird-package` (old format logs
   a deprecation notice). The has-project check accepts both `store/guano-project__`
   and `store/superbird-project__` paths; the post-swap migration normalizes
   imported old-prefix files.
3. **Env vars** — `GUANO_DATA_DIR` is primary; `SB_DATA_DIR` still honored as
   fallback with a one-time startup warning. Read sites: `server/index.mjs`,
   `server/auth.mjs`, `server/media.mjs`, `server/export-media.mjs`.
   (`PORT`, `PUBLISH_TOKEN`, `COOKIE_SECURE`, `MEDIA_QUOTA` are not brand-scoped —
   unchanged.)
4. **Session cookie** — `sb_session` → `guano_session`. Old cookies are simply
   invalid: every user re-logs once after the deploy (accepted, noted in the
   commit message). No compat read — a stale cookie name kept alive is a liability.
5. **localStorage (per-browser prefs)** — `superbird-theme` → `guano-theme` and
   `superbird-setup-name` → `guano-setup-name`, each with a one-time
   read-old-key-then-delete fallback so an in-flight setup or theme choice
   survives the deploy.

## Deliberately left as-is

- The **legacy localStorage purge list** in `useEditorBoot.ts` keeps its
  `superbird-*` names — it exists to delete *historical* pre-server-storage keys,
  which will only ever have old names.
- `CLAUDE.md`'s note about a host-configured `mcp__superbird__*` toolset — that
  naming lives in the harness, not this repo.
- `FINDINGS.md` — point-in-time audit, historical names are accurate there.
- `public/demo-project.json` — generated "Brume" demo content, no brand strings.
- `server/data/*` working copies — untracked runtime data; the boot migration
  handles the store dir, the site/ output regenerates on next publish.

## Verification (all must pass before commit)

- `rm -rf dist && npm run build` green, e2e suite green (covers login cookie,
  store PUT/DELETE role gates under the new key names, publish, static serve).
- Store migration: seed a store dir with `superbird-*` files, boot, confirm
  renames + idempotent second boot.
- Package round-trip: export a project package (new format), re-import it.
  Import a synthesized **old-format** package (`superbird-package` manifest +
  `store/superbird-project__main.json`), confirm accepted + migrated.
- `SB_DATA_DIR`-only boot still works (fallback + warning).
