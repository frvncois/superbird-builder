import { test, expect, type Page } from '@playwright/test'
import { loadFixture } from './fixtures/project'

// The Components column: the shared-slot rail behaviour, the components board
// it puts on the canvas, and the bundled library's round trip — use an entry on
// a page, publish, and check the real exported page.
//
// The interactive entries are the reason this spec exists. Tabs and Dialog are
// built out of class-toggle interactions with groups and forced on/off states,
// wired by data in src/lib/catalog; nothing short of driving the published page
// proves that wiring is right. The headless catalog gate checks every entry is
// well-formed — it cannot tell you a click shows the right panel.
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
  await loadFixture(page)
  await expect(preview).toBeVisible({ timeout: 30_000 })
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

/** the drawer's rows carry stable hooks — `data-catalog` in the Library,
 *  `data-component` under Project — so these don't hang off class strings */
const libraryRow = (page: Page, key: string) => page.locator(`[data-catalog="${key}"]`)
const projectRow = (page: Page, name: string) => page.locator(`[data-component="${name}"]`)

const boardCard = (page: Page, key: string) => page.locator(`[data-board-card="${key}"]`)

/** insert a library entry on the home page from the ⌘E dock. There is no
 *  separate "add" step — using an entry is what copies it into the project */
async function insertFromLibrary(page: Page, key: string) {
  await page.keyboard.press('ControlOrMeta+e')
  await page.locator(`[data-dock-item="catalog:${key}"]`).click()
  await page.keyboard.press('Escape')
}

test('the three left columns share one slot', async ({ page }) => {
  await openEditor(page)

  await rail(page, 'Components').click()
  await expect(page.getByPlaceholder('Search components…')).toBeVisible()

  // opening Pages takes the slot from Components
  await rail(page, 'Pages').click()
  await expect(page.getByPlaceholder('Search pages, items…')).toBeVisible()
  await expect(page.getByPlaceholder('Search components…')).toBeHidden()

  // and Components takes it back
  await rail(page, 'Components').click()
  await expect(page.getByPlaceholder('Search components…')).toBeVisible()
  await expect(page.getByPlaceholder('Search pages, items…')).toBeHidden()

  // the App button closes whatever holds it
  await page.getByRole('button', { name: 'App', exact: true }).click()
  await expect(page.getByPlaceholder('Search components…')).toBeHidden()
})

