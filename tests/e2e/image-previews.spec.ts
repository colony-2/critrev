import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {expect, test} from '@playwright/test';
import {choose, imageEditor, logs, openImages, png, redo, text, undo} from './image-helpers.js';
for (const surface of ['react', 'imperative']) test.describe(`${surface} bound previews`, () => {
  test.beforeEach(async ({page}) => openImages(page, surface));
  test('V01,V02,V05,V07 bound URLs only; replacement preserves content and history', async ({page}) => {
    const requests: string[] = []; await page.route('https://*.invalid/**', route => { requests.push(route.request().url()); return route.fulfill({status: 200, contentType: 'image/png', body: Buffer.from(png.split(',')[1]!, 'base64')}); });
    await page.evaluate(() => window.fixture.load('A ![remote](https://unbound.invalid/a.png) Z'));
    const image = imageEditor(page).locator('[data-critrev-image]'); await expect(image).toContainText('Preview unavailable'); expect(requests).toEqual([]);
    await choose(page, 0); await page.evaluate(() => window.fixture.insert([window.fixture.images[0]!])); const before = await text(page);
    const range = await page.evaluate(() => window.fixture.range()); await page.evaluate(() => window.fixture.resetLogs());
    await page.evaluate(() => window.fixture.previews([['pasted-a.png', 'https://bound.invalid/display.png']]));
    await expect.poll(() => requests).toEqual(['https://bound.invalid/display.png']);
    await expect(imageEditor(page).locator('img')).toHaveCount(1);
    expect(await text(page)).toBe(before); expect(await page.evaluate(() => window.fixture.range())).toEqual(range); expect(await logs(page)).toHaveLength(0);
    await page.evaluate(() => window.fixture.previews([])); await expect(imageEditor(page).locator('img')).toHaveCount(0);
    expect(await text(page)).toBe(before); await undo(page); expect(await text(page)).not.toContain('pasted-a.png'); await redo(page); expect(await text(page)).toBe(before);
  });
  test('V03,V04 HTML-only URLs never bind; failed and stale loads retain the current binding', async ({page}) => {
    const requests: string[] = []; await page.route('https://*.invalid/**', route => { requests.push(route.request().url()); return route.abort(); });
    await choose(page, 0); await page.evaluate(() => window.fixture.htmlPaste()); expect(requests).toEqual([]);
    await page.evaluate(() => window.fixture.load('![x](x.png)'));
    await page.evaluate(() => window.fixture.previews([['x.png', 'https://broken.invalid/x.png']]));
    await expect(imageEditor(page).locator('[data-critrev-image]')).toContainText('Preview unavailable');
    await page.evaluate(url => window.fixture.previews([['x.png', url]]), png);
    await expect(imageEditor(page).locator('img')).toHaveAttribute('src', png);
    await expect.poll(() => imageEditor(page).locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(1);
    expect(await text(page)).toBe('![x](x.png)'); expect((await logs(page)).filter(x => x.paste)).toHaveLength(0);
  });
  test('V04,V09 stale error callbacks and removed nodes release old preview listeners', async ({page}) => {
    await page.evaluate(url => {
      window.fixture.load('![x](x.png)');
      window.fixture.previews([['x.png', 'https://old.invalid/slow.png']]);
      const old = document.querySelector<HTMLImageElement>('[data-fixture-editor] img')!;
      const stale = old.onerror;
      window.fixture.previews([['x.png', url]]);
      stale?.call(old, new Event('error'));
      Object.assign(window, {oldPreview: old});
    }, png);
    await expect(imageEditor(page).locator('img')).toHaveAttribute('src', png);
    expect(await page.evaluate(() => (window as any).oldPreview.onerror)).toBeNull();
    await page.evaluate(() => Object.assign(window, {deletedPreview: document.querySelector('[data-fixture-editor] img')}));
    await imageEditor(page).locator('[data-critrev-image]').click(); await page.keyboard.press('Delete');
    expect(await page.evaluate(() => [(window as any).deletedPreview.onerror, (window as any).deletedPreview.getAttribute('src')])).toEqual([null, null]);
  });
  test('V06,V08,V09 deletion and teardown ignore delayed previews and keep URLs host-owned', async ({page}) => {
    await page.evaluate(() => { window.fixture.load('![x](x.png)'); Object.assign(window, {created: 0, revoked: 0}); URL.createObjectURL = () => { (window as any).created++; return 'blob:host'; }; URL.revokeObjectURL = () => { (window as any).revoked++; }; });
    await imageEditor(page).locator('[data-critrev-image]').click(); await page.keyboard.press('Delete');
    await page.evaluate(url => window.fixture.previews([['x.png', url]]), png); await expect(imageEditor(page).locator('[data-critrev-image]')).toHaveCount(0);
    await undo(page); await expect(imageEditor(page).locator('img')).toHaveCount(1);
    await redo(page); await page.evaluate(() => { window.fixture.modeTo('source'); window.fixture.previews([]); window.fixture.dispose(); });
    expect(await page.evaluate(() => [(window as any).created, (window as any).revoked])).toEqual([0, 0]);
    expect(await page.locator('[data-fixture-editor] img').count()).toBe(0);
  });
  test('A12 visual states: bound, selected, unavailable with empty alt', async ({page}, info) => {
    const directory = process.env.REVIEW_CAPTURE_DIR;
    const capture = async (name: string) => {
      if (directory && surface === 'react') { await mkdir(directory, {recursive: true}); await page.screenshot({path: join(directory, `${name}-${info.project.name}.png`), fullPage: true}); }
    };
    const diagram = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="260" height="130"><rect width="260" height="130" fill="#eef3fb"/><rect x="16" y="40" width="75" height="50" rx="5" fill="white" stroke="#315fbe"/><path d="M91 65 H169 m-10 -7 10 7 -10 7" fill="none" stroke="#315fbe" stroke-width="2"/><rect x="169" y="40" width="75" height="50" rx="5" fill="white" stroke="#315fbe"/><g font-family="sans-serif" font-size="14" fill="#18243b"><text x="37" y="71">Input</text><text x="182" y="71">Output</text></g></svg>');
    await page.evaluate(url => { window.fixture.load('Please review this diagram.\n\n![Flow diagram](pasted-a.png "Draft flow")'); window.fixture.previews([['pasted-a.png', url]]); }, diagram);
    await expect(imageEditor(page).locator('img')).toBeVisible();
    await expect.poll(() => imageEditor(page).locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(260);
    await capture('bound-image');
    await imageEditor(page).locator('[data-critrev-image]').click(); await expect(imageEditor(page).locator('[data-critrev-image]')).toHaveAttribute('data-critrev-image-selected', 'true'); await capture('selected-image');
    await page.evaluate(() => { window.fixture.load('Please review this diagram.\n\n![](pasted-a.png)'); window.fixture.previews([]); });
    await expect(imageEditor(page).locator('[data-critrev-image]')).toHaveAttribute('aria-label', 'Image'); await capture('unavailable-image');
  });
});
