import { test, expect, type Page } from '@playwright/test'

// The Layers tree — the surface that replaced the code editor.
//
// What matters here is what the editor was the ONLY way to do, and what no
// unit check reaches: moving an element INTO another container (the canvas
// drag has only ever offered before/after), naming a ref, and the keyboard
// route into the panels. Assertions land on the published export where they
// can, so this keeps its value through a reskin.
//
// Named to sort AFTER smoke.spec: smoke owns the first-run flow and needs a
// server with no admin account yet, so any spec that logs in has to run later.

const ADMIN = { email: 'smoke@example.com', password: 'supersecret1' }

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
  // `ready` flips BEFORE ?demo is fetched, so the shell is interactive while
  // the real project is still in flight — and resetTo would wipe anything
  // edited in that window. Wait for demo content to actually be on the canvas.
  await expect(page.getByText('Tuesday is roast day.').first()).toBeVisible({ timeout: 30_000 })
}

/**
 * Publish, waiting out the server's rate limit if the suite has hit it.
 *
 * A publish is a full Tailwind compile plus a static export, so the server
 * allows 12 a minute per user — plenty for a person, and less than a suite
 * that publishes in a dozen specs back to back. The limit is a real guard
 * against a runaway loop, so the test waits rather than the product relaxing.
 */
async function publish(page: Page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press('ControlOrMeta+p')
    const done = page.getByText('Published!')
    const failed = page.getByText('Publish failed')
    await expect(done.or(failed).first()).toBeVisible({ timeout: 60_000 })
    if (await done.isVisible()) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(20_000) // the window is 60s; three tries covers it
  }
  await expect(page.getByText('Published!')).toBeVisible({ timeout: 60_000 })
}

const rail = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const rows = (page: Page) => page.locator('[data-layer-row]')

/** a page's layers open from its Edit icon in the Pages drawer */
async function openLayers(page: Page, name = 'Home') {
  if (!(await page.getByPlaceholder('Search pages, items…').isVisible())) {
    // the Layers view may already be showing; Back returns to the list
    const back = page.getByRole('button', { name: 'Back' })
    if (await back.isVisible()) await back.click()
    else await rail(page, 'Pages').click()
  }
  const row = page.locator(`[data-page-row="${name}"]`)
  await row.hover()
  await row.getByRole('button', { name: 'Edit layers' }).click()
  await expect(rows(page).first()).toBeVisible({ timeout: 15_000 })
}

const componentRow = (page: Page, name: string) => page.locator(`[data-component="${name}"]`)

/** insert one element from the ⌘E dock at the current selection */
async function insertFromDock(page: Page, key: string) {
  await page.keyboard.press('ControlOrMeta+e')
  await page.locator(`[data-dock-item="${key}"]`).click()
  await page.keyboard.press('Escape')
}

/** drag one row onto another, landing in the given zone of the target row */
async function dragRow(page: Page, from: string, to: string, zone: 'before' | 'after' | 'inside') {
  const a = await page.locator(`[data-layer-row="${from}"]`).boundingBox()
  const b = await page.locator(`[data-layer-row="${to}"]`).boundingBox()
  if (!a || !b) throw new Error('row not found')
  const y = b.y + b.height * (zone === 'before' ? 0.1 : zone === 'after' ? 0.9 : 0.5)
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, y, { steps: 12 })
  await page.mouse.up()
}

/** the node id of the row at `index` */
const idAt = async (page: Page, index: number) =>
  (await rows(page).nth(index).getAttribute('data-layer-row'))!

test('the layers column lists the page and follows the canvas selection', async ({ page }) => {
  await openEditor(page)
  await openLayers(page)

  // the body is the root row, and the tree is deep enough to be real
  await expect(rows(page).first()).toContainText('body')
  expect(await rows(page).count()).toBeGreaterThan(5)

  // selecting on the canvas reveals and highlights the row
  await page.locator('[data-node-id]').nth(6).click()
  const id = await page.locator('[data-node-id]').nth(6).getAttribute('data-node-id')
  await expect(page.locator(`[data-layer-row="${id}"]`)).toHaveClass(/bg-accent\/30/)
})

test('dragging a row INTO a container re-parents it, and it publishes that way', async ({
  page,
}) => {
  await openEditor(page)
  await openLayers(page)

  // build a known shape at the end of the body: a section, then a heading
  // beside it (not inside it)
  await rows(page).first().click() // the body
  await insertFromDock(page, 'section')
  const sectionId = await idAt(page, (await rows(page).count()) - 1)
  await rows(page).first().click()
  await insertFromDock(page, 'heading')
  const headingId = await idAt(page, (await rows(page).count()) - 1)

  // they are siblings — the heading is NOT inside the section
  await expect(page.locator(`[data-layer-row="${sectionId}"]`)).toBeVisible()
  const depthOf = async (id: string) =>
    Number(
      (await page.locator(`[data-layer-row="${id}"]`).evaluate(
        (el) => (el as HTMLElement).style.paddingLeft,
      )).replace('px', ''),
    )
  expect(await depthOf(headingId)).toBe(await depthOf(sectionId))

  // re-parenting by dragging into the middle of a container: the one thing
  // only the code editor could do
  await dragRow(page, headingId, sectionId, 'inside')
  await expect
    .poll(async () => (await depthOf(headingId)) > (await depthOf(sectionId)))
    .toBe(true)

  await publish(page)
  await page.goto('/')
  // the published markup carries the nesting, so it really moved in the tree
  const nested = await page.locator('section').filter({ has: page.locator('h2') }).count()
  expect(nested).toBeGreaterThan(0)
})