test('the board shows every component, and editing a library one adds it', async ({ page }) => {
  await openEditor(page)
  await rail(page, 'Components').click()

  // library entries are on the board without having been added
  const card = boardCard(page, 'catalog:card')
  await expect(boardCard(page, 'catalog:button')).toBeVisible()
  await expect(projectRow(page, 'Card')).toHaveCount(0)

  // a drawer row moves the camera to its card — the board is an infinite
  // canvas, so anything off-screen is reached this way (or by panning)
  await libraryRow(page, 'tabs').locator('[data-row-main]').click()
  await expect(boardCard(page, 'catalog:tabs')).toBeInViewport()
  await libraryRow(page, 'button').locator('[data-row-main]').click()
  await expect(boardCard(page, 'catalog:button')).toBeInViewport()

  // looking is not editing: selecting an element and opening the Style panel
  // must leave a library entry out of the project. (It used to add it — the
  // panel wrote a stray `flex` beside `inline-flex` just for being opened.)
  const button = boardCard(page, 'catalog:button')
  await button.locator('button').click() // the rendered element, not the card label
  await page.getByRole('button', { name: 'Style', exact: true }).click()
  await expect(page.getByText('CLASSES')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(button).toHaveCount(1)
  await expect(projectRow(page, 'Button')).toHaveCount(0)

  // editing it in place is what copies it into the project
  await libraryRow(page, 'card').locator('[data-row-main]').click()
  await expect(card).toBeInViewport()
  const title = card.getByText('Card title')
  await title.dblclick()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Edited on the board')
  await page.keyboard.press('Enter')

  await expect(projectRow(page, 'Card')).toHaveCount(1)
  await expect(boardCard(page, 'catalog:card')).toHaveCount(0)
  // (twice: on the board, and in the component's now-open layers in the drawer)
  await expect(page.getByText('Edited on the board').first()).toBeVisible()

  // and the edit is the component's: an instance on a page carries it
  await page.getByRole('button', { name: 'App', exact: true }).click()
  await page.keyboard.press('ControlOrMeta+e')
  await page.locator('[data-dock-item^="component:"]', { hasText: 'Card' }).click()
  await page.keyboard.press('Escape')
  await publish(page)
  await page.goto('/')
  await expect(page.getByText('Edited on the board')).toBeVisible()
})

test('a library button reaches the published page, styled by a created token', async ({ page }) => {
  await openEditor(page)
  await insertFromLibrary(page, 'button')

  // using it added it: it is a project component now
  await rail(page, 'Components').click()
  await expect(projectRow(page, 'Button')).toHaveCount(1)
  // …and has left the Library, which lists only what the project lacks
  await expect(libraryRow(page, 'button')).toHaveCount(0)

  await publish(page)
  await page.goto('/')

  const button = page.locator('button', { hasText: 'Button' }).first()
  await expect(button).toBeVisible()
  await expect(button).toHaveClass(/text-primary-foreground/)
  // both halves of the token rule, in one element:
  // · the demo already defines `primary` (#6750A4) — adding a library entry
  //   must adopt the project's palette, never overwrite it with the default
  await expect(button).toHaveCSS('background-color', 'rgb(103, 80, 164)')
  // · it does NOT define `primary-foreground`, so that one was created from the
  //   catalog default and compiled into the published stylesheet
  await expect(button).toHaveCSS('color', 'rgb(250, 250, 250)')
})

test('Tabs: clicking a tab swaps the panel, and tab one restores the default', async ({ page }) => {
  await openEditor(page)
  await insertFromLibrary(page, 'tabs')
  await publish(page)
  await page.goto('/')

  const first = page.getByText('The first panel is the one visible before anything is clicked.')
  const second = page.getByText('The second panel. Clicking its tab hides the others.')
  const third = page.getByText('The third panel, same again.')

  // panel 1 is visible with no JS having run — deliberately NOT an `appear`
  // binding, which the runtime force-fires after 3s
  await expect(first).toBeVisible()
  await expect(second).toBeHidden()

  await page.getByRole('button', { name: 'Details' }).click()
  await expect(second).toBeVisible()
  await expect(first).toBeHidden()

  // the group makes the panels exclusive
  await page.getByRole('button', { name: 'Activity' }).click()
  await expect(third).toBeVisible()
  await expect(second).toBeHidden()
  await expect(first).toBeHidden()

  // tab one is the "off" position of every effect
  await page.getByRole('button', { name: 'Overview' }).click()
  await expect(first).toBeVisible()
  await expect(second).toBeHidden()
  await expect(third).toBeHidden()

  // and the default panel stays put well past the runtime's 3s appear sweep
  await page.waitForTimeout(3500)
  await expect(first).toBeVisible()
})

test('Dialog: opens, dismisses from the overlay, and from Escape', async ({ page }) => {
  await openEditor(page)
  await insertFromLibrary(page, 'dialog')
  await publish(page)
  await page.goto('/')

  // the trigger is a nested Button: its click reaches the binding on the
  // wrapper the Dialog owns, which is the only place a host can bind
  const body = page.getByText('Make your changes here, then save when you are done.')
  await expect(body).toBeHidden()

  await page.getByRole('button', { name: 'Open dialog' }).click()
  await expect(body).toBeVisible()

  // the overlay and the buttons all drive ONE effect, keyed by target
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(body).toBeHidden()

  await page.getByRole('button', { name: 'Open dialog' }).click()
  await expect(body).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(body).toBeHidden()
})

test('renaming a component keeps every instance rendering', async ({ page }) => {
  await openEditor(page)
  await insertFromLibrary(page, 'card')

  await rail(page, 'Components').click()
  const row = projectRow(page, 'Card')
  await row.hover()
  await row.getByRole('button').last().click() // the row kebab
  // exact: the rail's "Project settings" button matches a loose 'Settings'
  await page.getByRole('button', { name: 'Settings', exact: true }).click()

  const name = page.locator('input[placeholder="Card"]')
  await name.fill('Panel')
  await name.blur()

  await publish(page)
  await page.goto('/')
  // renamed in place: the instance still resolves to its master, so it keeps
  // the master's classes and copy
  await expect(page.getByText('Card title')).toBeVisible()
  await expect(page.locator('.bg-card').first()).toBeVisible()
})
