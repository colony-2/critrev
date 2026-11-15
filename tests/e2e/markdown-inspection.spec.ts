import {expect, test} from '@playwright/test';
import {choose, imageEditor, logs, openImages, png, redo, text, undo} from './image-helpers.js';
for (const surface of ['react', 'imperative']) test.describe(`${surface} inspection`, () => {
  test.beforeEach(async ({page}) => openImages(page, surface, 'source'));
  for (const markdown of ['Plain text', '**bold**', '![alt](pasted.png "")', '\\*literal\\*', '``a`b``']) test(`I01 exact canonical projection ${markdown}`, async ({page}) => {
    expect(await page.evaluate(value => window.fixture.inspect(value), markdown)).toEqual({exact: true, projectedMarkdown: markdown});
  });
  for (const markdown of ['_italic_', '* item', '~~~\ncode\n~~~', '  text  ', '\n\ntext\n\n', 'a\r\n\r\nb', '<img src="https://unbound.invalid/x">', '| a | b |\n|---|---|\n|1|2|', '[ref][id]\n\n[id]: x', '![alt][id]\n\n[id]: x', '- outer\n  - inner', '` a `', '![a\\]b](p\\(x\\).png "t\\\"q")']) test(`I02,I03 actual projection for ${JSON.stringify(markdown)}`, async ({page}) => {
    const inspection = await page.evaluate(value => window.fixture.inspect(value), markdown);
    expect(inspection.exact).toBe(inspection.projectedMarkdown === markdown);
    await page.evaluate(value => { window.fixture.load(value); window.fixture.modeTo('wysiwyg'); }, markdown);
    await choose(page, 0); await page.keyboard.type('X');
    // A real edit exports the same imported document; inspection never substitutes the input.
    const edited = await text(page); expect(edited.length).toBeGreaterThan(0);
    await page.keyboard.press('Backspace'); expect(await text(page)).toBe(inspection.projectedMarkdown);
    if (markdown === '_italic_') expect(inspection.projectedMarkdown).toBe('*italic*');
  });
  test('I04,I05 isolated inspection preserves focus, selection, callbacks, undo and network silence', async ({page}) => {
    await choose(page, 7, 13); await page.evaluate(() => window.fixture.insert(window.fixture.images));
    const before = await text(page); const range = await page.evaluate(() => window.fixture.range());
    const requests: string[] = []; await page.route('https://*.invalid/**', route => { requests.push(route.request().url()); return route.abort(); });
    await page.evaluate(url => { window.fixture.previews([['https://unbound.invalid/x', url]]); window.fixture.resetLogs(); for (let i = 0; i < 5; i++) window.fixture.inspect('![remote](https://unbound.invalid/x)'); }, png);
    expect(requests).toEqual([]); expect(await logs(page)).toEqual([]); expect(await text(page)).toBe(before); expect(await page.evaluate(() => window.fixture.range())).toEqual(range);
    await expect(imageEditor(page)).toBeFocused(); await undo(page); expect(await text(page)).toBe('Before target after'); await redo(page); expect(await text(page)).toBe(before);
  });
  test('I06 host inspection guard leaves mismatching source unchanged', async ({page}) => {
    const source = '_keep original_';
    const result = await page.evaluate(value => {
      window.fixture.load(value); const inspection = window.fixture.inspect(value);
      if (inspection.exact) window.fixture.modeTo('wysiwyg');
      return {mode: window.fixture.mode, message: inspection.exact ? '' : 'This Markdown needs source editing to preserve it. Your text is unchanged.'};
    }, source);
    expect(result).toEqual({mode: 'source', message: 'This Markdown needs source editing to preserve it. Your text is unchanged.'}); expect(await text(page)).toBe(source);
  });
});
