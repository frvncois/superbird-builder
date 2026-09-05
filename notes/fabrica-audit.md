# Fabrica (fabrica.framer.media) — design audit

Audited via WebFetch of `/`, `/studio`, `/projects/boltshift`, `/blog/how-a-well-designed-website-can-transform-your-business`, `/contact` (2026-09-05). Playwright screenshots were **not** taken — no browser automation in this environment; logged in fabrica-gaps.md. Long-form body copy (project/blog bodies, legal pages) is paraphrased in the seed rather than copied verbatim; short UI strings (headings, labels, stats, nav) follow the reference.

## Brand & tokens

- **Look**: dark agency site — near-black background, off-white text, one warm accent; big lowercase display type; `fabrica®` wordmark everywhere; parenthetical meta labels (`(001)`, `(27)`, `(2016-25©)`).
- **Colors** (approximated from rendering): background `#0e0e0c`, raised surface `#1a1a18`, text `#f2f1ee`, muted text `#8a8a85`, accent `#d9f24f` (lime), borders `#2a2a27`.
- **Type**: single grotesque sans (Inter used as stand-in via Google Fonts). Display: clamp ~64–160px lowercase, tight leading (-4% tracking). H2 ~40–56px. Body 15–16px/1.6. Meta labels 12–13px uppercase-ish.
- **Spacing**: generous — section padding ~120px desktop / 64px mobile; container max-w ~1360px with 24px gutters; 12-col feel but mostly 2-col splits (asymmetric 1/3–2/3).
- **Radii**: large — cards 24px, buttons/pills full, thumbnails 12px.
- **Breakpoints**: 1440 / 768 / 390 (matches builder defaults).

## Routes

`/` · `/studio` · `/projects` (list) · `/projects/:slug` (detail) · `/blog` (list) · `/blog/:slug` (post) · `/contact` · `/legal/privacy-policy` · `/legal/terms-of-service`

## Nav & footer

- Header: `fabrica®` wordmark left; links Studio / Projects **27** (dynamic count) / Blog / Contact. Sticky. Mobile: hamburger → full-screen overlay (links + phone + email + legal + © line).
- Footer: newsletter input + Subscribe; phone `(312) 555-2468`; `hello@fabrica.com`; Navigation column; Social column (Twitter / Instagram / Dribbble); `© 2025 fabrica® Studio`; Privacy / Terms.

## Home sections (order)

1. **Hero** — giant `fabrica®` wordmark (letter-stagger reveal), "Studio" label, side service list (Branding and Identity / Social Media Marketing / Web Design and Development / SEO Optimization), H1 "No generic websites. No empty marketing promises. Just tools and strategies that help your business grow and your brand shine.", © line, CTA card w/ portrait video.
2. **Clients** — "Our clients (2016-25©)", 6-logo infinite marquee.
3. **Projects** — "(27) Projects. ©2025", 6 rows `Title./Year` (Boltshift/2025, Ephemeral/2025, Powersurge/2024, Mastermail/2024, Warpspeed/2023, CloudWatch/2020); hover reveals cover.
4. **Why choose us** — H2 "Proven results for every project, with a focus on design and functionality."; sticky left card (portrait + "Your digital journey begins with a conversation." + Let's talk); stats `50+` "Successful projects completed", `98%` "Customer satisfaction rate"; count-up on scroll.
5. **Services** — "What we do / Services. (4)" accordion, `(001)`–`(004)`, 3 thumbs, title, description, category tags, `6+` badge; one open at a time; ends w/ gradient bg + "Get started".
6. **About/Process** — "How we launch websites and marketing campaigns.", steps 01–04 with 77px thumbs, "Watch showreel (2016-25©)" full-width image → video overlay.
7. **Testimonials** — "Experiences. ©2025", `4.9 /5`, "We've delivered 56+ projects…", 4 stacked avatars + `56+ Trusted by clients worldwide`, "Leave a review", 3 cards (James Carter/Wilson & Co, Emily Davis/StartUp Hub, Anna Martinez/Marketing Director), then 4 count-up stats (Ad impressions `250m+`-style, projects, satisfaction, SEO visitors).
8. **Manifesto** — `fabrica®` word marquee + "Every project we take on is designed for long-term success." + two paragraphs.
9. **Case study** — "UX/UI Redesign, Frontend Optimization.", "Live website" link, "From branding to web development and marketing — We do it all.", phone mockup, metrics: "Page speed +48%, Bounce rate -23%", "4.2% → 5.9%", Angela Smith quote, `100` Pagespeed ring, bar chart "Quarterly visits +30%".
10. **Pricing** — Per project / Monthly toggle, `$2,490 /project`, `+$1,490` add-on line, features (Homepage + up to 4 inner pages / Design and Development / Mobile-Optimized Design / Delivery time 3-4 weeks), "Get in touch"; side card "Looking for more?" + George Stern, Client Success Manager.
11. **Team** — "The faces behind the projects.", "Be part of our mission" + Apply now (mailto), 4 portrait cards 375×540 (Lauren Thompson/Team Lead, Michael Wilson/Full Stack Developer, Sarah Johnson/Creative Director, Christopher Miller/UX-UI Designer), horizontal scroll.
12. **FAQ** — 6-item accordion (see entries in seed; first answer's "On averageю" typo fixed).
13. **Blog** — "Newest trends and insights from our team." + See all; 2 post cards (Feb 2 2025 / Jan 26 2025); side image "What's new in digital?".
14. **Contact** — form (Your name*, E-mail*, Message, Send Message) + consent line; right: "Let's talk." + "Quick response." / "Clear next steps." blurbs + CTA card.

## Inner pages

- **/studio**: "Studio." display; About us intro; stats row (same 4 counters); `fabrica®` manifesto; Awards list (Web Excellence Awards 2025 / Clutch 2024 / Awwwards 2024 / CSS Design Awards 2020); team; process; CTA.
- **/projects**: heading + full project list (same rows as home §3).
- **Project detail** (template): title/year hero, meta grid (Industry: Logistics & Supply Chain · Client: AeroLogix · Scope: Branding, Web design · Timeline: 12 weeks for Boltshift), cover, body, related projects, CTA.
- **/blog**: post list. **Post detail** (template): date, title, author (George Stern, Client Success Manager), cover, body, related post.
- **/contact**: "Get in touch." + form + phone/email + CTA card.
- **/legal/***: heading + paragraphs (placeholder legal text).

## Media

Reference media are framerusercontent CDN assets (portraits, project covers, logo SVGs, showreel, phone mockup, portrait video loop). Seed uses **remote picsum/placeholder URLs** — the builder's media library requires uploading through the running app (no seed-side import path); logged as a gap.

## Motion inventory (reference)

Letter-stagger hero reveal · scroll fade-up on headings/cards · count-up numbers · 2 marquees (logos, wordmark) · button hover label slide (stacked labels, translateY) · project-row hover image reveal · accordion height animation (one-open) · pricing state toggle · mobile overlay menu · showreel video overlay.
