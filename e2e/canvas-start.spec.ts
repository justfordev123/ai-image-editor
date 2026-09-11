import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('empty canvas offers three choices before opening the sample at all breakpoints', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/generate')) requests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Start with an image' })).toBeVisible();
  await expect(page.locator('.workspace')).toBeVisible();
  await expect(page.locator('.canvas-host')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled();
  for (const width of [320, 390, 640, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('app-toolbar')).toHaveCount(0);
    await expect(page.locator('.canvas-heading')).toHaveCount(0);
    const workspaceWidth = await page.locator('.workspace').evaluate((element) => {
      const style = getComputedStyle(element);
      return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    });
    expect((await page.locator('.work-area').boundingBox())!.width).toBeCloseTo(workspaceWidth, 0);
    for (const name of ['Use sample image', 'Upload an image', 'Generate with AI']) {
      await expect(
        page.locator('.canvas-stage').getByRole('button', { name, exact: true }),
      ).toBeVisible();
      await expect(
        page.locator('.canvas-stage').getByRole('button', { name, exact: true }),
      ).toBeEnabled();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width === 390 || width === 1440) {
      await page.screenshot({
        path: `docs/screenshots/empty-canvas${width === 390 ? '-mobile' : ''}.png`,
        fullPage: true,
      });
    }
  }
  await page.getByRole('button', { name: 'Use sample image', exact: true }).click();
  await expect(page.getByText('1254 × 1254 px')).toBeVisible();
  await expect(page.locator('app-toolbar')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ceramic study', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Start with an image' })).toHaveCount(0);
  expect(requests).toHaveLength(0);
});

test('empty canvas upload allows cancellation and invalid-file recovery before opening an image', async ({
  page,
}) => {
  await page.goto('/');
  const chooseFile = async () => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload an image', exact: true }).click();
    return chooser;
  };
  await (await chooseFile()).setFiles([]);
  await expect(page.getByRole('heading', { name: 'Start with an image' })).toBeVisible();
  await (
    await chooseFile()
  ).setFiles({
    name: 'invalid.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('invalid image'),
  });
  await expect(page.getByRole('alert')).toContainText('Choose a PNG, JPEG, or WebP');
  await expect(page.locator('.workspace')).toBeVisible();
  await expect(page.locator('.canvas-host')).toBeHidden();
  await (await chooseFile()).setFiles('public/samples/ceramic-ribbon.png');
  await expect(page.getByText('1254 × 1254 px')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ceramic-ribbon', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).not.toBeVisible();
});

test('empty canvas creates from a prompt, recovers from failure, then opens the edit-only AI panel', async ({
  page,
}) => {
  const sample = (await readFile('public/samples/ceramic-ribbon.png')).toString('base64');
  const requests: Record<string, unknown>[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/generate', async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) {
      await pending;
      await route.fulfill({
        contentType: 'application/x-ndjson',
        body: '{"type":"error","message":"Try again (test)"}\n',
      });
    } else {
      await route.fulfill({
        contentType: 'application/x-ndjson',
        body: `${JSON.stringify({ type: 'image', url: `data:image/png;base64,${sample}` })}\n`,
      });
    }
  });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Generate with AI', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Generate image', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Back to choices' }).click();
    await page.getByRole('button', { name: 'Generate with AI', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Describe your image' })
      .fill('  A blue ceramic vase  ');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: 'docs/screenshots/create-image-mobile.png', fullPage: true });
    await page.getByRole('button', { name: 'Generate image', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Creating…', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Back to choices' })).toBeDisabled();
    await expect(page.getByRole('textbox', { name: 'Describe your image' })).toBeDisabled();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toEqual({ intent: 'create', prompt: 'A blue ceramic vase' });
    release();
    await expect(page.getByRole('alert')).toContainText('Try again (test)');
    await expect(page.getByRole('textbox', { name: 'Describe your image' })).toHaveValue(
      '  A blue ceramic vase  ',
    );
    await page.getByRole('button', { name: 'Generate image', exact: true }).click();
    await expect(page.getByText('1254 × 1254 px')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Untitled image', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Start with an image' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add to favorites' })).toHaveCount(1);
    expect(requests[1]).toEqual(requests[0]);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'AI', exact: true }).click();
    const panel = page.getByRole('complementary', { name: 'AI panel' });
    await expect(panel.getByRole('button')).toHaveCount(2);
    await expect(panel.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue('');
    await panel.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Make the vase red');
    await panel.getByRole('button', { name: 'Edit image', exact: true }).click();
    await expect(page.getByText('Image updated.', { exact: true })).toBeVisible();
    expect(requests).toHaveLength(3);
    expect(requests[2]['intent']).toBe('edit');
    expect(requests[2]['source']).toMatch(/^data:image\/jpeg;base64,/);
  } finally {
    release();
  }
});
