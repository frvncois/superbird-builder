# Site backend plan — integrations + public endpoints (forms first)

Supersedes `FORMS-PLAN.md` (last committed at `202780f`; read it with
`git show 202780f:FORMS-PLAN.md` for the byte-level detail of anything this plan
carries forward unchanged). Written 2026-10-03 against the working tree of that day;
line numbers may drift.

## The question this answers

The published site is static files. A site that needs a backend (a contact form that
emails, a newsletter signup, a checkout) has nowhere to run one — on a zip or GitHub
publish there is no server beside the pages at all.

**Answer: the Guano instance IS the backend, in both topologies.** The node process
is required anyway (the editor cannot run without it), it already holds the secrets
server-side (`publish.json`), and it already runs one public, unauthenticated,
rate-limited endpoint for visitors (`POST /_guano/unlock`, `server/index.mjs:1277`).
What is missing is (a) a general store for the credentials an integration needs,
(b) a public namespace of endpoints that use them, and (c) a way for a page hosted
somewhere else to find the instance. The other two options stay available but are
not built first:

- **A separate runtime service** (Workers / Netlify functions emitted beside the
  site): secrets and the manifest would have to travel to a second host, and we would
  maintain two runtimes. We keep it *possible* by writing the public endpoints as a
  store-free module (`server/public/*.mjs`, reading only the manifest, the
  integrations file and the submissions dir), and build nothing else.
- **No backend at all** (Formspree, Web3Forms, …): a form `action` pointing at a
  third party. Supported as an escape hatch in Phase 2 (an external `action` is
  allowed on a plain form and produces a design warning), nothing more.

## The integrations model (what changed since the forms plan)

Settings → Integrations no longer has one fixed group per provider. An **integration
is a named set of keys** (`SettingsPanel.vue:619-620`): `{id, name, fields:
[{name, value, secret, updatedAt}]}`. Key names are `UPPER_SNAKE_CASE`; a key is
either **secret** (write-once, masked, never shown again) or **plain** (readable). The
UI shows every key's reference as `{{ENV.<INTEGRATION>_<KEY>}}` for use in custom
code. Today it is UI-only: nothing is persisted or sent (`:614`).

This generalizes the backlog's "Stripe / mailing / SMTP" trio to anything a user
might wire up, and the plan below is built on it. Six decisions:

1. **Integrations live server-side only, in their own file** —
   `server/data/integrations.json` (0600, `writeAtomic`), never in the project blob.
   The blob is what editors, drafts, merges and agent tokens write; a merge-base
   snapshot is a whole copy of it. Keeping the *host* of an SMTP integration in the
   blob while the password sits server-side is the exfil path the old plan's Phase 0
   closed (point `HOST` at your own machine, read the password off the first `AUTH`);
   with the whole integration server-side the class is gone, plain keys included.
   `ProjectSettings.smtp` and `ProjectSettings.integrations` (`editor.ts:468-475`)
   become deprecated optionals, migrated once at boot (below), and the S4 redaction
   (`index.mjs:804`) and `contributor-merge.mjs:282` keep working unchanged.
2. **A secret never leaves the server.** `GET` answers `{name, secret: true,
   updatedAt}` for a secret key, never its value. **The exporter refuses a
   `{{ENV.…}}` reference to a secret key** — substituting one into custom code puts
   it in a static `<script>` on a public page. The UI must stop showing the
   reference on secret rows (it currently shows it on every row, `:1559`); a secret
   is reachable only by a server-side capability (SMTP send, webhook forward,
   checkout). A plain key is substituted into custom code at export.
3. **Writes are admin + session only; reads (names, key names, plain values) are
   admin + editor.** Same contract as the GitHub token and the site password. A
   `guano_` token can list integrations (so an agent can write a valid `{{ENV.X}}`
   reference) and can never create, change or read a secret.
4. **Capabilities consume integrations by picking one, not by name.** The server
   does not know which integration "is SMTP". A capability declares the keys it
   needs (`SMTP: HOST PORT USER PASSWORD FROM`), the admin picks an integration for
   it (Settings → Forms → *Send notifications with*), and the server validates the
   pick has those keys. This is what lets a user call theirs "Postmark" or "Gmail".
