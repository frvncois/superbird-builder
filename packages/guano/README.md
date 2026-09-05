# guano

Self-hosted visual website builder: write pages in a tiny indentation-based
language on a live canvas, style with Tailwind classes, add interactions,
components, CMS collections and locales — then publish a fully static site
(plain HTML + one CSS file + a ~1.5 KB runtime) served by the built-in server,
downloaded as a zip, or pushed to GitHub.

```sh
npm create guano my-site
cd my-site && npm install && npm run dev
```

Open `http://localhost:4174/admin`, create the first (admin) account, build.
Your published site is at `http://localhost:4174/`.

## CLI

- `guano dev` — start the server for local editing
- `guano start` — production server (`NODE_ENV=production`)
- `guano build [--out dir]` — export the current project as static files (default `./dist-site`)

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4174` | server port |
| `GUANO_DATA_DIR` | `./data` | users, media, drafts, published site — **backup = copy this dir**; on ephemeral hosts point it at a volume |
| `COOKIE_SECURE` | `1` | session cookie `Secure` flag; set `0` only for plain-HTTP LAN setups |
| `PUBLISH_TOKEN` | unset | when set, allows token-authenticated CI publishes |
| `MEDIA_QUOTA` | 2 GiB | media library ceiling, bytes |

The admin needs a persistent Node process with a writable disk (VPS, Railway,
Fly.io, Render…). It cannot run on Vercel/Netlify — but your published site is
fully static and can be hosted anywhere.