test('a row names a ref, and refuses one already used on the page', async ({ page }) => {
  await openEditor(page)
  await openLayers(page)

  await rows(page).first().click()
  await insertFromDock(page, 'section')
  const first = await idAt(page, (await rows(page).count()) - 1)
  await rows(page).first().click()
  await insertFromDock(page, 'section')
  const second = await idAt(page, (await rows(page).count()) - 1)

  // Enter on the selected row opens the inline rename (the ref had no UI at
  // all before this — it could only be typed in code)
  await page.locator(`[data-layer-row="${first}"]`).dblclick()
  const input = page.locator(`[data-layer-row="${first}"] input`)
  await input.fill('hero')
  await input.press('Enter')
  await expect(page.locator(`[data-layer-row="${first}"]`)).toContainText('#hero')

  // the same ref twice on one page is refused, and says why
  await page.locator(`[data-layer-row="${second}"]`).dblclick()
  const dup = page.locator(`[data-layer-row="${second}"] input`)
  await dup.fill('hero')
  await dup.press('Enter')
  await expect(dup).toBeVisible() // still editing: the write was refused
  await expect(page.locator(`[data-layer-row="${second}"]`)).not.toContainText('#hero')
})

test('S, D and I open the panels for the selected row', async ({ page }) => {
  await openEditor(page)
  await openLayers(page)

  // the code editor's typed '(' / '[' / '{' were the only keyboard way in
  await rows(page).nth(3).click()
  await page.keyboard.press('s')
  await expect(page.getByText('CLASSES')).toBeVisible()
  // the panel opens with its input focused, so the next key is TYPED there —
  // Escape closes the panel and hands the keyboard back to the tree
  await expect(page.getByPlaceholder('Add class')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByText('CLASSES')).toBeHidden()
  await page.keyboard.press('i')
  await expect(page.getByRole('button', { name: 'Interactions', exact: true })).toHaveClass(
    /text-accent-foreground/,
  )
})

test('a component gains an element on the board, and its page instance follows', async ({
  page,
}) => {
  await openEditor(page)
  await openLayers(page)

  // put a Card on the page: an instance for the master edit to reach
  await rows(page).first().click()
  await insertFromDock(page, 'catalog:card')
  const pageRows = await rows(page).count()

  // edit the COMPONENT: expanding its row in the Components drawer shows its
  // layers. Structure there is the master's — pushed to every instance.
  await rail(page, 'Components').click()
  await componentRow(page, 'Card').locator('[data-row-toggle]').click()
  await expect(rows(page).first()).toBeVisible()
  const masterRows = await rows(page).count()

  await rows(page).first().click()
  await insertFromDock(page, 'paragraph')
  await expect(rows(page)).toHaveCount(masterRows + 1)

  // back on the page, the instance grew the same element
  await rail(page, 'App').click()
  await openLayers(page)
  await expect(rows(page)).toHaveCount(pageRows + 1)
})

test('removing an element from a component removes it from the page instance', async ({
  page,
}) => {
  await openEditor(page)
  await openLayers(page)
  await rows(page).first().click()
  await insertFromDock(page, 'catalog:alert')

  // delete the heading on the board — the instance on the page loses it too
  await rail(page, 'Components').click()
  await page.locator('[data-board-card]').filter({ hasText: 'Heads up' }).first()
    .getByText('Heads up').click()
  await page.keyboard.press('Backspace')

  await publish(page)
  await page.goto('/')
  await expect(page.getByText('Heads up')).toHaveCount(0)
  // the rest of the component survived
  await expect(page.getByText('Something worth knowing before you carry on.')).toBeVisible()
})

test('Pages and Components share one column; layers live inside each', async ({ page }) => {
  await openEditor(page)
  await openLayers(page)

  // the Layers view is a layer of the Pages drawer: Back returns to the list
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByPlaceholder('Search pages, items…')).toBeVisible()
  await expect(rows(page)).toHaveCount(0)

  // Components puts the board on the canvas AND takes the column
  await rail(page, 'Components').click()
  await expect(page.getByPlaceholder('Search components…')).toBeVisible()
  await expect(page.getByPlaceholder('Search pages, items…')).toBeHidden()
  await expect(page.locator('[data-board-card]').first()).toBeVisible()

  // a component's layers unfold under its row, library entries included
  await page.locator('[data-catalog="alert"] [data-row-toggle]').click()
  await expect(rows(page)).toHaveCount(3)

  // selecting on the board opens the component it belongs to
  await page.locator('[data-board-card="catalog:card"]').getByText('Card title').click()
  await expect(rows(page).filter({ hasText: 'Card title' })).toBeVisible()
})

test('a collection has settings: its fields and its URL', async ({ page }) => {
  await openEditor(page)
  await rail(page, 'Pages').click()

  const row = page.locator('[data-collection-row]').first()
  await row.hover()
  await row.getByRole('button').last().click() // the row kebab
  await page.getByRole('button', { name: 'Settings', exact: true }).click()

  // the demo's post collection carries its fields
  await expect(page.locator('[data-field="title"]')).toBeVisible()
  const before = await page.locator('[data-field]').count()
  await page.getByRole('button', { name: 'Add field' }).click()
  await expect(page.locator('[data-field]')).toHaveCount(before + 1)

  // the hint spells out where entries publish, and follows the prefix
  const prefix = page.locator('input[placeholder="post"]')
  await prefix.fill('journal')
  await prefix.press('Enter')
  await expect(page.getByText('/journal/my-entry')).toBeVisible()
})