5. **One universal capability: webhook forward.** `FORWARD_URL` (plain) + optional
   `FORWARD_AUTH` (secret, sent as `Authorization`) lets a form post its validated
   submission as JSON to Zapier, Make, Airtable, Mailchimp, a CRM — without a
   provider-specific build for each. Server-side, SSRF-checked the way
   `upload_media`'s URL fetch is (every redirect hop resolved, private/link-local
   refused). This is how "any integration they might need" is honoured in v1
   without a plugin system.
6. **Public endpoints live under `/_guano/`, never `/api/`.** Every mutating `/api`
   route is cookie-authed and same-origin-checked (`index.mjs:1751`); the unlock
   endpoint is the precedent for the public namespace. Keeping the two prefixes
   disjoint means a guard regression on one can never expose the other, and the
   preview server (`:1817`), which refuses `/api/*` wholesale, can serve its
   `/_guano/*` twins.

## Ground rules for the executor

- Gates (`CLAUDE.md` → Commands): `npm run type-check`; `npm run check:catalog` after a
  catalog change; `npm run check:mcp` after touching a tool description or schema;
  `npm run build` + `npm run test:e2e` before each phase commit.
- The three renderers stay in step in one commit: `useRenderNode.ts` (+
  `ElementRenderer`, `PreviewRenderer`), `server/export.mjs`, the MCP validators. New
  shared logic goes in `src/lib/shared/forms.js` (plain JS, imported verbatim by all
  three, like `slider.js`). Rebuild `npm run build:mcp-runtime` when anything
  re-exported from `src/lib` changes.
- `GUIDE.md` and `CLAUDE.md` change in the same commit as the behaviour.
- `/security-review` on the branch before merging Phase 3.
- Values written by visitors render as text (`{{ }}`), never `v-html`, and never
  reach a log line, an SSE payload or an unfenced MCP response.

---

## Phase 0 — The integrations store (server) and its wiring (UI)

### 0.1 `server/integrations.mjs`
- File: `server/data/integrations.json` → `{ integrations: [{id, name, fields:
  [{name, value, secret, updatedAt}]}] }`. Read through one `readIntegrations()`
  that normalizes the shape; written with `writeAtomic`. Cache in memory, invalidate
  on write (the `siteGateCache` pattern, `index.mjs:1203`).
