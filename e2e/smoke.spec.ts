import { test, expect } from '@playwright/test'

// End-to-end smoke: first-run setup → load the demo project → edit a text
// node in content mode → publish → assert the edit on the published route →
// assert the admin route redirects to login when logged out. Runs against an
// isolated server (see playwright.config.ts). Not a suite — one happy path
// plus the auth guard.

test('setup, edit content, publish, view live, auth guard', async ({ page, context }) => {
  const marker = `SMOKE-${Date.now()}`

  // 1. fresh server has no admin → /admin redirects to first-run setup
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/admin\/setup/)

  // 2. create the first admin (this logs us in and hard-redirects to /admin)
  await page.getByPlaceholder('Project name').fill('Smoke Co')
  await page.getByPlaceholder('Email').fill('smoke@example.com')
  await page.getByPlaceholder('Password (min. 8 characters)').fill('supersecret1')
  await page.getByPlaceholder('Confirm password').fill('supersecret1')
  await page.getByRole('button', { name: 'Setup project' }).click()
  await page.waitForURL(/\/admin(\?.*)?$/, { timeout: 30_000 })

  // 3. load the demo project (the only content fixture) — resets the project
  //    in memory to the published "Brume" coffee site
  await page.goto('/admin?demo')

  // 4. edit the home page's hero heading in content mode
  await page.getByRole('button', { name: 'Content' }).click()
  const hero = page.locator('h1', { hasText: 'Coffee roasted' }).first()
  await expect(hero).toBeVisible({ timeout: 30_000 })
  // dispatch the dblclick directly: a decorative hero layer sits over the h1
  // and would intercept a real pointer dblclick. This fires the same Vue
  // handler, which mounts a focused contenteditable span with all text selected.
  await hero.dispatchEvent('dblclick')
  const editSpan = page.locator('span[contenteditable]')
  await expect(editSpan).toBeFocused()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(marker)
  await page.keyboard.press('Escape') // content-mode inline edit saves on Escape
  await expect(page.locator('h1', { hasText: marker }).first()).toBeVisible()

  // 5. publish (the dialog auto-runs the publish on open)
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByText('Published!')).toBeVisible({ timeout: 30_000 })

  // 6. the published static route carries the edited text
  await page.goto('/')
  await expect(page.locator('body')).toContainText(marker)

  // 7. logged out, the admin route redirects to login (a user now exists)
  await context.clearCookies()
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/admin\/login/, { timeout: 30_000 })
})
