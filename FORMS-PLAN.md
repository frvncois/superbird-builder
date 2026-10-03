# Forms plan — v1 (submissions on the published site)

Source: `BACKLOG.md` → "P2 — form submissions", turned into an executable plan on
2026-10-02. Line numbers are from that day's tree (`main`, `4247496`) and may drift.

**v1 scope:** a `form` on a site published with the **server** method posts to the
Guano instance, which validates it against what was published, stores it, and emails a
notification. Admins/editors read submissions in the editor and export CSV; MCP reads
them only when an admin allows it. **Out of v1:** file uploads (multipart), Stripe,
writing submissions into a collection, forms on zip/GitHub-hosted sites, captcha.

## Decisions taken here (change them before Phase 1 if you disagree)

1. **Email goes over SMTP, through a small hand-rolled client** (`server/smtp.mjs`,
   `node:net` + `node:tls`, no dependency). The backlog said "through
   `settings.integrations.mailing`", but that integration is a *newsletter* provider
   (the UI placeholder is "Mailchimp, Kit, Buttondown…") and has no transactional send.
   SMTP is already modelled in Settings, every transactional provider (Postmark,
   Resend, SES, Mailgun, Gmail) speaks it, and it keeps us provider-agnostic. Still no
   nodemailer, which matches the zero-dep `zip.mjs` precedent.
2. **SMTP connection settings move server-side** (host/port/user/from join the password
   in `server/data/publish.json`). Today `settings.smtp.host` lives in the project blob,
   which editors, drafts, merges and agent tokens can all write, while the password is
   server-side. Once the server *sends* mail, an injected agent that points `host` at
   its own machine gets the password in the first `AUTH`. That's a credential-exfil
   path this feature would open, so the move happens first, in Phase 0.
3. **Recipients are server-side and admin-only** (`publish.json` → `forms.notifyTo`),
   never on the node. A form only says *whether* it notifies. Leads are personal data,
   and a recipient field in the blob lets a contributor merge, a draft, or an injected
   agent quietly redirect them. With recipients held server-side, that whole class is gone.
4. **The server validates against a manifest written at publish, never against the
   live project or the posted field names.** The visitor submitted the *published* form,
   while Main may have moved on and a draft may not be published at all.
5. **Success/error states are elements:** `form-success` and `form-error`, direct
   children of `form`, following the `list-empty` precedent. They're styleable and
   translatable like any content, and they need no class-variant knowledge from the author.
6. **No per-site "submission token".** A static page can only embed a constant, so it
   proves nothing a scraper can't copy. A honeypot, a minimum fill time, rate limits and
   the manifest allowlist do the actual work. Captcha (Turnstile) is a follow-up.

## Ground rules for the executor

- Gates (CLAUDE.md "Commands"): `npm run type-check`; `npm run check:catalog` after any
  catalog change; `npm run check:mcp` after touching a tool description/schema;
  `npm run build` + `npm run test:e2e` before each phase commit.
- The three renderers stay in step in the same commit: `useRenderNode.ts` (+
  `ElementRenderer`, `PreviewRenderer`), `server/export.mjs`, and the MCP validators.
  New shared logic goes in `src/lib/shared/forms.js` (plain JS, imported verbatim by
  all of them, like `slider.js`).
- Rebuild committed bundles when their sources change: `npm run build:mcp-runtime`
  (anything re-exported from `src/lib`).
- `GUIDE.md` and `CLAUDE.md` change in the same commit as the behaviour.
- One commit per numbered item. Run `/security-review` on the branch **before merging
  Phase 3**. The backlog makes that mandatory.

---

## Phase 0 — SMTP settings server-side (prerequisite, security)

### 0.1 Move `settings.smtp` into `publish.json`
- `server/index.mjs:198` `readPublishConfig`: `smtp` grows to
  `{host, port, user, from, password}`. Keep normalizing to the full shape (the
  comment there explains why).
- `secretsSetShape` (`:214`) returns `smtp: {host, port, user, from, passwordSet}`.
  The non-secret halves can be echoed; the password still can't.
