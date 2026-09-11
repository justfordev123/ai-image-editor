import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('sample, editing, undo, export, and desktop screenshot', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Use sample image', exact: true }).click();
  await expect(page.getByText('1254 × 1254 px')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(page.getByRole('complementary')).not.toBeVisible();
  const fullWidth = (await page.locator('.canvas-stage').boundingBox())!.width;
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'AI panel' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toBeVisible();
  await expect(page.getByLabel('Brightness', { exact: true })).not.toBeVisible();
  await page.mouse.move(1000, 40);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.screenshot({ path: 'docs/screenshots/desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Adjust', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Adjust panel' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).not.toBeVisible();
  await expect(page.getByLabel('Brightness', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Contrast', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Saturation', { exact: true })).toBeVisible();
  await page.mouse.move(1000, 40);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.screenshot({ path: 'docs/screenshots/adjust.png', fullPage: true });
  await page.getByRole('button', { name: 'Close Adjust panel' }).click();
  await expect(page.getByRole('complementary')).not.toBeVisible();
  expect((await page.locator('.canvas-stage').boundingBox())!.width).toBe(fullWidth);
  await page.getByRole('button', { name: 'Rotate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Crop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply crop' })).toBeVisible();
  await page.getByRole('button', { name: 'Apply crop' }).click();
  await expect(page.getByRole('button', { name: 'Apply crop' })).not.toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Ceramic study.png');
  const bytes = await readFile((await file.path())!);
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  expect(errors).toEqual([]);
});

test('AI edits once despite legacy preferences, loads the result, and persists favorites', async ({
  page,
}) => {
  const sample = (await readFile('public/samples/ceramic-ribbon.png')).toString('base64');
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/generate', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({
      contentType: 'application/x-ndjson',
      body: `${JSON.stringify({ type: 'image', url: `data:image/png;base64,${sample}` })}\n`,
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Use sample image', exact: true }).click();
  await page.evaluate(() =>
    localStorage.setItem(
      'creaition-preferences-v1',
      JSON.stringify({
        prompt: 'Make the background darker',
        mode: 'create',
        batch: 4,
        model: 'stabilityai/stable-diffusion-xl-base-1.0',
        steps: 50,
      }),
    ),
  );
  await page.reload();
  await expect(page.getByText('1254 × 1254 px')).toBeVisible();
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'AI panel' });
  await expect(panel.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue(
    'Make the background darker',
  );
  await expect(panel.getByRole('combobox')).toHaveCount(0);
  // The only buttons are the edit action and the panel's close button.
  await expect(panel.getByRole('button')).toHaveCount(2);
  await page.getByRole('button', { name: 'Edit image', exact: true }).click();
  await expect(page.getByText('Image updated.', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(Object.keys(requests[0]).sort()).toEqual(['intent', 'prompt', 'source']);
  expect(requests[0]['intent']).toBe('edit');
  expect(requests[0]['source']).toMatch(/^data:image\/jpeg;base64,/);
  await expect(page.getByRole('heading', { name: 'Ceramic study', exact: true })).toBeVisible();
  await page
    .locator('article.image-card')
    .first()
    .getByRole('button', { name: 'Add to favorites' })
    .click();
  await expect(page.getByRole('button', { name: 'Remove from favorites' })).toBeVisible();
  await page.reload();
  await expect(page.getByText('1254 × 1254 px')).toBeVisible();
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove from favorites' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue(
    'Make the background darker',
  );
});

test('AI sends the current canvas on each edit and recovers from a failure', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/generate', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({
      contentType: 'application/x-ndjson',
      body: '{"type":"error","message":"Quota exhausted (test)"}\n',
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Use sample image', exact: true }).click();
  await expect(page.getByText('1254 × 1254 px')).toBeVisible();
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  const button = page.getByRole('button', { name: 'Edit image', exact: true });
  await expect(button).toBeDisabled();
  await page
    .getByRole('textbox', { name: 'Prompt', exact: true })
    .fill('Make the background darker');
  await button.click();
  await expect(page.getByRole('alert')).toContainText('Quota exhausted (test)');
  expect(requests[0]['prompt']).toBe('Make the background darker');
  expect(requests[0]['source']).toMatch(/^data:image\/jpeg;base64,/);
  await expect(button).toBeEnabled();

  await page.getByRole('button', { name: 'Adjust', exact: true }).click();
  await page.getByLabel('Brightness', { exact: true }).fill('0.2');
  await page.getByLabel('Brightness', { exact: true }).dispatchEvent('change');
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await button.click();
  await expect.poll(() => requests.length).toBe(2);
  await expect(page.getByRole('alert')).toContainText('Quota exhausted (test)');
  expect(requests[1]['source']).not.toBe(requests[0]['source']);
  await expect(button).toBeEnabled();
});

