import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function storedImages(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ id: string; name?: string; url: string; favorite: boolean }[]>(
        (resolve, reject) => {
          const open = indexedDB.open('creaition-images', 1);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const request = db.transaction('images').objectStore('images').getAll();
            request.onsuccess = () => {
              db.close();
              resolve(request.result);
            };
            request.onerror = () => {
              db.close();
              reject(request.error);
            };
          };
        },
      ),
  );
}

test('uploads appear once in explorations, persist their bytes and favorites, and reopen after reload', async ({
  page,
}) => {
  let aiRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/generate')) aiRequests++;
  });
  const bytes = await readFile('public/samples/ceramic-ribbon.png');
  await page.goto('/');
  const upload = (name: string, buffer = bytes) =>
    page.locator('input[type="file"]').setInputFiles({ name, mimeType: 'image/png', buffer });
  await upload('broken.png', Buffer.from('not an image'));
  await expect(page.getByRole('alert')).toContainText('not a readable image');
  await expect(page.locator('article.image-card')).toHaveCount(0);
  await upload('my-photo.png');
  const photo = page.locator('article.image-card').filter({ hasText: 'my-photo' });
  await expect(photo).toBeVisible();
  await expect(page.locator('article.image-card')).toHaveCount(1);
  await expect.poll(async () => (await storedImages(page)).length).toBe(1);
  const saved = (await storedImages(page))[0];
  expect(saved.url === `data:image/png;base64,${bytes.toString('base64')}`).toBe(true);
  await photo.getByRole('button', { name: 'Add to favorites' }).click();
  await expect.poll(async () => (await storedImages(page))[0]?.favorite).toBe(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'my-photo', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Start with an image' })).toHaveCount(0);
  await expect(photo.getByRole('button', { name: 'Remove from favorites' })).toBeVisible();
  await photo.getByRole('button', { name: 'Open image: my-photo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'my-photo', exact: true })).toBeVisible();
  await expect(page.getByText('1254 × 1254 px')).toBeVisible();
  await expect(page.locator('article.image-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await upload('another-photo.png');
  // A new upload should be visible even when the favorites filter was previously selected.
  await expect(page.getByRole('button', { name: 'Favorites', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.locator('article.image-card')).toHaveCount(2);
  await expect.poll(async () => (await storedImages(page)).length).toBe(2);
  await photo.getByRole('button', { name: 'Delete image from history' }).click();
  await expect
    .poll(async () => (await storedImages(page)).map((image) => image.name))
    .toEqual(['another-photo']);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'another-photo', exact: true })).toBeVisible();
  await expect(page.locator('article.image-card')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Open image: another-photo', exact: true }),
  ).toBeVisible();
  expect(aiRequests).toBe(0);
});

test('refresh resumes the sample even before its image has finished loading', async ({ page }) => {
  let release!: () => void;
  let firstRequest = true;
  const pending = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/samples/ceramic-ribbon.png', async (route) => {
    if (firstRequest) {
      firstRequest = false;
      await pending;
      await route.abort().catch(() => {});
    } else {
      await route.continue();
    }
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Use sample image', exact: true }).click();
    await expect(page.getByText('Opening your image…', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Ceramic study', exact: true })).toBeVisible();
    await expect(page.getByText('1254 × 1254 px')).toBeVisible();
    await expect(page.locator('article.image-card')).toHaveCount(1);
  } finally {
    release();
  }
});

test('the sample is saved once and the last selected image is restored after refresh', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Use sample image', exact: true }).click();
  const sample = page.getByRole('button', { name: 'Open image: Ceramic study', exact: true });
  await expect(sample).toBeVisible();
  await expect
    .poll(async () => (await storedImages(page)).map((image) => image.id))
    .toEqual(['sample']);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ceramic study', exact: true })).toBeVisible();
  await expect(page.getByText('1254 × 1254 px')).toBeVisible();
  await expect(page.getByText('AI-generated sample', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Start with an image' })).toHaveCount(0);
  await expect(page.locator('article.image-card')).toHaveCount(1);
  await sample.click();
  await sample.click();
  await expect(page.locator('article.image-card')).toHaveCount(1);

  await page.locator('input[type="file"]').setInputFiles({
    name: 'newer-upload.png',
    mimeType: 'image/png',
    buffer: await readFile('public/samples/ceramic-ribbon.png'),
  });
  await expect.poll(async () => (await storedImages(page)).length).toBe(2);
  // Selecting an older entry must take precedence over the newest history entry on refresh.
  await sample.click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ceramic study', exact: true })).toBeVisible();
  await expect(page.locator('article.image-card')).toHaveCount(2);

  const sampleCard = page.locator('article.image-card').filter({ has: sample });
  await sampleCard.getByRole('button', { name: 'Add to favorites' }).click();
  await expect
    .poll(async () => (await storedImages(page)).find((image) => image.id === 'sample')?.favorite)
    .toBe(true);
  await page.reload();
  await expect(sampleCard.getByRole('button', { name: 'Remove from favorites' })).toBeVisible();
  await sampleCard.getByRole('button', { name: 'Delete image from history' }).click();
  await expect(page.getByRole('heading', { name: 'newer-upload', exact: true })).toBeVisible();
  await expect(page.locator('.history .image-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Sample image ↗' })).toHaveCount(0);
  await expect
    .poll(async () => (await storedImages(page)).map((image) => image.name))
    .toEqual(['newer-upload']);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'newer-upload', exact: true })).toBeVisible();
  await expect(sample).toHaveCount(0);
  await expect(page.locator('.history .image-card')).toHaveCount(1);
});

