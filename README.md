# Guano

Guano is a self-hosted visual website builder. You write pages in a tiny
indentation-based language while a live canvas renders them — style elements with
Tailwind classes, add interactions, build reusable components and CMS collections,
translate into locales, leave comments, and work in drafts before applying to the
live site. Publishing compiles everything to a fully static site (plain HTML +
one CSS file + a ~1.5 KB runtime) that the built-in server hosts at `/` — or
ships as a zip, or pushes straight to a GitHub repo. The admin editor lives at
`/admin`; invite editors and contributors with role-based access.

## Quickstart

`npm create guano` is coming. Until then, run from a clone:

```sh
git clone <this repo> && cd builder
npm install
npm run build        # build the admin SPA
npm run serve        # → http://localhost:4174
```

Open `http://localhost:4174/admin`, create the first (admin) account, build,
publish. The published site is served at `http://localhost:4174/`.

Requires Node `^22.18.0 || >=24.12.0`.

## Developing (two processes)

The admin SPA and the API are separate processes in dev — run both:

```sh
npm run serve   # terminal 1: API + publish + static site on :4174
npm run dev     # terminal 2: Vite dev server with HMR on :5173
```

Edit at `http://localhost:5173/admin` (Vite proxies everything outside `/admin`
— `/api`, `/media`, and the exported site at `/` — to :4174). `npm run
type-check` runs the only static gate (vue-tsc); `npm run test:e2e` runs the
Playwright smoke suite — it needs a prior `npm run build` (the e2e server
serves `dist/` on an isolated port and data dir).

## Deploying

The admin needs a **persistent Node process with a writable disk** — a VPS,
Railway, Fly.io, Render, etc. On platforms with ephemeral filesystems, mount a
volume and point `GUANO_DATA_DIR` at it, or your users, media, and site vanish
on redeploy.

```sh
npm ci && npm run build
NODE_ENV=production PORT=80 node server/index.mjs
```

There's no Dockerfile yet, but the recipe is exactly the three lines above on a
`node:22` base (install, build, run; declare a volume for the data dir).

**The admin cannot run on Vercel/Netlify** — it's a stateful long-running server,
not serverless functions. Your **published site can**: it's fully static and
portable (use the zip or GitHub publish method and host the export anywhere).

## Backup

Everything lives in the data dir (default `server/data/`): `store/` (projects,
drafts), `media/`, `users.json`, `sessions.json`, `site/` (the current export).
**Backup = copy that directory.** For project content + media only, Settings →
Export project downloads a portable `.zip` you can re-import elsewhere.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4174` | server port |
| `GUANO_DATA_DIR` | `server/data` | data location — absolute path; set this on any real deploy (`SB_DATA_DIR` still works, deprecated) |
| `COOKIE_SECURE` | `1` (Secure on) | session cookie `Secure` flag; set `0` only for plain-HTTP LAN/dev setups (localhost works with the default) |
| `PUBLISH_TOKEN` | unset | when set, allows token-authenticated CI publishes via `Authorization: Bearer` |
| `MEDIA_QUOTA` | 2 GiB | media library size ceiling, in bytes |

## License

Not yet licensed — see `LAUNCH.md`. Do not redistribute until a license is chosen.
