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

The mental model: **Guano is the studio, the site is the product.** The editor
always lives wherever the Guano server runs; the published site is a portable
static export that can live on that same host or anywhere else. Pick one of two
topologies — both are fully supported, and the only difference is the publish
method you choose in Settings → Publish.

### Topology 1 — all-in-one

One host runs Guano and serves everything. Point the site's domain at it:
`yoursite.com` is the published site, `yoursite.com/admin` is the editor.
Publish method: **server** (the default — every publish refreshes `/` in place).

Best for solo builders and single-site owners: one host, one cert, zero extra
config. Trade-off: the site is up only while the Guano process is.

### Topology 2 — studio + static site

Guano runs on *your* infrastructure (`studio.youragency.com`); clients and
editors log in there. Publishing pushes the export to a GitHub repo (publish
method: **github** → Pages/Netlify/anything watching the repo) or hands you a
zip (**zip**) to drop on any static host. The client's domain serves the static
export; the studio host never appears on it.

Best for agencies and client work: the site gets CDN speed and survives the
studio being down, and auth/data stay per-instance on your box. The export is
fully portable (root-absolute URLs, plain HTML + one CSS file + a ~1.5 KB
runtime).

### Either way

The editor needs a **persistent Node process with a writable disk** — a VPS,
Railway, Fly.io, Render, etc. **It cannot run on Vercel/Netlify or any static
host** — only the published site can. On platforms with ephemeral filesystems,
mount a volume and point `GUANO_DATA_DIR` at it, or your users, media, and site
vanish on redeploy.

```sh
npm ci && npm run build
NODE_ENV=production PORT=80 node server/index.mjs
```

There's no Dockerfile yet, but the recipe is exactly the three lines above on a
`node:22` base (install, build, run; declare a volume for the data dir).

Rules that hold in every topology:

- **One instance = one project = one site.** An agency with five clients runs
  five instances (five data dirs behind one reverse proxy, or five containers).
  That's deliberate — auth, content, and backups are isolated per client.
- **Behind a reverse proxy (nginx, Caddy, a PaaS router), set `TRUST_PROXY=1`**
  so login rate limiting sees real client IPs from `X-Forwarded-For` instead of
  lumping everyone under the proxy's address. Never set it without a proxy in
  front — the header is client-spoofable.
- **HTTPS is required for real use** (the session cookie is `Secure` by
  default); terminate TLS at the proxy or platform.
- **Laptop mode is valid** — run Guano locally and publish via zip/github. The
  moment a client needs to log in, the instance moves to a public host; that's
  the line.

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
| `TRUST_PROXY` | unset | set `1` **only behind a reverse proxy** — rate limiting then keys on the last `X-Forwarded-For` hop instead of the socket address |
| `PUBLISH_TOKEN` | unset | when set, allows token-authenticated CI publishes via `Authorization: Bearer` |
| `MEDIA_QUOTA` | 2 GiB | media library size ceiling, in bytes |

## License

Not yet licensed — see `LAUNCH.md`. Do not redistribute until a license is chosen.
