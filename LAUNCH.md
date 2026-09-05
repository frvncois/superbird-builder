# LAUNCH.md — launch-prep run, 2026-09-05

Executed autonomously per the launch playbook against `FINDINGS.md`. Two sessions
(the second resumed after a context restart; the playbook was recovered verbatim
from the first session's transcript). Every commit passed the gate:
`rm -rf dist && npm run build && npm run test:e2e` (6/6 green).

## Done, with commits

| Item | What | Commit |
|---|---|---|
| 1a C1 | e2e selector fixed ("Content" → Preview); suite green on main | `d5a430e` |
| 1b S1 | sanitize interned data-URL SVGs on export + CSP on served `.svg` | `b976700` |
| 1c S2 | contributor DELETE on project store keys → 403 | `a60d00c` |
| 1d S3+S15 | CSS `url()` quoted + breakout chars percent-encoded; `SAFE_SRC` on favicon/og:image | `122f308` |
| 1e S6 | data files 0600, data dirs 0700 (incl. publish.json) | `484b7b9` |
| 1f S12 | session cookie `Secure` by default (`COOKIE_SECURE=0` opts out) | `da1c908` |
| 1g D1–D3 | `SAFE_SRC`/`SAFE_HREF`/`slugify`/`entrySlug` centralized in `src/lib/shared/`; export hash byte-identical | `f7398eb` |
| 1h C2–C6, Q5 | stale audit docs purged, `BACKLOG.md` created, references fixed, `.claude/` gitignored | `bbe5cb2` |
| 2a+2b Q3 | superbird→guano rename per `RENAME.md`: boot store-key migration, legacy `superbird-package` import compat, `GUANO_DATA_DIR` (+`SB_DATA_DIR` fallback), `guano_session` cookie | `712dc22` |
| 2c Q1, Q2 | real README, Guano tab titles, `UNLICENSED` placeholder | `fd47423` |
| 3a–3c P1, P2, P3, P5 | npm workspaces: `packages/guano` (bin + prepack + files allowlist), `packages/create-guano`; data dir defaults to `<cwd>/data` when installed; `@tailwindcss/vite` → devDeps | `1e7c959` |

Rename-compat verification (scripted, all pass): boot migration renames
`superbird-*` store files idempotently with logs; `SB_DATA_DIR`-only boot works
with a deprecation warning; a synthesized legacy `superbird-package` zip imports
and is migrated; the new `guano-package` export round-trips through import.

Packaging verification: tarball installed in a temp dir outside the repo —
`npx guano dev` serves `/api` + the admin SPA, creates `./data` with mode 0700,
setup issues a `guano_session` cookie; `npm create guano` journey (scaffold →
install tarball → `npm run dev` → `guano build` exports the demo project's 10
routes); **the full e2e suite passes against the packaged server** (via the
`GUANO_E2E_SERVER` hook in `playwright.config.ts`). Caveat: the three
unit-style specs (background-url, export-svg) import repo modules directly —
only the smoke spec (setup → edit → publish → view → auth guard) exercises the
packaged server end-to-end.

## Decisions made without you

1. **Deleted more audit docs than the playbook named.** The playbook (written
   against FINDINGS, which believed SECURITY.md et al. were missing) said to fix
   their dangling citations — but commit `0f2027b` had resurrected SECURITY.md,
   AUDIT.md, REVIEW.md, PERF.md, BOUNDARIES.md, REPORT.md, and SECURITY.md
   described S1 as *unfixed* (it's fixed — the exact staleness FINDINGS C4 flags).
   I deleted all six along with QUESTIONS.md/notes/; git history keeps them, and
   FINDINGS.md + BACKLOG.md are now the only live audit docs. *If you wanted any
   of them kept, `git checkout 0f2027b -- <file>` restores it.*
2. **The tarball ships `src/lib/shared/` (8 files).** The playbook's "zero src/"
   check is interpreted as "no SPA source": the server imports these plain-JS
   modules at runtime via `../src/lib/shared/…`, so the prepack copies them
   verbatim rather than rewriting imports (less risk, identical runtime layout).
   No other `src/` content ships.
3. **`guano build` exports the current Main project** (the store blob), not the
   last-published snapshot — "build what I have now" seemed like the CLI's job.
   Flip to `published.json` if you disagree (one line in `bin/guano.js`).
4. **Root package renamed `guano-monorepo`** (private; the publishable name
   lives in `packages/guano`).
5. **Generic env names kept**: `PORT`, `PUBLISH_TOKEN`, `COOKIE_SECURE`,
   `MEDIA_QUOTA` are not brand-scoped, so they were not prefixed. Only
   `SB_DATA_DIR` → `GUANO_DATA_DIR` (with fallback + warning).
6. **CLAUDE.md's `mcp__superbird__*` note kept** — that toolset name lives in
   the harness config, not this repo.
7. **Cookie clean break** per the playbook: `sb_session` cookies are invalid;
   every user re-logs once after deploying `712dc22`.
8. **Packing requires the repo clone** — `prepack` runs the root `npm run build`
   and stages files into `packages/guano`; you cannot pack from a bare checkout
   of `packages/guano` alone.

## npm pack (guano 0.1.0): 46 files, 453.9 kB packed / 1.3 MB unpacked

```
bin/guano.js
dist/  (built admin SPA: index.html, favicon, demo-project.json, assets/*
        — BuildView/PreviewView/Login/Setup/SetPassword chunks, Geist fonts)
server/ auth.mjs export-media.mjs export.mjs github.mjs index.mjs media.mjs
        site-runtime.js util.mjs zip.mjs        (code only — no server/data)
src/lib/shared/ background.js conditions.js elements.js fields.js
        richtext.js slug.js tokens.js urls.js  (server-runtime shared modules)
package.json, README.md
```

No SPA source, no docs/audit files, no `.claude/`, no data. `create-guano` packs
just `index.js` + README.

## Remaining (see BACKLOG.md for detail)

MED security: S4 (contributors can read SMTP creds), S5 (media replace/delete
open to contributors), S7 (zip-bomb ceiling on import), S8 (password change
keeps other sessions), S9 (rate-limit keying behind proxies), S10 (no CSP/XFO
on the two static surfaces). LOW: S11, S13, S14, S16. Refactors: Q4 CodeEditor
split (now unblocked — e2e is green), D4 dead-export nits, foldering nits.
Tooling: C7 (e2e needs prior build), C8 (`tsx` not a devDep).

## License — owner's call (hard blocker before publish)

Both packages carry `"license": "UNLICENSED"` so nothing can be published
accidentally. Pick one:

- **MIT** — maximal adoption and zero friction; anyone (including a competitor)
  can fork, close, and sell it.
- **AGPL-3.0** — self-hosters unaffected; anyone offering Guano as a service
  must open their modifications; some companies refuse AGPL outright.
- **Elastic License 2.0** — source-available, forbids offering it as a managed
  service; not OSI-approved "open source", which some communities care about.

## Publish commands (when you pull the trigger)

```sh
# 0. HARD BLOCKER: set the real license first
#    - LICENSE file at repo root
#    - "license" field in package.json, packages/guano/package.json,
#      packages/create-guano/package.json (replace UNLICENSED)
npm login
# 1. guano first (create-guano depends on it existing in the registry)
cd packages/guano && npm publish        # prepack builds + stages automatically
# 2. then the scaffolder
cd ../create-guano && npm publish
```

## Day-of-launch checklist

1. Reserve/verify the npm names `guano` and `create-guano` are still free.
2. License chosen, LICENSE file + three package.json fields set (blocker).
3. `git pull` clean; `rm -rf dist && npm run build && npm run test:e2e` green.
4. Fresh-machine test: `npm create guano test && cd test && npm i && npm run dev`.
5. `npm publish` guano, then create-guano (order matters).
6. `git tag v0.1.0 && git push --tags`.
7. README badges (npm version, node engines) + fix the create-guano npm links.
8. Smoke the published packages from the registry, not the local tarball.
9. Point the repo description/homepage at the product, not "builder".
10. Announce; watch the npm download page and issues for the first 48h.
