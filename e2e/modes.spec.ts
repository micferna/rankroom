import { expect, test, type Page } from '@playwright/test'

async function boardFromTemplate(page: Page, name = 'Use this') {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('rankroom')
    localStorage.clear()
  })
  await page.goto('/')
  await page.getByRole('button', { name: /browse templates/i }).click()
  const gallery = page.getByRole('dialog', { name: /start from a template/i })
  await gallery.getByRole('button', { name }).first().click()
  await expect(gallery).toBeHidden()
}

test.describe('duel mode', () => {
  test('ranks a bench and survives leaving the tab', async ({ page }) => {
    await boardFromTemplate(page)
    await page.getByRole('button', { name: 'Duel', exact: true }).click()
    await page.getByRole('button', { name: /duel the bench/i }).click()

    await expect(page.getByRole('heading', { name: /which one is better/i })).toBeVisible()
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowLeft')

    const counter = await page.getByText(/^Duel \d+/).textContent()

    // The bug this guards: the run used to be discarded on unmount.
    await page.getByRole('button', { name: 'Board', exact: true }).click()
    await page.getByRole('button', { name: 'Duel', exact: true }).click()

    await expect(page.getByText(/^Duel \d+/)).toHaveText(counter ?? '')
  })

  test('applies its ranking to the board', async ({ page }) => {
    await boardFromTemplate(page)
    await page.getByRole('button', { name: 'Duel', exact: true }).click()
    await page.getByRole('button', { name: /duel the bench/i }).click()

    // Answer until the run completes; the engine needs ~n log n comparisons.
    for (let i = 0; i < 400; i += 1) {
      if (await page.getByRole('heading', { name: /ranked in \d+ duels/i }).isVisible()) break
      await page.keyboard.press(i % 3 === 0 ? 'ArrowRight' : 'ArrowLeft')
    }

    await expect(page.getByRole('heading', { name: /ranked in \d+ duels/i })).toBeVisible()
    await page.getByRole('button', { name: /send to the board/i }).click()

    await expect(page.getByRole('region', { name: 'Tier S' }).getByRole('button')).not.toHaveCount(
      0,
    )
  })
})

test.describe('export', () => {
  test('renders a preview and offers every format', async ({ page }) => {
    await boardFromTemplate(page)
    await page.keyboard.press('Control+e')

    const dialog = page.getByRole('dialog', { name: 'Export' })
    await expect(dialog.getByAltText(/preview of the exported/i)).toBeVisible()

    for (const label of [/save png/i, /thumbnail/i, /\.rankroom/i, /\.json/i]) {
      await expect(dialog.getByRole('button', { name: label })).toBeVisible()
    }
  })

  test('downloads a PNG that is really a PNG', async ({ page }) => {
    await boardFromTemplate(page)
    await page.keyboard.press('Control+e')

    const download = page.waitForEvent('download')
    await page
      .getByRole('dialog', { name: 'Export' })
      .getByRole('button', { name: /save png/i })
      .click()

    const file = await download
    expect(file.suggestedFilename()).toMatch(/\.png$/)
  })
})

test.describe('sharing', () => {
  test('builds a link that reopens the same board', async ({ page, context }) => {
    await boardFromTemplate(page)
    await page.getByRole('textbox', { name: /ranking title/i }).fill('Shared board')

    await page.keyboard.press('Control+k')
    await page.getByPlaceholder(/search commands/i).fill('share')
    await page.keyboard.press('Enter')

    const link = page.getByRole('dialog', { name: /share this board/i }).getByRole('textbox')
    await expect(link).not.toHaveValue('Building…')
    const url = await link.inputValue()
    expect(url).toContain('#/b/')

    const opened = await context.newPage()
    await opened.goto(url)
    await expect(opened.getByRole('textbox', { name: /ranking title/i })).toHaveValue(
      'Shared board',
    )
  })
})
