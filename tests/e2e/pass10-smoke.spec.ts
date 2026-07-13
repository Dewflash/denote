import { expect, test } from '@playwright/test';

test('pass-10 smoke covers vault, links, graph, search, capture, and hostile snippets', async ({ page }) => {
  await page.goto('/?e2eSmoke=1');

  await page.getByTestId('open-vault').click();
  await expect(page.getByText('Fixture Vault')).toBeVisible();
  await expect(page.getByTestId('editor-note')).toContainText('Japan');

  await page.getByTestId('create-linked-note').click();
  await expect(page.getByTestId('editor-note')).toContainText('Bank of Japan');
  await expect(page.getByTestId('backlinks-panel')).toContainText('Japan');

  await page.getByTestId('open-graph').click();
  await expect(page.getByTestId('graph-view')).toBeVisible();
  await expect(page.getByTestId('graph-node-Japan')).toBeVisible();
  await expect(page.getByTestId('graph-node-Bank of Japan')).toBeVisible();

  await page.getByTestId('open-search').click();
  await page.getByTestId('search-input').fill('yen');
  await page.getByTestId('search-hit-Japan').click();
  await expect(page.getByTestId('editor-note')).toContainText('yen policy');

  await page.getByTestId('simulate-capture').click();
  await expect(page.getByTestId('capture-dialog')).toContainText('https://example.com/boj');
  await page.getByTestId('file-capture').click();
  await page.getByTestId('note-Captured Safari Note').click();
  await expect(page.getByTestId('capture-provenance')).toContainText('https://example.com/boj');

  await page.getByTestId('inject-hostile-snippet').click();
  await expect(page.getByTestId('hostile-snippet')).toBeAttached();
  await page.getByTestId('open-settings').click();
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
  await expect(page.getByTestId('settings-visible')).toContainText('outside the snippet scope');
});
