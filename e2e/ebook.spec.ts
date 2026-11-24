import { expect, test } from '@playwright/test';

// Fake providers + fixture feed (see implementation-notes.md "P1: e2e setup").
test('import feed → create ebook → run → approve outline → review → PDF', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('e2e-email').fill(`e2e-${Date.now()}@example.com`);
  await page.getByTestId('e2e-password').fill('correct-horse-battery');
  await page.getByTestId('e2e-signin').click();

  await page.getByTestId('import-url').fill('https://fixture.invalid/feed.xml');
  await page.getByTestId('import-attest').check();
  await page.getByTestId('import-submit').click();
  await page.getByTestId('podcast-link').first().click();

  const boxes = page.getByTestId('episode-checkbox');
  await expect(boxes).toHaveCount(2);
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByTestId('brief').fill('A short guide for newcomers.');
  await page.getByTestId('create-ebook').click();

  // Page polls advance by itself until the outline is ready.
  await expect(page.getByTestId('outline-approve')).toBeVisible({ timeout: 90_000 });
  await page.getByTestId('outline-approve').click();

  await expect(page.getByTestId('chapter-item').first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('ebook-status')).toContainText(/review/i, { timeout: 90_000 });

  // Open every chapter (export gate), edit the first one.
  const items = page.getByTestId('chapter-item');
  const n = await items.count();
  for (let i = 0; i < n; i++) await items.nth(i).click();
  await items.first().click();
  await page.getByTestId('chapter-editor').fill('Edited by hand.\n\nSecond paragraph.');
  await page.getByTestId('chapter-save').click();
  for (let i = 0; i < n; i++) await items.nth(i).click();

  // Fetch the link directly: a failed <a download> emits no event, which hides the server's error body.
  // Opening is async; the button becomes a link once every chapter is persisted as opened.
  await expect(page.getByTestId('export-pdf')).toHaveAttribute('href', /\/pdf$/);
  const href = await page.getByTestId('export-pdf').getAttribute('href');
  const res = await page.request.get(href!);
  expect(res.status(), await res.text().catch(() => '')).toBe(200);
  expect(res.headers()['content-type']).toContain('application/pdf');
  expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');
});