- `handleIntegrationsConfig` (`:1160`): accept the four new fields. Validate `host`
  as a hostname (reuse `HOSTNAME_RE`, `:1197`), `port` ∈ {25, 465, 587, 2525}, and
  `from` as an email. **Narrow to admin only** for the SMTP and forms namespaces.
  Editors keep Stripe/mailing as today.
- Migration: on boot, if `publish.json` has no `smtp.host` and Main's blob has one,
  copy it across once, then null `settings.smtp` in every project blob on the next
  write. Leave `ProjectSettings.smtp` in `src/types/editor.ts:456` as a deprecated
  optional field so old blobs still type-check. `contributor-merge.mjs:282` and the
  S4 redaction keep working unchanged.
- `SettingsPanel.vue:1120-1145`: the SMTP group reads and writes through
  `/api/integrations-config`, not `settings.smtp`. It's admin-only (hidden for editors).
- Test (`e2e/store-agent-security.spec.ts`): an editor session and a `guano_` token
  both get 403 on the SMTP namespace, and GET never returns the password.

### 0.2 `server/smtp.mjs` — minimal SMTP client
- `sendMail({host, port, user, password, from}, {to[], subject, text, replyTo?})`.
  Port 465 uses implicit TLS. 587/25/2525 use `STARTTLS`, which is **required**:
  refuse to `AUTH` over plaintext. Certificate verification stays on (no
  `rejectUnauthorized: false`, ever). Use `AUTH PLAIN`, falling back to `LOGIN`. 10 s
  socket timeout, one message per connection, `QUIT`.
- **Header safety:** every header value goes through one `headerValue()` that rejects
  CR/LF/NUL (throw, don't strip), and the subject gets RFC 2047 encoding when it's
  non-ASCII. Body: plain text only, CRLF-normalized, dot-stuffed. `From` is always the
  configured address. A visitor's email may only appear in `Reply-To`, and only after
  it passes the email check.
- Admin "Send test email" button → `POST /api/integrations-config/test` (admin, session
  only, rate-limited 5/min), which reports the SMTP reply line on failure.
- Headless check via a throwaway `.tmp-test.ts` against a fake SMTP server on
  `node:net` (assert the dot-stuffing, the CRLF rejection and the refusal to AUTH
  without TLS).

---

## Phase 1 — Authoring: the `form` config and its states

### 1.1 Element registry
- `src/lib/shared/elements.js:47`: add `form-success` and `form-error`
  (`{ tag: 'div', suggest: 'text' }`), next to `list-empty`.
- `validateTree` (`src/lib/validateTree.ts`): each one must be a direct child of a
  `form`, at most one of each per form. Anywhere else is a diagnostic ("never
  renders"), mirroring `list-empty`.
- `src/lib/html/tags.ts`: `form` is `<form data-form>` (a bare `<form>` with no config
  is the plain one), `form-success` / `form-error` are `<form-success>` /
  `<form-error>` — their own tags rather than a `data-` attribute on a div, so an
  agent reads the state at a glance and the writer can refuse a misplaced one by name.
  Add all three to the HTML element table in `GUIDE.md`'s `page-html` section.
- Forms may not nest (`form` inside `form` is a diagnostic; the browser would merge them).

### 1.2 `node.form` — node-owned config (`FormConfig` in `src/types/editor.ts`)
```ts
interface FormConfig {
  enabled: boolean          // false/absent = plain <form>, no backend (today's behaviour)
  name?: string             // label in the submissions list + email subject; default "Form"
  notify?: boolean          // email the site recipients (Settings → Forms)
  redirect?: string         // optional: an internal route to go to on success
}
```
- Follow the `slider` precedent everywhere: add `'form'` to `NODE_STATE_KEYS`
  (`src/lib/nodeState.ts`), the clipboard's deep clone (which needs no list, so
  nothing to do), per-instance with a component default via `resolveInstanceValue`
  (a "Newsletter" component's form), and `componentOps` detach bakes it.
- **Not** in the contributor content allowlist (`server/contributor-merge.mjs`): it's
  structural behaviour, so the server keeps the stored value. Add a regression test.
- `redirect` is validated at write (`src/lib/shared/forms.js` `isInternalRoute`): a
  root-relative path, no `//`, no scheme. The server checks it again against the
  manifest's routes (Phase 2), so it can't become an open redirect.

### 1.3 Field rules — `src/lib/shared/forms.js`
One function, `collectFormFields(formNode, mappingFor)`, used by the Data panel, the
exporter (manifest) and MCP warnings. It walks the form's subtree (resolving component
instances), skips nested `form-success`/`form-error`, and returns
`[{name, kind, required, maxLength, options?}]` from each `input`/`textarea`/`select`/
`checkbox`/`radio`'s sanitized `name`/`type`/`required`/`maxlength` attributes and
`:option` children. `kind` is one of `text | email | tel | url | number | textarea |
select | checkbox | radio`. Controls without a `name` are reported separately; they're
never submitted. Reserved names (`_hp`, `_t`, `_route`, anything starting `_`) are
refused.

### 1.4 Data panel
In `DataEditor.vue`, when the selection is a `form`: an **Accept submissions** toggle,
Name, **Email notification** toggle (with an inline "No recipients set — Settings →
Forms" hint when the server says none), and Redirect (a select over published page
routes, plus "Show success message"). Below that, a read-only **Fields** list from
`collectFormFields`, which flags unnamed controls and duplicate names. Buttons for
**Add success message** / **Add error message** insert the state children through
`useStructure` — `insertIn` on whichever host is live, never a hand-rolled
`children.push`.

### 1.5 Canvas and Play
- Both Vue renderers must `preventDefault` on `submit`. Today a form in Play submits to
  the SPA's own URL and reloads the editor (`PreviewRenderer.vue` has no submit
  handling). Fix this regardless of `enabled`.
