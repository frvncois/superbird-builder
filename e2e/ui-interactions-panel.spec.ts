import { test, expect, type Page } from '@playwright/test'
import { loadFixture } from './fixtures/project'

// The Interactions panel's focused create/edit view. Two paths, both chosen
// because they protect against SILENT data loss that type-checking can't see:
// a cancelled create leaving a half-discarded effect behind, and an edit to a
// shared effect not reaching the elements that actually use it.
//
// Both assert on the PUBLISHED EXPORT rather than the panel's own DOM, so they
// keep their value through a reskin.
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
  await expect(page.getByText('On this element')).toBeVisible()
}

/** the libraries live in the Add chooser, one level down from the list */
async function openChooser(page: Page) {
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('Interaction library')).toBeVisible()
}

const bindingRows = (page: Page) => page.locator('[data-binding-row]')

async function publish(page: Page) {
  await page.keyboard.press('ControlOrMeta+p')
  await expect(page.getByText('Published!')).toBeVisible({ timeout: 30_000 })
}

const libraryRows = (page: Page) =>
  page.getByRole('button', { name: /^(Rise in|Card lift|State layer|Interaction \d+)$/ })

test('create in the focused view, and cancel discards it completely', async ({ page }) => {
  await openEditor(page)
  await openPanel(page)

  const rowsBefore = await bindingRows(page).count()
  await openChooser(page)
  const before = await libraryRows(page).count()

  await page.getByRole('button', { name: 'New interaction' }).click()

  // the focused view owns the panel: no libraries, no per-element rows behind it
  await expect(page.getByText('Interaction library')).toBeHidden()
  await expect(page.getByText('Animation library')).toBeHidden()
  await expect(page.getByText('On this element')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible()

  // give it a class, so a half-discard would leave a visible trace
  const marker = 'outline-dashed'
  await page.getByPlaceholder('Add class').fill(marker)
  await page.keyboard.press('Enter')

  await page.getByRole('button', { name: 'Cancel' }).click()

  // back on the list, and the binding New auto-applied is gone. A cascade that
  // removed the library entry but orphaned the binding would show a row here.
  await expect(page.getByText('On this element')).toBeVisible()
  await expect(bindingRows(page)).toHaveCount(rowsBefore)
  // …and the effect is gone from the library
  await openChooser(page)
  await expect(libraryRows(page)).toHaveCount(before)
  await page.getByRole('button', { name: 'Back' }).click()

  // the discarded class never reaches the published site
  await publish(page)
  await page.goto('/')
  await expect(page.locator('body')).not.toContainText(marker)
  expect(await page.content()).not.toContain(marker)
})

test('edit a shared effect from the library, and apply needs a selection', async ({ page }) => {
  await openEditor(page)
  await openPanel(page)

  // create one and keep it — it auto-applies to the current selection, and
  // the row it made comes back open, Edit in hand
  const rowsBefore = await bindingRows(page).count()
  await openChooser(page)
  await page.getByRole('button', { name: 'New interaction' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('On this element')).toBeVisible()
  await expect(bindingRows(page)).toHaveCount(rowsBefore + 1)
  await expect(page.getByRole('button', { name: 'Edit interaction' })).toHaveCount(1)

  // reach it the way the library does — by clicking its NAME in the chooser,
  // which is the only route to an effect that isn't applied to what's selected
  await openChooser(page)
  const row = libraryRows(page).filter({ hasText: /^Interaction \d+$/ }).first()
  await row.click()

  // edit mode: Back and Delete, no create-mode footer
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0)

  const marker = 'ring-offset-4'
  await page.getByPlaceholder('Add class').fill(marker)
  await page.keyboard.press('Enter')
  // Back returns to where the edit started: the chooser
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByText('Interaction library')).toBeVisible()

  // the edit reached the element the effect is bound to
  await publish(page)
  await page.goto('/')
  expect(await page.content()).toContain(marker)
})
