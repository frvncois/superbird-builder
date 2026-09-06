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
- `guano mcp` — run the MCP server (stdio) so AI agents can edit the site (see [MCP](#mcp-ai-agents))

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4174` | server port |
| `GUANO_DATA_DIR` | `./data` | users, media, drafts, published site — **backup = copy this dir**; on ephemeral hosts point it at a volume |
| `COOKIE_SECURE` | `1` | session cookie `Secure` flag; set `0` only for plain-HTTP LAN setups |
| `PUBLISH_TOKEN` | unset | when set, allows token-authenticated CI publishes |
| `MEDIA_QUOTA` | 2 GiB | media library ceiling, bytes |
| `GUANO_URL` | `http://localhost:4174` | `guano mcp` only — the running instance to connect to |
| `GUANO_TOKEN` | unset | `guano mcp` only — an API token (see [MCP](#mcp-ai-agents)) |

The admin needs a persistent Node process with a writable disk (VPS, Railway,
Fly.io, Render…). It cannot run on Vercel/Netlify — but your published site is
fully static and can be hosted anywhere.

## MCP (AI agents)

`guano mcp` exposes a **running** Guano instance to AI agents over the
[Model Context Protocol](https://modelcontextprotocol.io). The agent edits your
site through the same authenticated HTTP API the editor uses and shares the
editor's own document logic, so structure edits preserve element identity,
styling, and interactions exactly as if you'd typed them.

### 1. Create an API token

In the editor: **My account → API tokens → create**. Copy the `guano_…` token
(shown once). It carries your role — admin or editor only (contributors can't).

### 2. Register the server

The MCP server talks to your instance over HTTP; point it at the URL and token.
For example, with Claude Code:

```sh
claude mcp add guano -- npx -y guano mcp
```

then set the environment in your MCP client config:

```json
{
  "mcpServers": {
    "guano": {
      "command": "npx",
      "args": ["-y", "guano", "mcp"],
      "env": {
        "GUANO_URL": "http://localhost:4174",
        "GUANO_TOKEN": "guano_your_token_here"
      }
    }
  }
}
```

Use your deployed URL (e.g. `https://studio.example.com`) for a hosted instance.

### 3. Main vs. a draft — the agent asks you first

Writes go to a **target** you choose: **Main** (the live project) or a **draft**
(a safe branch you later apply from the editor's Drafts panel). The store is
latest-wins, so editing Main while you're also in the editor can clobber work —
**drafts are the safe mode.** The agent must call `set_target` before any write,
and its tool prompt tells it to ask you which to use. Creating a draft over MCP
produces exactly the shape the editor opens, and never changes which branch your
editor is viewing.

### Tools

`get_status`, `set_target` · `list_pages`, `get_page`, `set_page_code` ·
`get_styles`, `set_element_classes` · `list_interactions`, `create_interaction`,
`bind_interaction`, `unbind_interaction` · `list_collections`, `get_collection`,
`create_collection`, `upsert_entry`, `delete_entry` · `list_comments`,
`reply_to_comment` · `publish`.

Page/element edits are guarded by a version hash from `get_page` — a stale write
(the page changed underneath) is rejected rather than clobbering. Invalid DSL
comes back as diagnostics without saving.