- **Build canvas:** `form-success`/`form-error` render only while they or a descendant
  are selected (picked from Layers), like a hidden part. Otherwise the canvas shows the
  form as a visitor first sees it.
- **Play:** a submit runs native validation (`reportValidity`), then shows
  `form-success` and hides the fields. **Nothing is sent.** Play is an editor surface,
  and a test submission landing in the real inbox would be a surprise. A small "Not
  sent — preview" note in the success block makes that explicit.

---

## Phase 2 — Export: markup, runtime, manifest

### 2.1 Markup (`server/export.mjs`, the element switch near `:807`/`:829`)
For an enabled form, the exporter emits:
```html
<form method="post" action="/api/forms/<formId>" data-form="<formId>" accept-charset="utf-8" novalidate?>
  …fields…
  <input type="text" name="_hp" tabindex="-1" autocomplete="off" aria-hidden="true" class="gf-hp">
  <input type="hidden" name="_route" value="/the/route">
  <div data-form-success hidden>…</div>
  <div data-form-error hidden>…</div>
</form>
```
- `formId` = the `form` node's id. Ids are page-unique, and a form inside a component
  instance uses the page node's id, so two Newsletter instances are two forms.
- **A form inside a repeat** (`:collection-list`, bound `:slider`, a template page) is
  one form rendered N times. Its submissions record `_route` and, in a repeat,
  `_entry` (the entry slug), both checked against the manifest.
- `.gf-hp` is a renderer-invented class. Emit its rule in the base CSS (an off-screen
  position, *not* `display:none`, which some bots detect), and register it via
  `collectCandidates` if it's done as utilities.
- `action`/`method` are not in the attribute allowlist (`shared/attributes.js:9`), so
  the exporter fully owns them. Keep it that way.
- **Not the server method** (`settings.publishing.method` is `zip`/`github`): emit the
  plain form with no `action` and log a design warning (2.5). v1 doesn't post across
  origins.

### 2.2 Progressive-enhancement runtime
Add a `forms` block to `server/site-runtime.js` (emitted only when a route has an
enabled form, its own gate like `sliderIds`, `:1211`):
- Record `performance.now()` at load and send `_t` (elapsed ms) with the submission.
- On submit: `preventDefault`, `reportValidity()`, disable the submit button, then
  `fetch(action, {method:'POST', body: new URLSearchParams(new FormData(form)),
  headers:{accept:'application/json'}})`.
- `200 {ok:true}` → hide everything except `[data-form-success]` (show it), or follow
  `redirect`. Otherwise → show `[data-form-error]`, re-enable, and keep the values.
  `429` and `400` field errors map to `setCustomValidity` on the named field when the
  server names one.
