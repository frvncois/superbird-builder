# Guano feedback — Vezaro Health MVP build

Running log of every place Guano fell short while building the Vezaro Health MVP through
the MCP tools. One entry per issue; the Bask Health gap analysis and the final summary
follow at the end.

## Issues

### [BLOCKER] `set_target` cannot be answered in Claude Desktop (Code tab): the dialog never shows and is reported as "declined"
- **Area:** `set_target`, MCP elicitation
- **Needed for:** everything. No write is possible without a target.
- **What I did:** `get_status` → `elicitation: true`, `mainIsEmpty: true`, `targetSet: false`.
  Then `set_target {createDraft: "Vezaro MVP"}`. When that was declined, the user confirmed
  "yes, create the draft" in chat and I retried with `set_target {createDraft: "Vezaro MVP", chosenByUser: true}`.
- **Expected / Actual:** expected a dialog for the human. Actual, both times, at once:
  `{"ok": false, "reason": "declined-by-user", "message": "the human dismissed the target dialog without choosing — STOP, make no writes, and ask them in chat how they want to proceed"}`.
  The user reports **no dialog was ever shown**. The client (Claude desktop app, Code tab)
  declares the `elicitation` capability but answers the request with a non-`accept` action
  without displaying anything. Because the client declared elicitation, `chosenByUser: true`
  is ignored (`tools.mjs` only falls back to the chat attestation when `elicit()` returns
  `null`), so the chat confirmation can't be passed through either. The agent is stuck with
  no path to a target.
- **Bypass avoided:** writing to the store directly, or asking the user to edit the
  `guano-branches` meta by hand to pre-select a target.
- **Suggestion:** treat an elicitation result that comes back `decline`/`cancel` almost
  instantly (or one with no `content`) as "the client can't show dialogs" and fall back to
  the `chosenByUser` attestation flow. Alternatively add a launch-time target
  (`guano mcp --target <draftId|new:Name>`, or an env var) that the human sets in the MCP
  config, which counts as their choice the way a pre-set target already does. Also make
  `get_status.elicitation` reflect "declared AND working", not just "declared".
- **Status (2026-10-05, second session):** the working tree now has an uncommitted change to
  `packages/guano/mcp/tools.mjs` that removes the elicitation path and the
  `chosenByUser`/`acknowledgeMain` attestations from `set_target`. With that change,
  `set_target {createDraft: "Vezaro MVP"}` succeeded (draft `8fd8b17e…`). The blocker still
  applies to the committed code. Note that `GUIDE.md` golden rule 5 still describes the
  dialog and attestation flow, so in the patched build the guide and the tool disagree.

### [MAJOR] A successful page write was silently reverted later; no tool reported a conflict
- **Area:** whole-project saves (`saveTargetProject`) / draft storage
- **Needed for:** everything. This is data loss on the home page.
- **What I did:** wrote Home with `set_page_html` (version `232285f2…`, 131 elements), then
  27 bindings with `edit_elements` (version `3092598c…`), then checked it in `preview`. All
  of it rendered. Next, all to OTHER pages: `create_page` ×4 and ×9 (each batch issued in
  parallel), `set_component_variants` and `edit_elements {componentId}` on Button,
  `set_page_html` ×9 and ×6 in parallel, one multi-page `edit_elements {editsPath}` (15
  pages), and `set_page_seo {items}`.
- **Expected / Actual:** expected Home to stay as written. Actual: the next `preview`
  reported `unused-effects: Card deal, Parallax slow, Parallax fast, Marquee`, all of which
  were bound only on Home. `list_pages` showed Home back at `60cbc75b…`, the version of the
  **empty page the draft was created with**. The other 15 pages, all 19 components and the
  collections had kept their latest versions. Every intervening call returned
  `saved: true`, and none returned `stale-version` or a conflict. Home is the only page that
  existed in the draft's merge base (inherited from Main when the draft was created), so a
  base/merge snapshot winning over the agent's write is the likeliest mechanism. A
  read-modify-write race between the parallel calls is the other candidate. The guide says
  "writes to different pages parallelize freely". I could not tell which from the tools.
