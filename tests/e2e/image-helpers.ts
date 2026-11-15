import {expect, type Page} from '@playwright/test';
import type {ImageFixture} from '../../demo/src/image-fixture.js';
export type {ImageFixture};
export const imageEditor = (page: Page) => page.locator('[data-fixture-editor]');
export async function openImages(page: Page, surface = 'react', mode = 'wysiwyg') {
  await page.goto(`/images.html?surface=${surface}&mode=${mode}`);
  await page.waitForFunction(() => window.fixture?.ready);
  if (process.env.CRITREV_PACKAGE_ROOT) {
    const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(x => decodeURI(x.name)));
    expect(resources.some(x => x.includes(`${process.env.CRITREV_PACKAGE_ROOT}/dist/react/index.js`))).toBe(true);
    expect(resources.some(x => x.includes(`${process.env.CRITREV_PACKAGE_ROOT}/dist/lexical/index.js`))).toBe(true);
    expect(resources.some(x => /\/src\/(?:react|lexical)\//.test(x))).toBe(false);
  }
}
export async function choose(page: Page, start: number, end = start, backward = false) {
  await page.evaluate(([a, b, back]) => window.fixture.select(a as number, b as number, back as boolean), [start, end, backward]);
  await expect.poll(() => page.evaluate(() => window.fixture.range())).not.toBeNull();
}
export const text = (page: Page) => page.evaluate(() => window.fixture.value.text);
export const logs = (page: Page) => page.evaluate(() => window.fixture.logs) as Promise<Record<string, any>[]>;
export const undo = (page: Page) => page.keyboard.press('Control+z');
export const redo = (page: Page) => page.keyboard.press('Control+Shift+z');
export const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII=';