- Without JS, the native post gets a `303` to `redirect`, or to `<route>?form=sent`.
  The runtime reads `?form=sent` on load and shows the success block, so a no-JS
  visitor still lands on the site, not on a bare JSON page.

### 2.3 Manifest — `server/data/forms-manifest.json` (never in `site/`)
`exportSite` collects every enabled form into `ctx.forms` and returns it beside the
stats. `{[formId]: {name, notify, redirect?, routes: string[], entries?: string[],
fields: [...from collectFormFields]}}`. Written atomically by `handlePost` (`:1079`)
**after** a successful export, so a failed publish never leaves a manifest pointing at
pages that didn't ship. The preview writes `forms-manifest.preview.json` (`:977`).

### 2.4 Candidates
`collectCandidates` registers any runtime-toggled classes — the success/error states
are hidden until the runtime shows them, so their classes reach no element at export
time and would never make the stylesheet.

### 2.5 Publish design warnings (`designWarnings`, `packages/guano/mcp/tools.mjs`)
Each condition below gets a warning. They're never refusals.
- An enabled form with no named fields.
- A form with an unnamed control.
- Duplicate field names. Radios sharing a name are fine.
- No submit button.
- No `form-success` and no redirect.
- `notify` with no recipients or no SMTP configured.
- An enabled form on a zip/GitHub publish method.
- A nested form.

---

## Phase 3 — The endpoint: `server/forms.mjs` (the exposed surface)

`POST /api/forms/:formId` is the **only unauthenticated write in the product**. It's
routed in `server/index.mjs` *before* the auth-gated handlers (`:1480`), and it stays
behind the global same-origin check (`:1477`). That check already passes native posts
(same origin) and requests with no Origin header (curl), which is fine since the
endpoint is public anyway.