- **Bypass avoided:** none. I re-applied the page from my local HTML and edits files
  (`set_page_html` + `edit_elements`), which is the normal path, and re-verified it.
- **Suggestion:** make every whole-project write a server-side compare-and-swap (ETag /
  `If-Match` on the blob) rather than a client-side re-read. Have the agent policy log
  record which writer replaced which version. If a human editor's autosave or a merge
  overwrote the page, report it to the agent on its next call. Until then, the guide should
  not promise that parallel writes are safe.

### [MINOR] `*Path` arguments are confined to the repo, but nothing says so before the first refusal
- **Area:** `upload_media {manifestPath}`, `set_page_html {htmlPath}`, `edit_elements {editsPath}`, `GUANO_MCP_FILE_ROOT`
- **Needed for:** large payloads (the guide recommends paths for anything of tens of KB).
- **What I did:** `upload_media {manifestPath: "/private/tmp/…/scratchpad/media.json"}`.
- **Expected / Actual:** expected an absolute path to work, as the guide's "absolute path to a
  local file" suggests. Actual: `manifest is outside GUANO_MCP_FILE_ROOT
  (/Users/appwapp/Desktop/SUPERBIRD/superbird-builder): "…". Move the file inside that
  directory, or ask the operator to widen the root.` The message is clear, but the agent's
  own scratch directory is outside the root, so the advice to keep payloads out of context
  meets a refusal on the first try.
- **Bypass avoided:** none needed. I used a gitignored `.vezaro.local/` folder in the repo.
- **Suggestion:** have `get_status` report the file root, and say in the guide's "big
  payloads" table that paths must sit under it.

### [MINOR] `load-animation-moves-layout` flags an intentional looping marquee
- **Area:** `preview` / `publish` design warnings
- **Needed for:** home page logo/keyword marquee (brief: "LOTS of animation").
- **What I did:** bound `Marquee` (`x: "0%" → "-50%"`, 40 s, linear, `repeat: -1`) with
  `trigger: "load"` to the marquee track.
- **Expected / Actual:** the guide lists marquees as supported ("marquees, parallax…").
  Actual: `load-animation-moves-layout: ":div (64 elements) in page \"Home\"" … the whole
  region shifts on every page load`. The track is supposed to move. It sits in an
  `overflow-hidden` strip and shifts nothing around it.
- **Bypass avoided:** switching the trigger to `appear` only to silence the check.
- **Suggestion:** exempt infinite loops (`repeat: -1`) on an element whose parent clips
  overflow, or let a binding acknowledge the warning.

### [MAJOR] A `<form>` that is never enabled still submits, putting its fields in the URL; the guide says "nothing is sent"
- **Area:** forms export (`server/export.mjs` ~934–990), published runtime (`server/site-runtime.js:405`), `GUIDE.md` (Page HTML → Forms, Current tool gaps)
- **Needed for:** the questionnaire screens (hard rule: show the fields, submit nowhere).
- **What I did:** before writing the questionnaire I read how an un-enabled form exports.
- **Expected / Actual:** the guide says an un-enabled form "carries no action/method and
  nothing is sent, which is the right shape for a visual mock". In the code, it exports as a
  bare `<form>` with no `action`, and the runtime's submit handler only attaches to enabled
  forms (`[data-form]`). A bare form still submits natively: Enter in a text field, or any
  `<button>` without `type`, makes the browser GET the **current URL with every named field
  in the query string**. In a health questionnaire that puts answers in the address bar, in
  browser history and in the host's access logs. For a telehealth client, that is a PHI
  leak the guide tells agents is safe. I did not use `<form>` at all. Following the guide's
  other tip, the funnel controls sit in `<div>`/`<label>` groups and "Continue" is a link,
  so they cannot submit. The cost is that native form semantics and validation are gone.
- **Bypass avoided:** adding an `onsubmit` handler or a script through custom code to
  block submission.
- **Suggestion:** mark a non-enabled form (e.g. `data-form-inert`) and have the runtime
  always `preventDefault()` its `submit`; fix the guide's wording; and warn at
  publish/preview when a non-enabled form contains named controls.

### [MINOR] Filling a slot inline means re-typing the component's whole skeleton on every page
- **Area:** `set_page_html` with a slotted component (`FunnelShell`, 9 funnel screens)
- **Needed for:** funnel screens (one shared shell, page-specific content in the slot).
- **What I did:** wrote each screen as
  `<FunnelShell …><div><header><div><a><svg /></a><a><svg /><span /></a><a><svg /></a></div><div><div><span /><span>Step 1 of 6</span></div><div><div></div></div></div></header><main>…slot content…</main><footer><div><svg /><span /></div></footer></div></FunnelShell>`.
- **Expected / Actual:** expected to be able to address just the slot, e.g.
  `<FunnelShell><slot>…</slot></FunnelShell>`. Actual: the instance structure has to match
  the master node for node, so the page markup repeats the shell's skeleton 9 times, and
  any later structural change to the shell makes every saved page file stale. The
  alternative (`<FunnelShell />` then `edit_structure replaceChildren` into the slot's id)
  costs a second call per page and an id lookup. A first attempt also failed on a detail:
  a radio part inside an instance must be written `<input type="radio" />`, and a bare
  `<input />` was refused (`part 3 of <OptionCard> is a <radio>, not a <input>`). The
  message was clear.
- **Bypass avoided:** none.
- **Suggestion:** accept a `<slot name>` (or `data-slot-fill`) shorthand inside an instance
  whose master has one slot, and fill the rest from the master.

### [MINOR] Images export at upload size, with no dimensions, lazy loading or `srcset`
- **Area:** export of `<img>` / media pipeline
- **Needed for:** "mobile-first" and conversion. A 1600 px, 900 KB photo goes to phones as is.
- **What I did:** uploaded 16 photos (96 KB–918 KB) with `upload_media` and placed them.
  The preview export's `assets/media` is 4.9 MB, and Home's tags are
  `<img class="size-full object-cover" src="/assets/media/974126a11f4e.jpg" alt="…">`.
- **Expected / Actual:** expected resized variants plus `width`/`height` (or at least
  `loading="lazy"` below the fold). Actual: originals are copied verbatim. `loading` is in
  the attribute allowlist, so an agent could add it by hand. I did not, because many images
  sit inside components and collection bindings.
- **Bypass avoided:** pre-resizing the files locally before upload to fake an image
  pipeline (it would also break "swappable later" for the human).
- **Suggestion:** generate responsive variants at export (`srcset`/`sizes`), emit intrinsic
  dimensions, and default `loading="lazy"` to everything but the first viewport.

### [MINOR] Repeated "kept, but the Style panel has no control" warnings on every write
- **Area:** `set_page_html` / `create_component` responses
- **Needed for:** cost discipline (golden rule 8).
- **What I did:** used `place-items-center`, `text-balance`, `md:aspect-auto`.
- **Expected / Actual:** one notice per class per session. Actual: the same warning repeats
  once per element on every write, although the class is valid and renders. That was up to
  5 per response in round 1, and 16 in one `set_page_html` response in round 2 (the
  StartFlow build page).
- **Bypass avoided:** rewriting `grid place-items-center` as
  `flex items-center justify-center` only to silence warnings.
- **Suggestion:** dedupe by class within a response, or add the classes to the catalog.

### [MAJOR] A site-wide modal cannot be one component: nothing outside an instance can open it
- **Area:** interaction targeting (`resolveBindTarget`, `tools.mjs:1245–1371`), components
- **Needed for:** round 2 request: "Get started" opens a modal instead of separate pages,
  from the header, the hero, the CTA band, the footer and the treatment pages.
- **What I did:** before building, I read the binding rules: a trigger can only target an
  element in its own scope. A page node targeting inside an instance is refused (`bind
  targetId "…" is inside a component instance — an effect from outside the instance can
  never reach it`), and so is a master node targeting a page element or another
  component's interior. The header's "Get started" lives in `SiteHeader`, the footer's in
  `SiteFooter`, the band's in `CtaBand`. None of them can reach a shared modal.
- **Expected / Actual:** expected to build the modal once (a component) and open it from
  any CTA. Actual architecture needed:
  1. the flow itself as a component (`StartFlow`, steps switched by an exclusive-group
     interaction inside it);
  2. the overlay, panel and close button as **page-owned markup repeated on all 8 pages**,
     because the open/close state has to live on an element the triggers can reach;
  3. **slots** added to `SiteHeader` (×2), `SiteFooter` and `CtaBand`, so that every page
     re-declares their CTA buttons as page nodes that can bind to that page's overlay.

  This works (verified: open from the header, menu, hero, band, footer and treatment
  hero; close by ✕, overlay and Escape), but changing the modal chrome now means editing
  8 pages. Because the page cannot target inside `StartFlow`, opening the modal also
  cannot reset it to step 1. It reopens on the last step shown.
- **Bypass avoided:** custom code to open a dialog, or a duplicated modal inside each
  component that has a CTA.
- **Suggestion:** a named, site-level target, e.g. an `overlay` component rendered once per
  route plus a link sentinel `href="@open:start"` (in the spirit of `@item` / `@locale`),
  that any element on any page or in any master can use. Or allow a binding to target an
  instance by `ref` + `part` on the same page.

### [MAJOR] `instanceAttributes` on a nested instance (a mirror) reports success and renders nothing
- **Area:** `edit_elements {componentId}` on mirror nodes, nesting
- **Needed for:** the modal's radio groups (each question needs its own `name`).
- **What I did:** `edit_elements {componentId: StartFlow, edits: [{id: "cf352795",
  instanceAttributes: {name: "treatment", value: "weight-management"}}, …]}` on the
  `OptionCard` radios that StartFlow holds.
- **Expected / Actual:** response `{"saved": true, "edited": 4, "failed": 0}`. In the
  preview every radio still exports as `name="choice"` (the OptionCard default). So all
  questions share one radio group, and answering a later question clears the treatment
  choice. The guide lists what a host may say about a held instance as content, src, svg,
  background, locales, hidden and variants. Attributes are not on that list, but the tool
  accepted the write anyway: exactly the "success for a write that renders nowhere" class.
- **Bypass avoided:** copying OptionCard's markup into StartFlow as plain elements just to
  own the `name`.
- **Simplified instead:** the goal question became multi-select (`CheckCard`), so the
  treatment question is the only radio group left.
- **Suggestion:** either honour `instanceAttributes` on mirrors (it is the per-placement
  layer, and a host *is* a placement), or refuse the write by name.

### [MINOR] No way to animate a number; "count-up" stats need a digit-roll workaround
- **Area:** animations (properties are transforms, opacity, colours, size, clip)
- **Needed for:** round 2 request: "the stats number should appear like a counter".
- **What I did:** each stat number sits in a `StatItem` slot as rolling digit columns: per
  digit, a 1em-high clipping box with ten stacked `0`–`9` divs, rolled with
  `y: "0em" → "-Nem"` on `appear` (animations "Roll to 1/2/4/8"). The real value is in an
  `sr-only` span, and the columns are `aria-hidden`.
- **Expected / Actual:** expected a numeric tween ("count from 0 to 18,000"). None exists:
  text cannot be animated, and the guide's gap list mentions only character splitting. The
  odometer pattern renders well (verified in preview) and degrades to the final value
  under reduced motion. But it costs 10 elements per digit, one animation per target digit,
  and the number is no longer editable as text.
- **Bypass avoided:** a custom-code counter script.
- **Suggestion:** a `count` track (`{prop: "count", from: 0, to: 18000, format}`) on a leaf
  element, or a counter element type.

### [MINOR] Modal ergonomics: no scroll lock, focus handling or reset
- **Area:** class interactions used as a dialog
- **Needed for:** the "Get started" modal.
- **Expected / Actual:** a dialog normally locks page scroll, moves focus into the panel,
  traps Tab and restores focus on close. None of that is expressible. With inertia scroll
  on, the wheel over the backdrop scrolls the page behind; inside the panel it scrolls the
  panel, because the runtime detects nested scrollers. Escape closes it (`closeOn`). The
  step's scroll position and the visible step persist between openings.
- **Bypass avoided:** custom code for a focus trap and scroll lock.
- **Suggestion:** a `dialog` element (or a modal flag on an interaction target) that brings
  scroll lock, focus management and `aria-modal` with it.

### [MINOR] `body-transition-under-app-shell` fires for a marketing site's header
- **Area:** `preview` / `publish` design warnings
- **What I did:** with the funnel moved into a modal, `SiteHeader` is on every route, and
  the fade page transition the client asked for is on.
- **Expected / Actual:** the warning ("the sidebar/header flashes out and back in … reads
  as the app blinking") is meant for app shells. A fixed marketing nav over a fade
  transition is the agreed design. The check cannot tell the two apart.
- **Bypass avoided:** turning transitions off against the client's choice.
- **Suggestion:** let the project declare "marketing site" vs "app", or only warn when the
  chrome is a sidebar/bottom nav.

## Bask Health integration — gap analysis

Scope 3 of the brief (questionnaire ↔ Bask REST, webhooks, statuses, journey state) and
analytics were assessed, not built. Guano today is a **static-site builder with one
unauthenticated write endpoint** (`POST /_guano/forms/:id`, stored as plain-text JSONL,
readable by editors) and a key store whose secrets can be used only by the server's own
capabilities (SMTP, webhook forward). There is no server-side code, no visitor
authentication and no per-visitor data. Each item below is judged against that.

| Brief item | Supported today? | What is missing |
|---|---|---|
| **API authentication** (Bask API key / OAuth) | **No** | Secret keys can live in Integrations, but only SMTP and the webhook capability can use them. A secret in `{{ENV.X}}` **fails the export** (by design: custom code is public). There is no server-side function or proxy route that could sign a request to Bask with a secret. Needed: server-side "actions" (named, admin-defined HTTP calls that run on the instance with an integration's secrets), never client-side. |
| **POST requests** (create patient, submit intake, create order) | **No** | The only POST target is the form endpoint, which stores the submission locally and can **forward** it to one webhook URL as-is. There is no request templating, no per-form destination, and no way to chain calls (create patient → submit questionnaire → create order). Needed: per-form "submit to action" with a field-mapping step, executed server-side. |
| **Secure transmission of PHI** | **No, and the current path is unsafe for PHI** | Form submissions are stored as plain-text JSONL in `server/data`, readable by every admin/editor, kept for `retentionDays`, and emailed via SMTP when `notify` is on. None of that is HIPAA-grade: no encryption at rest, no BAA'd processor, no access audit. Needed: a "pass-through, never store" mode for a form (stream to the action, persist nothing, log no field values), TLS-only enforcement, and an explicit PHI flag that disables `notify`, retention and `list_form_submissions`. In practice the PHI flow should probably bypass Guano entirely (Bask-hosted intake/embeds). |
| **Response & error handling** | **Partly (UI only)** | `form-success` / `form-error` blocks exist and the runtime shows them, but they react only to Guano's own endpoint. There is no way to surface a Bask validation error ("state not served", "email already registered") field by field, retry, or branch the journey on the response. Needed: the action's response mapped back to the page (error messages per field, success → redirect with state). |
| **Field mapping** (questionnaire → Bask schema) | **No** | Fields are validated only against the published markup (types, select options, maxlength). There is no mapping layer from control names to an external schema, no transforms (dates, units, enums), and no conditional questions driven by data. The questionnaire itself would also need conditional logic (skip/branch), which today exists only as show/hide class interactions inside one page. |
| **Webhooks from Bask** (payment succeeded, clinician decision, prescription shipped) | **No** | The instance exposes no inbound webhook endpoint for third parties. Needed: signed inbound webhooks (HMAC verification with a stored secret) that update a per-patient record, plus idempotency and replay protection. |
| **Payment status** | **No** | There are no payment primitives and no per-visitor state to hold a status. The payment screen was built as a **placeholder for Bask's hosted/embedded checkout** (card fields deliberately not drawn). An embed would need custom code (blocked for agents by default, and PCI scope stays with Bask), or a first-class "embed" element with an allowlisted origin. |
| **Medical-validation status** (clinician review outcome) | **No** | Same as payment status: needs inbound webhooks plus per-patient storage. |
| **Per-user status pages** (status tracking screen) | **No** | Every page is a static file shared by all visitors. There is no patient login, session or per-user data binding (`/start/status` is a static demo of the layout). Needed: either authenticated dynamic routes (a large architectural change for a static exporter), or, more realistically, a link-out to Bask's patient portal, or a client-side widget that calls Bask with the patient's own token. |
| **Journey-state updates** (landing → treatment → questionnaire → account → payment → handoff) | **No** | Choices made on one screen are not carried to the next. The export has no client storage hook and no state that survives navigation. A single-page multi-step flow is possible with class interactions (one `<div>` per step, toggled), but it cannot persist, resume or validate before advancing. Needed: a multi-step form element with per-step validation and resumable state, posting once through a server-side action. |
| **Account creation** | **No** | Visitors have no accounts in Guano (users are only admins/editors/contributors). The account screen is a placeholder for Bask's account/identity flow. |
| **Analytics** (brief scope 1, assess only) | **Only via custom code** | No first-party analytics. GA4/Segment/PostHog would go in `customCodeHead`, which is admin-gated and off for agents (kept off per the hard rules). Also missing: consent management (needed for US state privacy laws), funnel-step events, and a rule that keeps PHI (questionnaire answers, URLs carrying health terms) out of analytics payloads. Needed: an analytics integration with a consent banner element and declarative events on links/steps. |

**Recommended architecture for the real build:** keep Guano for the public marketing site
and the funnel's *visual* screens. Hand off to Bask-hosted or embedded intake, account and
checkout for everything that touches PHI or payment, with Guano CTAs deep-linking into
Bask. Revisit native integration only if Guano gains server-side actions, inbound signed
webhooks and a non-persisting PHI mode.

## Summary

### Round 2 (client adjustments)

The user lifted the no-dummy-data rule for the prototype and asked for three changes:

- **Dummy content filled in everywhere:**
  - fictional clinicians with stock portraits (Dr. Maya Ellison, Dr. Arjun Mehta,
    Dr. Sofia Reyes, Amara Okafor NP-C);
  - prices: from $129/month for weight management, from $49/month for skin & longevity;
  - stats: 18k+ patients, 24h review, 41 states;
  - three testimonials, full FAQ answers, safety copy;
  - sample legal text. The legal pages keep a one-line "sample text, to be reviewed by
    counsel" notice.

  None of it is real. Every number, name and quote must be replaced before launch.
- **Stats:**
  - the numbers roll up like counters (digit columns, MINOR above);
  - the three "Why Vezaro" photos drift and tilt as you scroll past (scrubbed timelines).
- **Get started is a modal:**
  - the 9 `/start/*` pages are deleted and replaced by the `StartFlow` component inside a
    page-owned bottom sheet (phone) / centered dialog (desktop);
  - it opens from every CTA, and the status screen became a `/account` demo dashboard
    behind "Sign in";
  - building it surfaced two MAJORs above: no cross-instance targeting, and mirror
    `instanceAttributes` silently dropped.
- **Components:** added `ActionButton` and `StartFlow`. Removed `FunnelShell` and `Field`,
  which were no longer used. Slots were added to `SiteHeader`, `SiteFooter`, `CtaBand` and
  `StatItem`, and `ClinicianCard` now has a photo.
- **Routes:** 13 (Home, Treatments, How it works, About, FAQ, Account, 2 treatments,
  5 legal).
- **The silent-revert issue did not recur.** All writes in round 2 were sent one at a time,
  except one batch of page deletions, which all landed.

### Round 1

**Built (draft "Vezaro MVP", never published, checked with `preview`):**

- **Settings:** 15 semantic color tokens, Google Sans via Google Fonts, site-wide motion
  (fade page transitions, inertia scroll, `appearMode: replay`), SEO defaults and per-page
  SEO. Template pages use `{title}` / `{summary}` tokens.
- **Media:** 16 free-license Unsplash photos uploaded to the library (portraits, calm
  nature, food and wellness, one laptop with stethoscope). No branded products, no
  in-clinic procedures, no faces presented as clinicians or patients.
- **19 components:** Button (variants tone ×5, size ×3, width ×2), Pill (tone ×3),
  SiteHeader (mobile menu, scrolled state, `current:` nav), SiteFooter, SectionIntro
  (align), PageHero, CtaBand, TreatmentCard (collection-bound), FaqItem (accordion,
  exclusive group), StepCard, FeatureItem, StatItem, TestimonialCard, ClinicianCard,
  FloatingChip, FunnelShell (slot + 7-step progress variants), OptionCard, CheckCard,
  Field.
- **3 collections:** `treatment` (2 entries, template page → `/treatment/<slug>`), `faq`
  (13 entries, data-only, category select, reference to treatment), `legal` (5 entries,
  template → `/legal/<slug>`, headings only with `[LEGAL COPY REQUIRED]`).
- **21 routes:** Home, Treatments, How it works, About & clinicians, FAQ; 2 treatment
  pages; 5 legal shells; 9 funnel screens (`/start`, treatment, goal, state, health,
  account, payment, confirmation, status).
- **Motion:** 10 timelines (fade up, stagger, hero intro, card deal, parallax ×2,
  marquee, clip reveal, stack recede, funnel enter) and 4 class interactions (menu,
  scrolled header, FAQ open/icon). Marketing pages get expressive motion: staggered
  reveals, scroll-scrubbed parallax on the hero card fan, sticky stacking step cards that
  recede on scroll, clip-wipe image reveals and a marquee. The funnel only gets a 300 ms
  fade on its content region. Everything yields to `prefers-reduced-motion`.
- **Verified in the browser:** desktop and phone layouts, FAQ accordion, mobile menu,
  option selection, field attributes, treatment-specific FAQ filter (`equalsCurrent`),
  "other treatment" list (`excludeCurrent`), legal side navigation.

**Skipped, and why:**
- All of brief scope 3 and analytics: assessed above, not built (no server-side actions,
  PHI-safe storage, inbound webhooks or per-user state).
- Real data collection: no `<form>` is used anywhere, because an un-enabled form still
  submits to its own URL (MAJOR above). Continue buttons are plain links, and choices do
  not carry between screens.
- Partner/press logo strip from the Roco reference: no real partners exist yet, and
  inventing logos would be a false claim. It became a marquee of service keywords.
- Testimonials, stats, clinician names and photos, prices, review times, state coverage,
  safety information and legal text: marked placeholders only (`[TESTIMONIAL — needs
  approved copy]`, `[STAT — needs source]`, `[PHYSICIAN NAME]`, `[PRICE]`,
  `[LEGAL COPY REQUIRED]`, …).
- Image optimization and lazy loading: not available from the exporter (MINOR above).

**Issues by severity (both rounds):**
- **1 BLOCKER:** set_target / elicitation, unblocked only by an uncommitted local patch.
- **4 MAJOR:**
  - silent revert of a saved page;
  - un-enabled forms submit;
  - no cross-instance targeting, so a site-wide modal must be page-owned;
  - mirror `instanceAttributes` accepted but not rendered.
- **8 MINOR:**
  - file-root confinement;
  - marquee false positive;
  - slot fill verbosity;
  - no responsive images;
  - warning noise;
  - no number tween;
  - no modal primitives;
  - app-shell warning on a marketing header.