- Validation: integration `name` 1–40 chars, unique case-insensitively; key names
  `^[A-Z][A-Z0-9_]{0,63}$` (`KEY_NAME_RE`, mirror the client's); values ≤ 4 KB,
  no NUL; at most 50 integrations × 50 keys.
- `envName(integration, key)` = `<NAME upper, non-alnum → _>_<KEY>` — ONE
  implementation in `src/lib/shared/integrations.js`, used by the client's `envRef`
  (`SettingsPanel.vue:626`), the exporter's substitution and the MCP listing. Two
  integrations whose names normalize to the same prefix are refused at write.
- `GET /api/integrations` (session or token; admin/editor; contributor 403) →
  `[{id, name, fields: [{name, secret, updatedAt, value?}]}]` with `value` present
  **only** when `secret` is false.
- `POST /api/integrations` (create), `PUT /api/integrations/:id` (rename),
  `DELETE /api/integrations/:id`, `PUT /api/integrations/:id/keys/:key` (`{value,
  secret}` — set or replace), `DELETE /api/integrations/:id/keys/:key`. All **admin
  + session cookie only** (`sessionUser`, not `requestUser`), like
  `/api/agent-policy`. Flipping a key from secret to plain is refused (that would
  reveal a value that was promised never shown); delete and re-add instead.
- `POST /api/integrations/:id/test` (admin, session, 5/min) runs the capability
  check for a given `capability` (0.4) and reports the provider's reply line on
  failure ("Send test email").

### 0.2 Boot migration (one-way, idempotent)
- If `integrations.json` is absent and Main's blob has `settings.smtp.host` or
  `publish.json` has `stripe.secretKey` / `mailing.apiKey` / `smtp.password`, build
  the equivalent integrations once: `SMTP {HOST, PORT, USER, FROM plain; PASSWORD
  secret}`, `Stripe {PUBLISHABLE_KEY plain; SECRET_KEY secret}`, `Mailing
  {PROVIDER plain; API_KEY secret}`. Then drop those three namespaces from
  `publish.json` (`readPublishConfig`, `:203-208`; `secretsSetShape`, `:218`) and
  null `settings.smtp` / `settings.integrations` in every blob on its next write
  (the `migrateSchema` pass is the place). `handleIntegrationsConfig` (`:1163`) is
  deleted in the same commit — nothing else calls it once the panel is rewired.
- Record what was migrated in the boot log by *name*, never value.

### 0.3 Settings → Integrations, wired
- Replace the local `integrations` ref with reads/writes against 0.1. Loading shows
  a skeleton; a write failure keeps the row and shows the error inline (the Users
  panel's pattern).
- Secret rows: masked value, **no `{{ENV.…}}` reference** (decision 2); a one-line
  hint "Secret — used by server features only". Plain rows keep the reference with
  a copy button.
- `renameIntegration` uses the new `RenameModal.vue`, not `window.prompt`.
- Hidden for editors? No: editors see the list read-only (names, plain values),
  since they write custom code that references keys. Add/rename/delete/key buttons
  are `isAdmin`.
- Test (`e2e/store-agent-security.spec.ts` additions): editor PUT → 403; token GET
  works and never carries a secret value; token PUT → 403; cross-origin PUT → 403;
  secret→plain flip → 400.

### 0.4 Capabilities registry — `server/capabilities.mjs`
A capability is `{id, needs: [KEY…], optional: [KEY…], test(integration)}`:
- `smtp` — `HOST PORT USER PASSWORD FROM`; test = connect, STARTTLS/implicit TLS,
  AUTH, QUIT (no message). Port ∈ {25, 465, 587, 2525}, host matches
  `HOSTNAME_RE` (`index.mjs:1197`).
- `webhook` — `FORWARD_URL`, optional `FORWARD_AUTH`; test = `HEAD`/`OPTIONS` with
  the SSRF check, success on any response.
- (later, not v1) `stripe-checkout` — `SECRET_KEY`, `PUBLISHABLE_KEY`.
`resolveCapability(capId, integrationId)` returns the typed key bag or a named
refusal (`missing key PORT on "Postmark"`). Every consumer goes through it, so a
renamed or deleted key fails at pick time and at send time with the same message.

### 0.5 `server/smtp.mjs` — minimal SMTP client
Unchanged from `FORMS-PLAN.md` §0.2: `node:net` + `node:tls`, implicit TLS on 465,
STARTTLS **required** elsewhere (never `AUTH` in plaintext), certificate verification
on, `AUTH PLAIN` then `LOGIN`, 10 s timeout, one message per connection. One
`headerValue()` rejects CR/LF/NUL; RFC 2047 subject; plain-text body, CRLF-normalized,
dot-stuffed; `From` always the configured address; a visitor's email only in
`Reply-To` after validation. Headless check against a fake SMTP server in a
throwaway `.tmp-test.ts`.

### 0.6 Where the site finds the instance — `publishing.apiOrigin`
- `ProjectSettings.publishing` (`editor.ts:452`) gains `apiOrigin: string` — the
  public origin of this instance (`https://studio.example.com`). Empty means "same
  host", which is what the `server` method is.
- Validated as an `https:` origin with no path (`http:` allowed only for
  `localhost`). The export bakes it into every public URL it emits (2.1). It lives
  in `settings.publishing`, which an agent token already cannot change
  (`index.mjs:869`), so an injected agent cannot redirect submissions.
- `PublishDialog` / Settings → Publish: when the method is `zip` or `github`, show
  the field with the explanation "Forms and other server features on the published
  site post here." When it is empty and the site has an enabled form, the publish
  design warning says so (2.5).

### 0.7 CORS for the public namespace only
- `publicOriginAllowed(req)`: the request `Origin` must equal
  `https://<settings.domain>` or `https://www.<settings.domain>` (`domain`,
  `editor.ts:466`), or the instance's own origin, or `apiOrigin` itself. Read from
  the **published** snapshot (`published.json`), not the live blob — the visitor is
  on the site that shipped.
- `/_guano/*` handlers answer `OPTIONS` with `access-control-allow-origin: <that
  origin>`, `vary: origin`, `access-control-allow-methods: POST`,
  `access-control-allow-headers: content-type, accept`, `max-age: 600`. **Never
  `allow-credentials`**; the site runtime sends `credentials: 'omit'`. A request
  from any other origin gets `403` with no CORS headers.
- No `Origin` header (a native form post from the same host, curl) passes, as today.

---

## Phase 1 — Authoring: the `form` config and its states

Unchanged from `FORMS-PLAN.md` §1 except where noted.

### 1.1 Element registry
`form-success` / `form-error` in `src/lib/shared/elements.js:47` (`{tag: 'div',
suggest: 'text'}`), direct children of `form`, at most one each, refused elsewhere by
`validateTree` (the `list-empty` precedent). Own tags in `src/lib/html/tags.ts`
(`<form-success>`, `<form-error>`), added to `GUIDE.md`'s `page-html` table. Nested
forms are a diagnostic.

### 1.2 `node.form` — `FormConfig` (`src/types/editor.ts`)
```ts
interface FormConfig {
  enabled: boolean         // false/absent = plain <form>, no backend
  name?: string            // submissions list + email subject; default "Form"
  notify?: boolean         // email the site recipients (Settings → Forms)
  forward?: boolean        // POST the submission to the site's webhook integration
  redirect?: string        // internal route on success
}
```
`'form'` joins `NODE_STATE_KEYS`; per-instance with a component default via
`resolveInstanceValue`; `componentOps` detach bakes it; **not** in the contributor
allowlist (`contributor-merge.mjs`), with a regression test. `redirect` validated by
`isInternalRoute` in `src/lib/shared/forms.js` and re-checked by the server against the
manifest's routes. `notify` and `forward` are *whether*, never *where*: recipients and
the webhook integration are server-side, admin-set (decision 3 of the old plan,
unchanged — leads are personal data and the blob is writable by too many hands).

**The external-action escape hatch:** `action` and `method` stay out of
`ATTR_ALLOW` (`shared/attributes.js:9`) for enabled forms, but a *plain* form (not
`enabled`) may carry `form.externalAction?: string` (an `https:` URL), rendered as its
`action` with `method="post"`. It gets a design warning ("posts to a third party;
nothing is stored here") and no runtime. This is option 3 from the top of the plan.

### 1.3 Field rules — `src/lib/shared/forms.js`
`collectFormFields(formNode, mappingFor)` → `[{name, kind, required, maxLength,
options?}]` from the named controls (instances resolved, state blocks skipped);
unnamed controls reported separately; names starting `_` refused. Unchanged.

### 1.4 Data panel
`DataEditor.vue`, selection is a `form`: **Accept submissions**, Name, **Email
notification** (hint "No recipients — Settings → Forms" / "No SMTP integration picked"
when the server says so), **Forward to webhook** (hint when no webhook integration is
picked), Redirect, the read-only **Fields** list, and **Add success / error message**
through `useStructure`'s `insertIn`. When the publish method is zip/github and
`apiOrigin` is empty, a one-line notice with a link to Settings → Publish.

### 1.5 Canvas and Play
Both Vue renderers `preventDefault` on `submit` regardless of `enabled` (today Play
reloads the editor). Build canvas: state blocks render only while selected from
Layers. Play: `reportValidity`, show `form-success`, **send nothing**, with a "Not
sent — preview" note.

---

## Phase 2 — Export: markup, runtime, manifest

### 2.1 Markup (`server/export.mjs`, element switch near `:807`/`:829`)
```html
<form method="post" action="<apiOrigin>/_guano/forms/<formId>" data-form="<formId>"
      accept-charset="utf-8">
  …fields…
  <input type="text" name="_hp" tabindex="-1" autocomplete="off" aria-hidden="true" class="gf-hp">
  <input type="hidden" name="_route" value="/the/route">
  <div data-form-success hidden>…</div>
  <div data-form-error hidden>…</div>
</form>
```
- `<apiOrigin>` is `publishing.apiOrigin` or empty (same host). **This is the one
  line that turns the old "server method only" into "any host."** The `_route`
  hidden field and the `Origin` check together are what the server validates.
- `formId` = the form node's id; a form in a repeat is one form rendered N times
  with `_entry` added (old plan §2.1, unchanged). `.gf-hp` is a renderer-invented
  class: emit its rule (off-screen, not `display:none`) and register it.
- **`{{ENV.<NAME>_<KEY>}}` substitution in custom code** (`settings.customCode.head`
  `:1100`, `.body` `:1268`, and `page.customCode` `:1259`): plain keys are
  replaced; a reference to a **secret** key or to an unknown key **fails the
  export** with the name (a page shipping `{{ENV.STRIPE_SECRET_KEY}}` literally
  would be a leak the moment the key turns plain; an unknown reference is a typo
  the author wants to know about). The substitution happens only in custom code,
  never in node content — content is data (golden rule 6).

### 2.2 Progressive-enhancement runtime
A `forms` block in `server/site-runtime.js`, emitted only when a route has an enabled
form (its own gate, like `sliderIds`, `export.mjs:884`/`:1161`). `fetch(form.action,
{method: 'POST', body: new URLSearchParams(new FormData(form)), headers: {accept:
'application/json'}, credentials: 'omit', mode: 'cors'})`. Everything else as the old
plan §2.2: `_t` elapsed ms, `reportValidity`, disabled submit, `200 {ok}` → success
block or `redirect`, otherwise error block with field errors via `setCustomValidity`;
no-JS native post gets a `303` to `redirect` or `<route>?form=sent`, read on load.
With a cross-origin `apiOrigin` the `303` target is the **site's** route (the server
knows the site origin from the published `domain`), so a no-JS visitor lands back on
the site, not on the studio.

### 2.3 Manifest — `server/data/forms-manifest.json` (never in `site/`)
`{[formId]: {name, notify, forward, redirect?, routes[], entries?, fields[]}}` plus
`site: {domain, apiOrigin}`. Written atomically by `handlePost` (`:1002`) **after** a
successful export; the preview writes `forms-manifest.preview.json`
(`handlePreview`, `:955`). Unchanged otherwise.

### 2.4 Candidates
`collectCandidates` registers the state blocks' classes (hidden at export time).

### 2.5 Publish design warnings (`designWarnings`, `packages/guano/mcp/tools.mjs`)
Old list unchanged (no named fields, unnamed control, duplicate names, no submit, no
success and no redirect, nested form), with these replacing the "zip/GitHub method"
warning:
- An enabled form on a zip/GitHub method **with no `apiOrigin`**: "submissions have
  nowhere to go".
- `notify` on, but no recipients or no SMTP integration picked.
- `forward` on, but no webhook integration picked.
- `externalAction` set: "posts to a third party".
- A `{{ENV.…}}` reference in custom code to a key that is secret or unknown is a
  **refusal** (2.1), reported through `diagnose()` like any export failure.

---

## Phase 3 — The endpoint: `server/public/forms.mjs`

`POST /_guano/forms/:formId` (+ `OPTIONS`). Routed in `server/index.mjs` beside
`siteGateHandled` (`:1270`), **outside** `/api/`, so the `/api` same-origin check
(`:1751`) never applies and the public CORS rule (0.7) always does. The module reads
the manifest, the integrations file and the submissions dir — nothing from the store —
so it can be lifted into a standalone service later (option 2) without a rewrite.

### 3.1 Request handling (cheapest refusal first)
1. `OPTIONS` → the CORS preflight (0.7) and done.
2. `Origin` present and not allowed → `403`, no CORS headers.
3. `formId` matches `^[A-Za-z0-9-]{1,64}$` and is in the manifest → else `404`
   (same body for unknown and disabled).
4. Rate limits (3.3) → `429` + `retry-after`.
5. `content-type` is `application/x-www-form-urlencoded` → else `415`.
6. Body cap **32 KB**, dedicated reader that tears the socket down past it → `413`.
7. Parse; repeated keys only for checkbox groups.
8. Honeypot `_hp` or `_t < 1500` → silent `200 {ok: true}`, counted in `spamDropped`.
9. `_route` ∈ `routes` (and `_entry` ∈ `entries`) → else `400`.
10. Allowlist against the manifest's `fields` with the per-kind rules of the old plan
    §3.1 (required, caps, formats, options, booleans, control-char strip, NFC).
    First failure → `400 {error, field}`.
11. Append the record, enqueue notify and/or forward, respond `200 {ok: true}`
    (JSON on `accept: application/json`) or `303`.

Errors never echo values; the server never logs bodies.

### 3.2 Storage — `server/data/forms/<formId>.jsonl`
Unchanged: `{id, at, route, entry?, values}`, **no IP, no user agent**; 0600;
per-form append lock; caps 20 MB / 10 000 records → `503` and a "Storage full"
badge; `forms.retentionDays` pruning at boot and daily; outside the project package.

### 3.3 Rate limits (in-memory)
Per IP 5/min and 30/h (IPv6 keyed by `/64`), per form 120/h, site-wide 600/h.
**Fix `slidingLimiter` first** (`index.mjs:258`): sweep expired keys past 1 024
entries — it is now keyed by attacker-chosen values.

### 3.4 Delivery — `server/public/deliver.mjs`
- **Notify:** `resolveCapability('smtp', forms.mailer)` → `sendMail` to
  `forms.notifyTo`. A failed send never fails the submission. 60 emails/hour
  site-wide, then one digest per hour. Plain text, `label: value` lines, link to the
  admin view; `Reply-To` = the first valid email-kind value.
- **Forward:** `resolveCapability('webhook', forms.webhook)` → `POST FORWARD_URL`
  with `{form: {id, name}, route, entry?, at, values}` as JSON, `Authorization:
  <FORWARD_AUTH>` when set, 10 s timeout, **no redirects followed**, the SSRF check
  before connect. One retry after 30 s; then recorded as failed. Never forwards
  `_hp`/`_t`/`_route` or anything outside the allowlisted values.
- Per form, the last notify and last forward result (ok / error line / at) kept in
  memory and surfaced in the admin view.

### 3.5 Preview server
`previewServer` (`:1817`) answers `POST /_guano/forms/:id` from the preview manifest
with the same validation, `200 {ok: true, preview: true}`, and **never stores or
delivers**. Its `/api/*` refusal stays.

---

## Phase 4 — Reading submissions

Unchanged from `FORMS-PLAN.md` §4, with the settings tab reshaped:

- **API:** `GET /api/forms`, `GET /api/forms/:id/submissions?before&limit`,
  `GET …/submissions.csv`, `DELETE` one / all (**session only**). Token reads refused
  until the agent-policy switch **`allowFormSubmissions`** is on (`agent-policy.mjs:22`,
  off by default, admin + session to change).
- **CSV:** RFC 4180, BOM, formula-injection guard on `= + - @ TAB CR`, attachment.
- **Settings → Forms** (admin): Recipients (≤ 5 emails), **Send notifications with**
  (a select over integrations; the server checks the `smtp` capability and shows the
  missing key by name), **Forward submissions with** (same, `webhook`), Retention,
  "Send test email" / "Send test webhook" (→ `/api/integrations/:id/test`).
  The old plan's SMTP host/port group does not exist any more — those are keys on an
  integration.
- **Submissions modal** (`useModal().openModal`, `ModalHost` `xl`): list left, table
  right, CSV + delete, "Email failing" / "Forward failing" / "Storage full" badges.
  Reached from the Data panel of a `form` and from Settings → Forms. `{{ }}` only.
- `/api/events` (`:754`) pushes `forms:new {formId}` — the id, never values.

### MCP
- `list_integrations` → `[{name, keys: [{name, secret}]}]`. Never a value, plain or
  secret: the agent needs the *names* to write a reference, nothing more.
- `list_form_submissions {formId?, limit?, before?}`, fenced `{untrusted: true, text}`,
  403 explains the policy switch.
- `edit_elements` accepts `form: FormConfig | null` on a `form` node.
- `update_settings {publishing: {apiOrigin}}` stays refused for tokens like the rest
  of `publishing` (`index.mjs:869`); say so in the tool's refusal text.
- One sentence each + `get_guide {section: "forms"}` / `{section: "integrations"}`;
  `npm run check:mcp`.

---

## Phase 5 — Library, docs, coverage

### 5.1 Catalog
`contact-form` and `newsletter-signup` entries with `form: {enabled: true, notify:
true}`, named fields, both state blocks. `npm run check:catalog`.

### 5.2 Docs
- `GUIDE.md`: new **forms** section (fields, state blocks, where submissions go, that
  the agent can't read them by default) and **integrations** section (what a
  reference is, plain vs secret, that a secret reference fails the export).
- `CLAUDE.md`: an **Integrations** bullet (server-side file, admin writes, secret
  never leaves, capability picks, `envName` shared) and a **Forms** bullet
  (`/_guano/` public namespace, CORS to the published domain, manifest-not-live,
  recipients server-side, refusal order); the Publish & export section gains
  `apiOrigin`; the e2e list is updated; `ProjectSettings.smtp`/`integrations` noted
  as deprecated.
- Deployment docs (README "Deploying"): the studio + static topology now says "set
  the studio's public origin in Settings → Publish so forms on the static site
  reach it", and the all-in-one topology needs nothing.

### 5.3 e2e (names sort after `smoke.spec.ts`)
- `store-integrations.spec.ts` (HTTP): admin CRUD; editor read-only; token list
  without values; secret never returned; secret→plain refused; duplicate env prefix
  refused; the boot migration from a legacy `publish.json` + `settings.smtp` blob
  produces the expected integrations and nulls the blob fields; capability test
  endpoint reports a missing key by name.
- `export-forms.spec.ts` (in-process, exported HTML): action carries `apiOrigin` when
  set and is root-relative when not; honeypot/route/state markup; manifest matches
  fields incl. inside an instance and a repeat; runtime gated on forms; a plain `ENV`
  reference substituted in head/body/page custom code; a **secret** or unknown
  reference fails the export by name; `externalAction` renders and warns.
- `store-forms.spec.ts` (HTTP, mirrors the old list): happy path, `303`, dropped
  unknown names, the 400 cases, silent honeypot/too-fast, 413/415/429, **a disallowed
  `Origin` → 403 and an allowed one → 200 with the matching
  `access-control-allow-origin` and no `allow-credentials`**, preflight `OPTIONS`,
  same 404 for unknown/disabled, bad route 400, storage-full 503, contributor 403,
  token refused until the switch is on then fenced, token can't delete, CSV `=`
  escaped, contributor blob can't change `node.form`, preview validates but writes
  nothing. A fake SMTP listener asserts one notification with `Reply-To`, a
  `\r\nBcc:` value not injecting a header, and no `AUTH` before `STARTTLS`. A fake
  webhook listener asserts the JSON body, the `Authorization` header, that a redirect
  is not followed, and that a `FORWARD_URL` resolving to a private address is refused.
- `ui-forms-panel.spec.ts`: toggle on, add success block, pick an SMTP integration in
  Settings → Forms, publish, submit on `/`, success shows and the row appears in the
  modal; Play submit sends nothing.

### 5.4 Security review (before merging Phase 3)
Checklist for `/security-review`: the public namespace is disjoint from `/api`; CORS
origin derived from the *published* domain and never reflected; no
`allow-credentials`; the refusal order (3.1); limiter eviction (3.3); SMTP header path
(0.5); webhook SSRF check and no-redirect (3.4); a secret value never appears in any
response, export, log or MCP payload (grep the test server's outputs for a sentinel
secret); CSV injection; no `v-html`; manifest written only after a successful export.

---

## Order and size

| Phase | What | Rough size |
|---|---|---|
| 0 | Integrations store + migration + panel wiring, capabilities, SMTP client, `apiOrigin`, CORS | 2.5 days |
| 1 | Elements, `node.form`, Data panel, canvas/Play | 2 days |
| 2 | Export markup + `ENV` substitution, runtime, manifest, warnings | 1.5 days |
| 3 | `/_guano/forms`, storage, limits, notify + forward, preview | 2 days |
| 4 | Read API, CSV, Forms settings, modal, MCP | 2 days |
| 5 | Catalog, docs, e2e, security review | 1.5 days |

Phase 0 and Phase 1 are independent. 2 needs 1 and 0.6; 3 needs 0 and 2; 4 needs 3.
Ship only after 5.

## Follow-ups deliberately out of v1
Multipart uploads; Stripe Checkout (the `stripe-checkout` capability and a
`/_guano/checkout` endpoint, same shape as forms); a newsletter capability that
maps a submission onto a provider's subscribe API (the webhook forward covers most of
it today); writing submissions into a collection; Turnstile; the standalone runtime
service (option 2); a per-integration "used by" list in the panel (which forms and
custom-code references name its keys).