### 3.1 Request handling, in this order (cheapest refusal first)
1. `formId` matches `^[A-Za-z0-9-]{1,64}$` and exists in the manifest → else `404`
   (the same body for "unknown" and "disabled", so it doesn't reveal which ids exist).
2. Rate limits (3.3) → `429` with `retry-after`.
3. `content-type` is `application/x-www-form-urlencoded` → else `415` (multipart is
   refused in v1).
4. Body cap **32 KB**, using a dedicated reader (not `readBody`'s 10 MB `MAX_BODY`),
   which tears the socket down past the cap → `413`.
5. Parse with `URLSearchParams`. A repeated key is allowed only for checkbox groups.
6. **Honeypot** `_hp` non-empty, or **`_t` < 1500 ms** → answer `200 {ok:true}` and
   drop it silently, so a bot learns nothing. Count it in the form's `spamDropped` stat.
7. `_route` ∈ the manifest `routes` (and `_entry` ∈ `entries` when set) → else `400`.
8. **Allowlist:** keep only names in the manifest's `fields`; unknown names are
   discarded, never stored. For each field:
   - `required` must be present.
   - Text gets per-kind caps (default 1 000 chars, textarea 10 000, or the field's own
     `maxlength`, whichever is smaller).
   - `email`/`url`/`tel`/`number` must pass their format.
   - `select`/`radio` values must be in the declared `options`.
   - `checkbox` values are booleans.
   - Strip NUL and control characters except `\n`/`\t`; normalize to NFC.
   - The first failure → `400 {error, field}`.
9. Append the record (3.2), queue the notification (3.4), and respond `200 {ok:true}`
   (JSON when `accept: application/json`), else `303` (2.2).

Errors never echo submitted values, and the server never logs submission bodies.

### 3.2 Storage — `server/data/forms/<formId>.jsonl`
- Record: `{id: randomUUID(), at, route, entry?, values: {...}}`. **No IP address and
  no user agent** in v1, because they're personal data we don't need. Abuse triage
  uses the in-memory limiter.
- The file is created with `0600` like the other data files (`server/util.mjs:39`), and
  `fs.appendFile` is serialized per formId through a promise-chain lock.
- **Disk caps:** 20 MB per form file and 10 000 records per form. Past either one, the
  endpoint answers `503` and the admin view shows "Storage full". It never silently
  drops a real lead and never fills the disk.
- **Retention:** `forms.retentionDays` (default 365, admin-set, 0 = keep). Pruned by
  rewriting the file atomically at boot and once a day.
- Not included in the project package export (`/api/project-export` stays `store/` +
  `media/`), and say so in the export dialog. A submissions backup is its own CSV
  download.

### 3.3 Rate limits (in-memory)
- Per IP: 5 per minute and 30 per hour across all forms (`clientIp`, `:136`, which
  honours `TRUST_PROXY`). IPv6 addresses are keyed by their `/64`, or one host could
  rotate addresses freely.
- Per form: 120 per hour, and site-wide: 600 per hour, so a distributed flood can't
  fill storage or the inbox.
- **Fix `slidingLimiter` first** (`:258`). Its `Map` never evicts, which is fine for
  authed callers but unbounded under attacker-chosen keys. Sweep expired ids once the
  map passes 1 024 entries, like `auth.mjs`' `limiter` does (`:519`).

### 3.4 Notification email
- Sent after the record is stored, on a small in-process queue (one SMTP connection at
  a time). A failed send never fails the submission.
- Capped at 60 emails per hour site-wide. Past that, send one "N more submissions,
  see the editor" email per hour instead of one per lead.
- Subject: `New submission: <form name> — <site name>`. Body: plain text with
  `label: value` lines and a link to the admin submissions view. **No HTML.**
- `Reply-To`: the first `email`-kind field's value, only when it passed validation.
- Record the last send result per form (`ok`/error line, timestamp) in memory, and
  surface it in the admin view.

### 3.5 Preview server
`previewServer` (`:1530`) answers `POST /api/forms/:id` from
`forms-manifest.preview.json` with the **same validation** and a `200`, but **never
stores or sends**. The response carries `preview: true`, and the runtime shows the
success block with the same "Not sent — preview" note. Every other `/api` path stays
refused.

---

## Phase 4 — Reading submissions

### 4.1 API (session or token, admin/editor; contributors get 403)
- `GET /api/forms` → `[{formId, name, routes, count, latestAt, spamDropped,
  lastNotify, storageFull}]` (manifest ∪ files on disk, so a form removed from the
  site keeps its submissions).
- `GET /api/forms/:id/submissions?before=<id>&limit=50` → newest first.
- `GET /api/forms/:id/submissions.csv` → the whole file.
- `DELETE /api/forms/:id/submissions/:subId`, and `DELETE /api/forms/:id/submissions`
  (all). **Session only** (an agent token can never delete), with `confirm()` in the UI.
- **Token reads** are refused unless the new agent-policy switch
  `allowFormSubmissions` is on (`server/agent-policy.mjs`, off by default, beside the
  existing three, admin + session-only to change). Submissions are other people's
  personal data, and an injected agent with read access could exfiltrate them through
  any write it can make.

### 4.2 CSV safety
- RFC 4180 quoting and a UTF-8 BOM.
- **Formula-injection guard:** a cell beginning with `=`, `+`, `-`, `@`, TAB or CR gets
  a leading `'`. Visitors write these cells, and Excel executes them.
- `content-disposition: attachment`, filename derived from the form name and
  slug-sanitized.

### 4.3 Editor UI
- A **Forms** tab in `SettingsPanel` (admin):
  - Recipients (`forms.notifyTo`, up to 5 validated emails).
  - Retention.
  - The SMTP group (moved here from Integrations, plus "Send test email").
- **Submissions** opens `FormSubmissionsModal` (`useModal().openModal`, `ModalHost` size
  `xl`; admin/editor):
  - The form list on the left (count, latest, a red "Storage full" or "Email failing"
    badge).
  - A table on the right with columns from the manifest fields.
  - Download CSV, plus delete for one row or all.
  - Reached from the Data panel of a selected `form` ("View submissions") and from the
    Forms settings tab.
- Values render as **text only** (`{{ }}`, never `v-html`). They're attacker-written.
- `/api/events` pushes `forms:new {formId}` so an open modal refreshes. It carries the
  id only, never the values.

### 4.4 MCP
- `list_form_submissions {formId?, limit?, before?}`. Read-only, every value fenced as
  `{untrusted: true, text}` with the `_untrusted` note (golden rule 6). A 403 explains
  the policy switch and tells the agent to ask the human.
- `edit_elements` accepts `form: FormConfig | null` on a `form` node (refused on any
  other type and on a `:Name` wrapper, following `slider`).
- Keep both descriptions to one sentence and point at
  `get_guide {section: "forms"}`, then run `npm run check:mcp`.

---

## Phase 5 — Library, docs, coverage

### 5.1 Catalog entries
`contact-form` and `newsletter-signup` in `src/lib/catalog/entries/`, each with `form:
{enabled: true, notify: true}`, named fields and both state blocks. `materializeCatalogEntry` copies
`form` like `slider`. Then `npm run check:catalog` (and `build:icons` if they use new
icons).

### 5.2 Docs
- **`GUIDE.md` → new "forms" section:** naming fields, the state blocks, the server-only
  method, what is stored, and that the agent can't read submissions by default.
- **`CLAUDE.md`:**
  - A "Forms" bullet under Subsystems: manifest-not-live-project, recipients
    server-side, the endpoint's refusal order.
  - The publish-config paragraph names the new namespaces.
  - The e2e count/list is updated.
- **`BACKLOG.md`:**
  - Strike P2 down to the follow-ups: multipart uploads, Stripe Checkout, a
    collection-backed store, Turnstile, cross-origin forms for zip/GitHub, IP-hash triage.
  - Note the SMTP-host exfil fix under security.

### 5.3 e2e specs (names sort after `smoke.spec.ts`)
- `export-forms.spec.ts` (in-process, against the **exported HTML**):
  - The action/honeypot/route markup and the state blocks start `hidden`.
  - A form on a zip method emits no action.
  - The manifest matches the fields, including fields inside a component instance and
    a repeated form.
  - `/assets/script.js` is gated on forms.
- `store-forms.spec.ts` (HTTP):
  - Happy path stores the record and returns 200.
  - The redirect path gives a `303`.
  - Unknown field names are dropped.
  - The missing-required, bad-email and option-not-in-list cases return 400.
  - The honeypot and too-fast cases return a silent 200 and store nothing.
  - An oversized body gets 413 and multipart gets 415.
  - The rate limit returns 429 with `retry-after`.
  - A cross-origin `Origin` gets 403.
  - An unknown or disabled form returns the same 404.
  - A route not in the manifest returns 400.
  - Storage-full returns 503.
  - Contributors can't read; tokens are refused until the policy switch is on, then
    see fenced values.
  - A token can't delete.
  - CSV cells starting `=` are escaped.
  - A contributor blob can't change `node.form`.
  - The preview server validates but writes no file.
- `ui-forms-panel.spec.ts`:
  - Toggle on, add the success block, publish, then submit on `/`: the success block
    shows and the submission appears in the modal.
  - Play submit shows success and sends nothing (assert no request).
- SMTP: a fake SMTP listener inside `store-forms.spec.ts` asserts that one notification
  arrives with `Reply-To` set, that a value containing `\r\nBcc:` does not inject a
  header, and that `AUTH` never happens before `STARTTLS`.

### 5.4 Security review (before merging Phase 3)
Run `/security-review` on the branch. The reviewer gets this checklist:
- The endpoint's refusal order (3.1).
- Limiter eviction (3.3).
- The SMTP header path (0.2).
- CSV injection (4.2).
- `v-html` absent from the submissions UI.
- Manifest written only after a successful export.
- No submission value ever reaches a log line, an SSE payload, or an MCP response
  unfenced.

---

## Order and size

| Phase | What | Rough size |
|---|---|---|
| 0 | SMTP server-side + client | 1–1.5 days |
| 1 | Elements, `node.form`, Data panel, canvas/Play | 2 days |
| 2 | Export markup, runtime, manifest, warnings | 1.5 days |
| 3 | `server/forms.mjs`, storage, limits, mail queue, preview | 2 days |
| 4 | Read API, CSV, modal, settings tab, MCP | 2 days |
| 5 | Catalog, docs, e2e, security review | 1.5 days |

Phases 0 and 1 are independent and can run in parallel. 2 needs 1, 3 needs 0 and 2,
and 4 needs 3. Ship only after 5. Stop and ask the owner if the manifest-per-publish model
turns out to conflict with how GitHub/zip users expect forms to behave.
