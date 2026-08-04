import { expect, test, type Page } from '@playwright/test'

/** Starts from a clean slate: no autosave, no stored preferences. */
async function freshBoard(page: Page) {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('rankroom')
    localStorage.clear()
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /bring something to rank/i })).toBeVisible()
}

async function useFirstTemplate(page: Page) {
  await page.getByRole('button', { name: /browse templates/i }).click()
  const gallery = page.getByRole('dialog', { name: /start from a template/i })
  await expect(gallery).toBeVisible()
  await gallery.getByRole('button', { name: 'Use this' }).first().click()
  await expect(gallery).toBeHidden()
}

test.describe('the board', () => {
  test.beforeEach(async ({ page }) => {
    await freshBoard(page)
  })

  test('a template fills the bench and names the board', async ({ page }) => {
    await useFirstTemplate(page)

    await expect(page.getByRole('textbox', { name: /ranking title/i })).toHaveValue(
      'Nintendo series',
    )
    const bench = page.getByRole('region', { name: 'Bench' })
    await expect(bench.getByRole('button', { name: 'Zelda' })).toBeVisible()
  })

  test('a tile can be dragged from the bench into a tier, and then to another', async ({
    page,
  }) => {
    await useFirstTemplate(page)

    const zelda = page.getByRole('region', { name: 'Bench' }).getByRole('button', { name: 'Zelda' })
    const tierB = page.getByRole('region', { name: 'Tier B' })
    const tierS = page.getByRole('region', { name: 'Tier S' })

    // A real pointer drag: press, move in steps so dnd-kit registers it, release.
    await zelda.hover()
    await page.mouse.down()
    for (const box of [await tierB.boundingBox()]) {
      if (!box) throw new Error('tier B not laid out')
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 })
    }
    await page.mouse.up()

    await expect(tierB.getByRole('button', { name: 'Zelda' })).toBeVisible()

    // Moving it again is the case that used to lock a tile in place.
    const placed = tierB.getByRole('button', { name: 'Zelda' })
    await placed.hover()
    await page.mouse.down()
    const target = await tierS.boundingBox()
    if (!target) throw new Error('tier S not laid out')
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 })
    await page.mouse.up()

    await expect(tierS.getByRole('button', { name: 'Zelda' })).toBeVisible()
    await expect(tierB.getByRole('button', { name: 'Zelda' })).toBeHidden()
  })

  test('a tile can be placed with the keyboard alone', async ({ page }) => {
    await useFirstTemplate(page)

    const bench = page.getByRole('region', { name: 'Bench' })
    const inBench = bench.getByRole('button', { name: 'Mario', exact: true })
    const live = page.locator('[aria-live]').first()

    await inBench.focus()
    await page.keyboard.press('Space')
    await expect(live).toContainText(/over the bench/i)

    // Up steps between tiers, so one press normally suffices — but dnd-kit
    // measures the zones asynchronously and swallows a press that lands too
    // early. Pressing until it moves is both what a user does and what makes
    // this deterministic.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await page.keyboard.press('ArrowUp')
      if ((await inBench.count()) === 0) break
      await page.waitForTimeout(100)
    }
    await expect(inBench).toHaveCount(0)

    await page.keyboard.press('Space')

    await expect(
      page
        .getByRole('region', { name: /^Tier/ })
        .getByRole('button', { name: 'Mario', exact: true }),
    ).toBeVisible()
  })

  test('text tiles can be added one line at a time', async ({ page }) => {
    await page.getByPlaceholder(/type a name/i).fill('Homemade')
    await page.keyboard.press('Enter')

    await expect(
      page.getByRole('region', { name: 'Bench' }).getByRole('button', { name: 'Homemade' }),
    ).toBeVisible()
  })

  test('undo puts a placed tile back on the bench', async ({ page }) => {
    await useFirstTemplate(page)

    await page.getByRole('region', { name: 'Bench' }).getByRole('button', { name: 'Zelda' }).focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Space')
    await page.keyboard.press('Control+z')

    await expect(
      page.getByRole('region', { name: 'Bench' }).getByRole('button', { name: 'Zelda' }),
    ).toBeVisible()
  })
})