test('deleting the only sample leaves no exploration and stays deleted after refresh', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Use sample image', exact: true }).click();
  await expect(page.getByText('1254 × 1254 px')).toBeVisible();
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await page.getByRole('button', { name: 'Delete image from history' }).click();
  await expect(page.locator('.history .image-card')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Start with an image' })).toBeVisible();
  await expect(page.locator('app-toolbar')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'AI panel' })).toHaveCount(0);
  await expect.poll(() => storedImages(page)).toEqual([]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Start with an image' })).toBeVisible();
  await expect(page.locator('.history .image-card')).toHaveCount(0);
  await expect(page.locator('app-toolbar')).toHaveCount(0);
  await expect(page.locator('.canvas-heading')).toHaveCount(0);
  // The sample can still be deliberately opened again from the empty-state choices.
  await page.getByRole('button', { name: 'Use sample image', exact: true }).click();
  await expect(page.locator('.history .image-card')).toHaveCount(1);
});

test('storage failures remain visible on the empty canvas and allow editing for this session', async ({
  page,
}) => {
  await page.addInitScript(() => {
    indexedDB.open = () => {
      throw new DOMException('Storage denied', 'SecurityError');
    };
  });
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('Image history is unavailable');
  await page.getByRole('button', { name: 'Use sample image', exact: true }).click();
  await expect(page.getByText('1254 × 1254 px')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('storage is full or unavailable');
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
});

test('a failed history image does not replace the saved selection', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Use sample image', exact: true }).click();
  await expect.poll(async () => (await storedImages(page)).length).toBe(1);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('creaition-images', 1);
        open.onsuccess = () => {
          const db = open.result;
          const transaction = db.transaction('images', 'readwrite');
          transaction.objectStore('images').put({
            id: 'broken',
            name: 'Unavailable image',
            prompt: '',
            url: 'data:image/png;base64,YQ==',
            createdAt: 1,
            favorite: false,
          });
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => {
            db.close();
            reject(transaction.error);
          };
        };
      }),
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ceramic study', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open image: Unavailable image' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be opened');
  expect(await page.evaluate(() => localStorage.getItem('creaition-current-image-v1'))).toBe(
    'sample',
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ceramic study', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('history card labels and circular controls fit without overlapping at desktop and mobile sizes', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'a-very-long-uploaded-image-name-that-must-not-cover-the-buttons.png',
    mimeType: 'image/png',
    buffer: await readFile('public/samples/ceramic-ribbon.png'),
  });
  const card = page.locator('article.image-card');
  await card.getByRole('button', { name: 'Add to favorites' }).click();
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await card.scrollIntoViewIfNeeded();
    const geometry = await card.evaluate((element) => {
      const rect = (node: Element) => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      return {
        card: rect(element),
        label: rect(element.querySelector('.image-meta > span')!),
        buttons: Array.from(element.querySelectorAll('.image-meta button')).map((button) => ({
          button: rect(button),
          icon: rect(button.querySelector('app-icon svg')!),
          target: rect(button.querySelector('.mat-mdc-button-touch-target')!),
        })),
      };
    });
    const { card: bounds, label, buttons } = geometry;
    expect(label.x + label.width).toBeLessThanOrEqual(buttons[0].button.x);
    for (const { button, icon, target } of buttons) {
      expect(button.width).toBe(button.height);
      expect(button.width).toBeGreaterThanOrEqual(35);
      expect(Math.abs(icon.x + icon.width / 2 - button.x - button.width / 2)).toBeLessThan(1);
      expect(Math.abs(icon.y + icon.height / 2 - button.y - button.height / 2)).toBeLessThan(1);
      expect(target.x).toBeGreaterThanOrEqual(bounds.x);
      expect(target.x + target.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(target.y + target.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
    expect(buttons[0].target.x + buttons[0].target.width).toBeLessThanOrEqual(buttons[1].target.x);
  }
  await page.mouse.move(20, 20);
  await page.locator('.history').screenshot({ path: 'docs/screenshots/upload-history.png' });
});
