import { test, expect, type Page } from '@playwright/test'

// Authoring a slider end to end in the real editor: build it from the ⌘E dock
// and the Layers tree, watch the canvas build the track, configure it in the
// DATA panel (where every carousel setting lives), and publish.
//
// The two things worth a real browser here are the ones no unit check reaches:
// the Data panel writes a config that survives to the published site, and the
// canvas renders slides for a code-only element that the exporter agrees with.
// Assertions land on the published export rather than the panel's DOM, so this
// keeps its value through a reskin.
//
// Named to sort AFTER smoke.spec: smoke owns the first-run flow and needs a
// server with no admin account yet, so any spec that logs in has to run later
// (same reason store-agent-security.spec carries its own name).

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }

/** log in (or do first-run setup) and load the demo project */
async function openEditor(page: Page) {
  await page.goto('/admin/')
  const projectName = page.getByPlaceholder('Project name')
  const email = page.getByPlaceholder('Email')
  const preview = page.getByRole('button', { name: 'Preview' })
  await expect(projectName.or(email).or(preview).first()).toBeVisible({ timeout: 30_000 })

  if (await projectName.isVisible()) {
    await projectName.fill('Smoke Co')
    await email.fill(ADMIN.email)
    await page.getByPlaceholder('Password (min. 8 characters)').fill(ADMIN.password)
    await page.getByPlaceholder('Confirm password').fill(ADMIN.password)
    await page.getByRole('button', { name: 'Setup project' }).click()
  } else if (await email.isVisible()) {
    await email.fill(ADMIN.email)
    await page.getByPlaceholder('Password', { exact: true }).fill(ADMIN.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
  }
  await page.waitForURL(/\/admin(\?.*)?$/, { timeout: 30_000 })
  await page.goto('/admin?demo')
  await expect(preview).toBeVisible({ timeout: 30_000 })
}

async function publish(page: Page) {
  await page.keyboard.press('ControlOrMeta+p')
  await expect(page.getByText('Published!')).toBeVisible({ timeout: 30_000 })
}

/** insert one element from the ⌘E dock at the current selection */
async function insertFromDock(page: Page, key: string) {
  await page.keyboard.press('ControlOrMeta+e')
  await page.locator(`[data-dock-item="${key}"]`).click()
  await page.keyboard.press('Escape')
}

/** append a three-slide manual slider to the end of the page body */
async function writeSlider(page: Page) {
  // the Layers tree is where structure is authored and where the insert point
  // is chosen: an insert lands in the selection, so the slider has to be
  // re-selected between slides (each new div is selected as it lands).
  await page.getByRole('button', { name: 'Layers', exact: true }).click()
  const bodyRow = page.locator('[data-layer-row]').first()
  await bodyRow.click()
  await insertFromDock(page, 'slider')

  const sliderRow = page.locator('[data-layer-row]').filter({ hasText: 'slider' }).first()
  await expect(sliderRow).toBeVisible({ timeout: 15_000 })
  for (let i = 0; i < 3; i++) {
    await sliderRow.click()
    await insertFromDock(page, 'div')
    // the new div is the selection, so this lands inside it — and gives the
    // slide some height, without which the track measures zero
    await insertFromDock(page, 'heading')
  }
  // the canvas renders from the parsed tree, so this proves the structure took
  await expect(page.locator('[data-sl-track]').first()).toBeVisible({ timeout: 15_000 })
}

test('author a slider in code, configure it in the Data panel, and publish it', async ({ page }) => {
  await openEditor(page)
  await writeSlider(page)

  // the canvas builds one slide per child block, with the built-in chrome.
  // Scoped to ONE frame — the canvas renders the page once per breakpoint.
  const canvasSlider = page.locator('[data-node-id]:has(> [data-sl-track])').first()
  await expect(canvasSlider.locator('[data-sl-slide]')).toHaveCount(3)
  await expect(canvasSlider.locator('[data-sl-prev]')).toBeVisible()
  // the canvas paints its own dot rail: one per reachable position
  await expect(canvasSlider.locator('[data-sl-dots] > *')).toHaveCount(3)

  // select the slider on the canvas, then open the Data panel (Paperclip).
  // The arrow belongs to the slider host itself, so clicking it selects the
  // slider rather than whichever child sits under an arbitrary point.
  await canvasSlider.locator('[data-sl-prev]').click()
  await page.getByRole('button', { name: 'Data', exact: true }).click()

  // every carousel setting lives in the Data panel's Slider group
  const dotsRow = page.locator('div').filter({ hasText: /^Dots$/ }).last()
  await expect(dotsRow).toBeVisible({ timeout: 15_000 })
  await dotsRow.getByRole('switch').click()
  // the canvas reflects it immediately
  await expect(page.locator('[data-sl-dots]')).toHaveCount(0)

  await publish(page)
  await page.goto('/')

  // the config reached the published site: three slides, no dot rail, and the
  // runtime that drives them
  await expect(page.locator('[data-sl-slide]')).toHaveCount(3)
  await expect(page.locator('[data-sl-dots]')).toHaveCount(0)
  await expect(page.locator('[data-sl-next]')).toBeVisible()
  expect(await page.content()).toContain('/assets/slider.js')

  // and it actually moves
  const at = () =>
    page.evaluate(() => {
      const track = document.querySelector('[data-sl-track]') as HTMLElement
      return track.scrollLeft
    })
  expect(await at()).toBe(0)
  await page.locator('[data-sl-next]').click()
  await expect.poll(at).toBeGreaterThan(0)
})
