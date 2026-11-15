import {expect, type Page} from '@playwright/test';
import type {ImageFixture} from '../../demo/src/image-fixture.js';
export type {ImageFixture};
export const imageEditor = (page: Page) => page.locator('[data-fixture-editor]');
export async function openImages(page: Page, surface = 'react', mode = 'wysiwyg') {
  await page.goto(`/images.html?surface=${surface}&mode=${mode}`);
  await page.waitForFunction(() => window.fixture?.ready);
  if (process.env.CRITREV_EXPECT_REACT) {
    const runtime = await page.evaluate(() => window.fixture.runtime);
    expect(runtime.react.split('.')[0]).toBe(process.env.CRITREV_EXPECT_REACT);
    expect(runtime.reactDOM.split('.')[0]).toBe(process.env.CRITREV_EXPECT_REACT);
  }
  if (process.env.CRITREV_PACKAGE_ROOT) {
    const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(x => decodeURI(x.name)));
    expect(resources.some(x => x.includes(`${process.env.CRITREV_PACKAGE_ROOT}/dist/react/index.js`))).toBe(true);
    expect(resources.some(x => x.includes(`${process.env.CRITREV_PACKAGE_ROOT}/dist/lexical/index.js`))).toBe(true);
    expect(resources.some(x => x.includes(`${process.cwd()}/src/`))).toBe(false);
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

// Native document positions distinguish carets that share a Markdown offset.
export const richView = (page: Page) => imageEditor(page).evaluate(root => {
  const selection = window.getSelection();
  const point = (node: Node | null, offset: number) => {
    if (!node || !root.contains(node)) return null;
    const path: number[] = [];
    while (node !== root) {
      path.unshift(Array.from(node.parentNode!.childNodes).indexOf(node as ChildNode));
      node = node.parentNode!;
    }
    return {path, offset};
  };
  return {
    blocks: Array.from(root.children).map(node => ({tag: node.tagName, text: node.textContent,
      images: Array.from(node.querySelectorAll('[data-critrev-image]')).map(image => ({src: image.getAttribute('data-src'), alt: image.getAttribute('aria-label')}))})),
    anchor: point(selection?.anchorNode ?? null, selection?.anchorOffset ?? 0),
    focus: point(selection?.focusNode ?? null, selection?.focusOffset ?? 0),
    selected: root.querySelectorAll('[data-critrev-image-selected]').length,
  };
});
