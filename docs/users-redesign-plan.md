# Users & Invites Redesign — Implementation Plan

Status: complete — S1–S5 implemented and verified (2026-08-22).
Decisions locked (2026-08-22): stays a Settings tab (rebuilt as one table + invite sub-dialog), copy-link only (no email), pending invites fully manageable (copy anytime / regenerate / edit role / extend expiry), role dropdown with descriptions + demote confirms, remove = confirm + kill sessions, project-branded accept page, 3-role model unchanged, member list visible to all roles (controls admin-only), invite success step with big one-click copy.

---

## 1. The redesigned tab (one table, `UsersSettings.vue` rebuilt)

```
┌─ Users ──────────────────────────────  [+ Invite] ┐
│ ● Jhon Bonjobie (you)  test@test.com    Admin ▾  ⋯ │
│ ● testtest te          test3@test.com   Contrib ▾ ⋯ │
│ ○ sam@studio.co · invited · 6d left     Editor ▾  ⋯ │   ← pending: dimmed row
└────────────────────────────────────────────────────┘
```

- **Members and pending invites in the same table.** Pending rows render dimmed
  with an "invited · Nd left" badge. Sorted: you first, then members, then pending.
- **Member row**: name + email, role `SelectUI` whose options carry descriptions
  ("Admin — full control incl. users & publish", "Editor — builds pages, can
  publish", "Contributor — edits content and comments"), `⋯` menu (DropdownUI)
  with **Remove…**.
- **Pending row**: role select (PATCHes the invite), `⋯` menu with **Copy link**,
  **Regenerate link…** (confirm: old link stops working), **Extend expiry**
  (+7 days), **Revoke…**.
- **Role-change guards** (ConfirmModal): demoting yourself ("You'll lose admin
  access"), demoting the last admin is blocked server-side and surfaced clearly.
- **Remove flow**: ConfirmModal "Remove {name}? They lose access immediately."
  → server deletes the user **and destroys their sessions**
  (`destroyUserSessions` already exists in auth.mjs — wire it into `deleteUser`).
- **Non-admin view**: the same table, read-only — no Invite button, no selects,
  no menus. Needs the read-only members endpoint (§3).
- Errors surface inline per-action (row-level), not a single global line.

## 2. Invite dialog (two-step, `InviteDialog.vue`, ModalDialog `default` size)

Step 1 — form: Name / Email / Role (with descriptions), `Create invite link`.
Validation inline (email format, duplicate member/invite → friendly message).

Step 2 — success:

```
✓ sam@studio.co · Editor
[ 🔗  Copy invite link ]      ← large, one-click, "Copied ✓" feedback
Works once · expires in 7 days.
You can copy it again from the members list anytime.
[Invite another]   [Done]
```

## 3. Server changes (`server/auth.mjs` + `server/index.mjs`)

The core enabler: **the invite link must be retrievable after creation.**
Today only a hash of the token is stored, so:

- Store the raw token on the invite record (in `invites.json`). Trade-off,
  accepted: invites are single-use, short-lived, low-privilege credentials;
  disclosure of the server file already means game over for `users.json`
  scrypt hashes' neighbors. Keep the hashed lookup path for acceptance
  (constant behavior), add `linkFor(invite)` for the admin API.
- **`GET /api/users`** (admin): invites gain `link` in the response
  (`inviteView` extended, admin responses only).
- **`GET /api/users/members`** (new, any authed role): `{ users: [{id, name,
  email, role}], invites: [{email, role, expiresAt}] }` — a redacted,
  read-only view (no links, no ids beyond what the table needs) so every role
  can see who's on the project.
- **`PATCH /api/users/invite/:id`** (new, admin): `{role?}` edit,
  `{extend: true}` → `expiresAt += 7d`, `{regenerate: true}` → new token +
  fresh expiry, old token dead; response includes the new `link`.
- **`DELETE /api/users/:id`**: also `destroyUserSessions(id)` — removed
  members are logged out everywhere immediately.
- **`GET /api/invite/:token`** (public, accept page): response gains
  `projectName` (read from the store's main-branch project blob) and
  `invitedBy` (store the inviting admin's name on the invite at creation).
- All new mutations are already covered by the global Origin gate; invite
  routes keep their existing rate limiter.

## 4. Accept page (`SetPasswordView.vue` rebuilt)

Project-branded welcome (per decision — name editing and role explainer were
explicitly not chosen):

```
{Project name}
{InvitedBy} invited you to join as {Role}.
[password field + confirm]         [Join project]
```

Same route, same single-use token mechanics; purely presentational + the two
new fields from `GET /api/invite/:token`.

## 5. Client data layer (`useUsers.ts`)

- `load()` branches by role: admins hit `/api/users` (full, with links);
  everyone else hits `/api/users/members` (redacted). Same refs feed the table.
- New: `updateInvite(id, patch)` (role/extend/regenerate → returns fresh link),
  `inviteLinkOf(id)` from the loaded list.
- `invite()` keeps returning the link for the success step.

## 6. Sequencing

1. **S1 — server**: raw-token storage + `linkFor`, invite PATCH
   (role/extend/regenerate), members endpoint, sessions-on-delete,
   `projectName`/`invitedBy` in the public invite view. Curl-verify incl.
   negatives (non-admin hits `/api/users` → 403, members endpoint redacts
   links, regenerated old token → 404, deleted user's cookie → 401).
2. **S2 — tab rebuild**: table + row menus + role descriptions + confirms
   (reuse ConfirmModal), read-only variant for non-admins.
3. **S3 — invite dialog**: two-step flow with success screen.
4. **S4 — accept page**: branded welcome.
5. **S5 — verify**: headless-Chrome drive of invite → copy → accept in a
   second browser context → new member appears; remove → their session dies.

## 7. Out of scope (explicitly)

Email delivery (copy-link decision), avatars, granular permissions, editor-
delegated inviting, soft-deactivate. The contributor structural-write gap
stays as documented in `security-structural-enforcement.md`.
