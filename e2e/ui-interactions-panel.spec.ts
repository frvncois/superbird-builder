import { test, expect, type Page } from '@playwright/test'
import { loadFixture } from './fixtures/project'

// The Interactions panel and the effects drawer. Seven paths, each chosen
// because it protects against SILENT data loss or a lie that type-checking
// can't see: a cancelled create leaving a half-discarded effect behind; an edit
// to a shared effect not reaching the elements that use it; a dismissal written
// to two bindings when the runtime folds them into one; a timeline that two
// buttons cannot agree on; an effect that needs both engines arriving as half of
// itself; and the drawer eating the Escape that belongs to the panel.
//
// The first three assert on the PUBLISHED EXPORT rather than the panel's own
// DOM, so they keep their value through a reskin.
//
// Named to sort AFTER smoke.spec: smoke owns the first-run flow and needs a
// server with no admin account yet, so any spec that logs in has to run later
// (same reason store-agent-security.spec carries its own name).

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }

/** log in (or do first-run setup) and load the demo project. Whether this run
 * lands on setup or login depends on test order and whether the data dir was
 * wiped, so wait for whichever form actually arrives — the guard redirects
 * after boot, so the URL right after goto() is not yet the answer. */
async function openEditor(page: Page) {
  await page.goto('/admin/')
  const projectName = page.getByPlaceholder('Project name')
  const email = page.getByPlaceholder('Email')
  const ready = page.getByRole('button', { name: 'Pages', exact: true })
  await expect(projectName.or(email).or(ready).first()).toBeVisible({ timeout: 30_000 })

  if (await projectName.isVisible()) {
    await projectName.fill('Smoke Co')
    await email.fill(ADMIN.email)
    await page.getByPlaceholder('Password (min. 8 characters)').fill(ADMIN.password)
    await page.getByPlaceholder('Confirm password').fill(ADMIN.password)
    await page.getByRole('button', { name: 'Setup project' }).click()
  } else if (await email.isVisible()) {
    await email.fill(ADMIN.email)
    // the login form's placeholder is the bare word; setup's carries the rule
    await page.getByPlaceholder('Password', { exact: true }).fill(ADMIN.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
  }
  await page.waitForURL(/\/admin(\?.*)?$/, { timeout: 30_000 })
  await loadFixture(page)
  await expect(ready).toBeVisible({ timeout: 30_000 })
}

/** the right rail's Interactions button is icon-only (Zap) */
async function openPanel(page: Page) {
  await page.getByRole('button', { name: 'Interactions', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Trigger', exact: true })).toBeVisible()
}

/** "+ Trigger" → a section for that trigger, with its action picker already open */
async function addTrigger(page: Page, label: RegExp) {
  await page.getByRole('button', { name: 'Trigger', exact: true }).click()
  await page.getByRole('button', { name: label }).first().click()
  await expect(picker(page)).toBeVisible()
}

const picker = (page: Page) => page.locator('[data-action-picker]')
const drawer = (page: Page) => page.locator('[data-effects-drawer]')
const actionRows = (page: Page) => page.locator('[data-binding-row]')
const stateCards = (page: Page) => page.locator('[data-state-card]')
const libraryRows = (page: Page) => page.locator('[data-effect-row]')

/** a publish is rate-limited to 12/min server-side and this suite exceeds it
 *  across its specs, so wait the window out rather than relaxing a real guard */
async function publish(page: Page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press('ControlOrMeta+p')
    const done = page.getByText('Published!')
    const failed = page.getByText('Publish failed')
    await expect(done.or(failed).first()).toBeVisible({ timeout: 60_000 })
    if (await done.isVisible()) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(20_000)
  }
  await expect(page.getByText('Published!')).toBeVisible({ timeout: 60_000 })
}

test('a new effect opens in the drawer, and Cancel discards it completely', async ({ page }) => {
  await openEditor(page)
  await openPanel(page)

  const effectsBefore = await (async () => {
    await page.keyboard.press('ControlOrMeta+Shift+e')
    await expect(drawer(page)).toBeVisible()
    const n = await libraryRows(page).count()
    await page.keyboard.press('ControlOrMeta+Shift+e')
    await expect(drawer(page)).toBeHidden()
    return n
  })()

  await addTrigger(page, /^Click/)
  await picker(page).getByRole('button', { name: 'Style change' }).click()

  // the drawer opens on the new effect and the panel KEEPS its context — the
  // element, its trigger and the action that was just added are all still there
  await expect(drawer(page)).toBeVisible()
  await expect(page.getByText('On click')).toBeVisible()
  await expect(actionRows(page)).toHaveCount(1)

  // give it a class, so a half-discard would leave a visible trace
  const marker = 'outline-dashed'
  await drawer(page).getByPlaceholder('Add class').fill(marker)
  await page.keyboard.press('Enter')

  await drawer(page).getByRole('button', { name: 'Cancel' }).click()

  // the cascading delete took the binding with it. One that removed the library
  // entry but orphaned the binding would leave a row behind.
  await expect(actionRows(page)).toHaveCount(0)
  await expect(libraryRows(page)).toHaveCount(effectsBefore)

  // and the discarded class never reaches the published site
  await publish(page)
  await page.goto('/')
  expect(await page.content()).not.toContain(marker)
})

test('an effect added from the picker is editable in the drawer, and ⋯ removes it', async ({
  page,
}) => {
  await openEditor(page)
  await openPanel(page)

  // the picker offers the project's saved effects without ever naming an engine
  await addTrigger(page, /^Hover/)
  const saved = picker(page).locator('[data-saved-effect]').filter({ hasText: 'Card lift' })
  await saved.getByRole('button', { name: 'Add' }).click()

  await expect(page.getByText('On hover')).toBeVisible()
  await expect(actionRows(page)).toHaveCount(1)
  // a symmetric effect on itself has no state to manage, so it stays one row
  // and the panel does not say the same thing twice
  await expect(stateCards(page)).toHaveCount(0)

  // ⋯ → Edit effect opens the drawer on the SHARED effect
  await actionRows(page).getByRole('button', { name: 'Action options' }).click()
  await page.getByRole('button', { name: 'Edit effect' }).click()
  await expect(drawer(page)).toBeVisible()

  const marker = 'ring-offset-4'
  await drawer(page).getByPlaceholder('Add class').fill(marker)
  await page.keyboard.press('Enter')

  // ⋯ → Remove takes the action off THIS element…
  await actionRows(page).getByRole('button', { name: 'Action options' }).click()
  await page.getByRole('button', { name: 'Remove' }).click()
  await expect(actionRows(page)).toHaveCount(0)

  // …while the edit to the shared effect still reaches the four fixture
  // elements that were already bound to it and were never touched here
  await publish(page)
  await page.goto('/')
  expect(await page.content()).toContain(marker)
})

test('two triggers drive one state, and its dismissal is stored once', async ({ page }) => {
  await openEditor(page)
  await openPanel(page)

  // an open action…
  await addTrigger(page, /^Click/)
  await picker(page).getByRole('button', { name: 'Style change' }).click()
  // name it, so the picker's state list can be addressed by what it is called
  // rather than by position — the list holds every state already on the page
  await drawer(page).getByPlaceholder('Effect name').fill('Panel open')
  await drawer(page).getByPlaceholder('Add class').fill('opacity-50')
  await page.keyboard.press('Enter')
  await drawer(page).getByRole('button', { name: 'Done' }).click()

  // …and a close action on the SAME state, offered by the picker because the
  // state already exists on the page
  await page.getByRole('button', { name: 'action', exact: true }).click()
  await picker(page)
    .locator('[data-state-option]')
    .filter({ hasText: 'Panel open' })
    .getByRole('button', { name: 'Close' })
    .click()
  await expect(actionRows(page)).toHaveCount(2)

  // one card for the one state, however many triggers drive it
  await expect(stateCards(page)).toHaveCount(1)
  await stateCards(page).getByRole('button', { name: 'Escape' }).click()

  await publish(page)
  await page.goto('/')

  // the export is the referee: both bindings ride on the body, and exactly ONE
  // of them carries the dismissal. Written to both, the runtime would arm it
  // twice — and the panel would be showing a union it cannot write back.
  const metas = await page.evaluate(() =>
    JSON.parse(document.body.getAttribute('data-int') || '[]'),
  )
  expect(metas).toHaveLength(2)
  const dismissing = metas.filter((m: { c?: string[] }) => m.c)
  expect(dismissing).toHaveLength(1)
  expect(dismissing[0].c).toEqual(['escape'])
  // …and both bindings drive the SAME state key, which is what makes an open
  // button and a close button agree
  expect(new Set(metas.map((m: { s: string }) => m.s)).size).toBe(1)
})

test('the drawer opens with ⌘⇧E and Escape closes it without closing the panel', async ({
  page,
}) => {
  await openEditor(page)
  await openPanel(page)

  await page.keyboard.press('ControlOrMeta+Shift+e')
  await expect(drawer(page)).toBeVisible()

  // Escape peels ONE layer: the drawer goes, the panel stays. Letting it bubble
  // would close the panel too and throw focus back to the Layers tree.
  await page.keyboard.press('Escape')
  await expect(drawer(page)).toBeHidden()
  await expect(page.getByRole('button', { name: 'Trigger', exact: true })).toBeVisible()

  // a second Escape is the panel's own
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Trigger', exact: true })).toBeHidden()
})

test('several buttons drive one timeline, aimed with a verb', async ({ page }) => {
  await openEditor(page)
  await openPanel(page)

  // a motion effect on click — the picker never says "animation", only what the
  // effect does
  await addTrigger(page, /^Click/)
  await picker(page).getByRole('button', { name: 'Motion' }).click()
  await drawer(page).getByPlaceholder('Effect name').fill('Panel fade')
  await drawer(page).getByRole('button', { name: 'Done' }).click()
  await expect(actionRows(page)).toHaveCount(1)

  // the timeline is now a state on this page, so the picker offers to join it
  // in either direction — the gesture that builds an animated panel
  const joinState = async (verb: string) => {
    await page.getByRole('button', { name: 'action', exact: true }).click()
    await picker(page)
      .locator('[data-state-option]')
      .filter({ hasText: 'Panel fade' })
      .getByRole('button', { name: verb, exact: true })
      .click()
  }
  await joinState('Open')
  await joinState('Close')
  await expect(actionRows(page)).toHaveCount(3)

  // a timeline several triggers share is a state, exactly like a class change
  await expect(stateCards(page)).toHaveCount(1)

  await publish(page)
  await page.goto('/')

  const metas = await page.evaluate(() =>
    JSON.parse(document.body.getAttribute('data-anim') || '[]'),
  )
  expect(metas).toHaveLength(3)
  // ONE play key for the three of them: that is what lets the close button
  // rewind what the open button ran, instead of starting a play of its own
  expect(new Set(metas.map((m: { s: string }) => m.s)).size).toBe(1)
  // Array.sort puts undefined last whatever the comparator — the toggle default
  expect(metas.map((m: { ac?: string }) => m.ac).sort()).toEqual(['off', 'on', undefined])
})

test('one effect wears both engines, and binds as one action', async ({ page }) => {
  await openEditor(page)
  await openPanel(page)

  // a style change, then motion on the SAME effect. A sliding panel needs both:
  // `hidden` → `flex` is the only way to switch display, and no class swap
  // expresses the slide — but that split is ours, not the author's.
  await addTrigger(page, /^Click/)
  await picker(page).getByRole('button', { name: 'Style change' }).click()
  await drawer(page).getByPlaceholder('Effect name').fill('Sheet')
  await drawer(page).getByPlaceholder('Add class').fill('flex')
  await page.keyboard.press('Enter')
  await drawer(page).getByRole('button', { name: 'Add motion' }).click()
  await drawer(page).getByRole('button', { name: 'Done' }).click()

  // ONE row, not two: the pair is recognised from the bindings themselves
  await expect(actionRows(page)).toHaveCount(1)
  await expect(actionRows(page)).toContainText('Sheet')

  // and the library lists one effect, not one per engine
  await expect(libraryRows(page).filter({ hasText: 'Sheet' })).toHaveCount(1)

  await publish(page)
  await page.goto('/')

  // both halves landed on the body, agreeing on when and where — a pair whose
  // halves fired at different moments would simply be broken
  const landed = await page.evaluate(() => ({
    classes: JSON.parse(document.body.getAttribute('data-int') || '[]'),
    motion: JSON.parse(document.body.getAttribute('data-anim') || '[]'),
  }))
  expect(landed.classes).toHaveLength(1)
  expect(landed.motion).toHaveLength(1)
  expect(landed.classes[0].t).toBe('click')
  expect(landed.motion[0].t).toBe('click')
})

test('an effect that predates the pairing can still gain the other engine', async ({ page }) => {
  await openEditor(page)
  await openPanel(page)

  // the fixture's effects were made before an effect could hold both engines —
  // the same shape a motion preset or an agent produces. Opening one must offer
  // the missing half, or the feature would only ever apply to new work.
  await page.keyboard.press('ControlOrMeta+Shift+e')
  await libraryRows(page).filter({ hasText: 'Card lift' }).first().click()
  await drawer(page).getByRole('button', { name: 'Add motion' }).click()

  // now it is one effect with two halves, and the library still lists it once
  await expect(drawer(page).locator('[data-effect-half="interaction"]')).toBeVisible()
  await expect(drawer(page).locator('[data-effect-half="animation"]')).toBeVisible()
  await expect(libraryRows(page).filter({ hasText: 'Card lift' })).toHaveCount(1)

  await publish(page)
  await page.goto('/')

  // and the four fixture elements already using it gained the timeline too —
  // a half that applied only to the next placement would be the silent no-op
  const moved = await page.evaluate(
    () => document.querySelectorAll('[data-anim]').length,
  )
  expect(moved).toBeGreaterThan(0)
})
