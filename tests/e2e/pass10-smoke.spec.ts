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

test('graph view keeps isolated notes discoverable', async ({ page }) => {
  await page.goto('/?graphMock=1');

  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByTestId('graph-canvas')).toHaveAttribute('data-node-count', '8');
  await expect(page.getByTestId('graph-canvas')).toHaveAttribute('data-note-count', '4');
  const noteIndex = page.getByTestId('graph-notes-index');
  await expect(noteIndex).toBeVisible();
  await expect(noteIndex).toContainText('Notes in map');
  await expect(noteIndex.locator('[data-testid="graph-note-index-item"]')).toHaveCount(4);
  await expect(noteIndex).toContainText('Miso Soup Recipe');

  const noteSearch = noteIndex.locator('input[aria-label="Find a note in the map"]');
  await expect(noteSearch).toHaveCount(1);
  await noteSearch.fill('miso');
  await expect(noteIndex.locator('[data-testid="graph-note-index-item"]')).toHaveCount(1);
  await expect(noteIndex).toContainText('Miso Soup Recipe');

  await noteIndex.getByRole('button', { name: 'Hide note list' }).click();
  await expect(noteIndex).toBeHidden();
  await page.getByRole('button', { name: 'Show note list' }).click();
  await expect(page.getByTestId('graph-notes-index')).toBeVisible();
});

test('graph explains sparse structure and gives isolated notes an editor path', async ({ page }) => {
  await page.goto('/?graphMock=1');

  await expect(page.getByText('Links you typed', { exact: true })).toBeVisible();
  await expect(page.getByText('Shared tags', { exact: true })).toBeVisible();
  await expect(page.getByText('AI topic groups', { exact: true })).toBeVisible();
  await expect(page.getByText('AI-found similarity', { exact: true })).toBeVisible();
  await expect(page.getByText('Hide AI guesses below 0% sure', { exact: true })).toBeVisible();
  await expect(page.getByText('Outline folders', { exact: true })).toBeVisible();

  for (const label of ['Links you typed', 'Shared tags', 'AI topic groups', 'AI-found similarity']) {
    await page.getByLabel(label, { exact: true }).click();
  }
  const sparseCopy = 'Dots without lines are notes nothing links to yet. Connect notes by typing [[ inside them — or click “Organize vault…” above to let the on-device AI group them into topics.';
  await expect(page.getByText(sparseCopy, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss graph hint' }).click();
  await expect(page.getByText(sparseCopy, { exact: true })).toBeHidden();

  await page.getByRole('button', { name: 'Reset view' }).click();
  await page.getByTestId('graph-note-index-item').filter({ hasText: 'Miso Soup Recipe' }).click();
  await expect(page.getByText("This note isn't connected to anything yet. Open it and type [[ to link it to another note.", { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open note' })).toBeVisible();
});

test('graph keeps the map usable on a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?graphMock=1');

  const graph = page.getByTestId('graph-canvas');
  await expect(graph).toBeVisible();
  const graphWidth = await graph.evaluate((element) => element.getBoundingClientRect().width);
  expect(graphWidth).toBeGreaterThan(300);
  await expect(page.getByTestId('graph-notes-index')).toBeHidden();
  const showNoteList = page.getByRole('button', { name: 'Show note list' });
  await expect(showNoteList).toBeVisible();

  await showNoteList.click();
  await expect(page.getByTestId('graph-notes-index')).toBeVisible();
  const graphWidthWithIndexOpen = await graph.evaluate((element) => element.getBoundingClientRect().width);
  expect(graphWidthWithIndexOpen).toBeGreaterThan(300);

  await page.getByTestId('graph-note-index-item').filter({ hasText: 'Miso Soup Recipe' }).click();
  await expect(page.getByTestId('graph-notes-index')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open note' })).toBeVisible();
});

test('graph overlays stay mutually exclusive on a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?graphMock=1');

  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  await page.getByRole('button', { name: 'Show note list' }).click();
  await expect(page.getByTestId('graph-notes-index')).toBeVisible();
  await page.waitForTimeout(1800);

  // Use the text index to select a node instead of a pixel coordinate. The force layout is
  // intentionally compact and can move nodes as the graph settles, but the overlay contract
  // should stay stable regardless of their final positions.
  await page.getByTestId('graph-note-index-item').filter({ hasText: 'Miso Soup Recipe' }).click();
  await expect(page.getByTestId('graph-notes-index')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Show note list' }).click();
  await expect(page.getByTestId('graph-notes-index')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeHidden();
});

test('welcome and smoke shell stay inside a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'DeNote' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.goto('/?e2eSmoke=1');
  await page.getByTestId('open-vault').click();
  await expect(page.getByTestId('editor-note')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