test('mobile tools and properties are usable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Use sample image', exact: true }).click();
  await expect(page.getByText('1254 × 1254 px')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Draw' }).click();
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'AI', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({
    path: 'docs/screenshots/mobile-properties.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Close AI panel' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Tools', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Adjust', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Adjust panel' })).toBeVisible();
  await expect(page.getByLabel('Brightness', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Contrast', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Saturation', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).not.toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('drawing produces undoable canvas edits', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Use sample image', exact: true }).click();
  await expect(page.getByText('1254 × 1254 px')).toBeVisible();
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const box = (await page.locator('canvas.upper-canvas').boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 100, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(page.getByRole('alert')).not.toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
});

test('adjustments change image pixels and stay in sync with undo, crop, and upload', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Use sample image', exact: true }).click();
  await expect(page.getByText('1254 × 1254 px')).toBeVisible();
  // A colored fixture makes saturation observable; the studio sample is monochrome.
  const fixture = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'rgb(150, 100, 75)';
    context.fillRect(0, 0, 256, 256);
    return canvas.toDataURL().split(',')[1];
  });
  const upload = () =>
    page.locator('input[type="file"]').setInputFiles({
      name: 'color.png',
      mimeType: 'image/png',
      buffer: Buffer.from(fixture, 'base64'),
    });
  const pixel = () =>
    page.locator('canvas.lower-canvas').evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      return Array.from(canvas.getContext('2d')!.getImageData(128, 128, 1, 1).data).slice(0, 3);
    });
  const change = async (name: string, value: string) => {
    const slider = page.getByRole('slider', { name, exact: true });
    await slider.fill(value);
    await slider.dispatchEvent('change');
    await expect(slider).toBeEnabled();
  };
  await upload();
  await expect(page.getByText('256 × 256 px')).toBeVisible();
  await expect.poll(pixel).toEqual([150, 100, 75]);
  const original = await pixel();
  await page.getByRole('button', { name: 'Adjust', exact: true }).click();
  await expect(page.getByRole('slider')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Toggle black & white' })).toHaveCount(0);
  await expect(page.getByLabel('Brush width')).toHaveCount(0);
  await expect(page.getByLabel('Text to add')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add text to canvas' })).toHaveCount(0);

  await change('Contrast', '0.25');
  const contrasted = await pixel();
  expect(contrasted[0]).toBeGreaterThan(original[0]);
  expect(contrasted[1]).toBeLessThan(original[1]);
  await change('Brightness', '0.1');
  const brightened = await pixel();
  expect(brightened[1]).toBeGreaterThan(contrasted[1]);
  await change('Saturation', '-1');
  const desaturated = await pixel();
  expect(desaturated[0]).toBe(desaturated[1]);
  expect(desaturated[1]).toBe(desaturated[2]);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Saturation', { exact: true })).toHaveValue('0');
  expect(await pixel()).toEqual(brightened);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByLabel('Saturation', { exact: true })).toHaveValue('-1');
  expect(await pixel()).toEqual(desaturated);
  await page.getByRole('button', { name: 'Close Adjust panel' }).click();
  await page.getByRole('button', { name: 'Adjust', exact: true }).click();
  await expect(page.getByLabel('Saturation', { exact: true })).toHaveValue('-1');
  await expect(page.getByLabel('Contrast', { exact: true })).toHaveValue('0.25');
  await expect(page.getByLabel('Brightness', { exact: true })).toHaveValue('0.1');

  await page.getByRole('button', { name: 'Crop', exact: true }).click();
  await page.getByRole('button', { name: 'Apply crop' }).click();
  await page.getByRole('button', { name: 'Adjust', exact: true }).click();
  for (const name of ['Brightness', 'Contrast', 'Saturation']) {
    await expect(page.getByLabel(name, { exact: true })).toHaveValue('0');
  }
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Contrast', { exact: true })).toHaveValue('0.25');
  await expect(page.getByLabel('Brightness', { exact: true })).toHaveValue('0.1');
  await expect(page.getByLabel('Saturation', { exact: true })).toHaveValue('-1');
  await upload();
  for (const name of ['Brightness', 'Contrast', 'Saturation']) {
    await expect(page.getByLabel(name, { exact: true })).toHaveValue('0');
  }
  await expect.poll(pixel).toEqual(original);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).not.toBeVisible();
});

test('all specified breakpoints keep the canvas inside the viewport', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Use sample image', exact: true }).click();
  await expect(page.getByText('1254 × 1254 px')).toBeVisible();
  for (const width of [320, 640, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    const canvas = (await page.locator('canvas.upper-canvas').boundingBox())!;
    expect(canvas.x).toBeGreaterThanOrEqual(0);
    expect(canvas.x + canvas.width).toBeLessThanOrEqual(width);
  }
});

test('pending AI edits stay disabled when the panel is reopened', async ({ page }) => {
  let release!: () => void;
  let requests = 0;
  const pending = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/generate', async (route) => {
    requests++;
    await pending;
    await route.fulfill({
      contentType: 'application/x-ndjson',
      body: '{"type":"error","message":"Try again (test)"}\n',
    });
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Use sample image', exact: true }).click();
    await expect(page.getByText('1254 × 1254 px')).toBeVisible();
    await page.getByRole('button', { name: 'AI', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Prompt', exact: true })
      .fill('Make the background darker');
    await page.getByRole('button', { name: 'Edit image', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Editing…', exact: true })).toBeDisabled();
    await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Close AI panel' }).click();
    await expect(page.getByRole('status')).toContainText('Connecting to the AI service');
    await expect(page.getByRole('button', { name: 'Delete image from history' })).toBeDisabled();
    await page.getByRole('button', { name: 'AI', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Editing…', exact: true })).toBeDisabled();
    await expect.poll(() => requests).toBe(1);
    await page.getByRole('button', { name: 'Close AI panel' }).click();
    release();
    await expect(page.getByRole('alert')).toContainText('Try again (test)');
    await page.getByRole('button', { name: 'AI', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Edit image', exact: true })).toBeEnabled();
    await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toBeEnabled();
  } finally {
    release();
  }
});
