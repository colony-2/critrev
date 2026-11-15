import {expect, test} from '@playwright/test';
import {choose, imageEditor, logs, openImages, redo, text, undo} from './image-helpers.js';
for (const surface of ['react', 'imperative']) for (const mode of ['source', 'wysiwyg']) test.describe(`${surface} ${mode} history`, () => {
  test.beforeEach(async ({page}) => openImages(page, surface, mode));
  test('H01,H02,H04 equal echoes and fresh callbacks preserve nodes, selection and history', async ({page}) => {
    await choose(page, 7); await page.evaluate(() => window.fixture.insert(window.fixture.images));
    const original = await text(page);
    await imageEditor(page).evaluate(root => Object.assign(root.firstChild!, {echoMarker: true}));
    const range = await page.evaluate(() => window.fixture.range());
    await page.evaluate(() => { window.fixture.echo(); window.fixture.callbacks(); });
    expect(await imageEditor(page).evaluate(root => (root.firstChild as Node & {echoMarker?: boolean}).echoMarker)).toBe(true);
    expect(await page.evaluate(() => window.fixture.range())).toEqual(range);
    await undo(page); await expect.poll(() => text(page)).toBe('Before target after'); await redo(page); await expect.poll(() => text(page)).toBe(original);
    await page.evaluate(() => window.fixture.resetLogs()); await page.evaluate(() => window.fixture.paste());
    expect((await logs(page)).find(x => x.paste)!.revision).toBe(1); expect((await logs(page)).find(x => x.outcome)!.revision).toBe(1);
  });
  for (const annotation of [false, true]) test(`H03 external replacement clears unrelated undo annotation=${annotation}`, async ({page}) => {
    await choose(page, 0); await page.evaluate(() => window.fixture.insert(window.fixture.images));
    await page.evaluate(annotation => { window.fixture.resetLogs(); window.fixture.loadModel({text: 'Different draft', suggestions: [], comments: annotation ? [{id: 'new', start: 0, end: 1, value: 'note'}] : [], highlights: []}); }, annotation);
    expect(await logs(page)).toHaveLength(0); await imageEditor(page).focus(); await undo(page);
    expect(await text(page)).toBe('Different draft');
  });
  test('H05–H08 insertion, source editing and redo survive repeated mode changes', async ({page}) => {
    await choose(page, 7, 13, true); await page.evaluate(() => window.fixture.insert([window.fixture.images[0]!]));
    const inserted = await text(page);
    await page.evaluate(() => { window.fixture.resetLogs(); window.fixture.modeTo('source'); }); expect(await logs(page)).toHaveLength(0);
    await page.keyboard.press('Control+End'); await page.keyboard.type('X'); const edited = await text(page);
    await page.evaluate(() => window.fixture.modeTo('wysiwyg'));
    await undo(page); await expect.poll(() => text(page)).toBe(inserted);
    await undo(page); await expect.poll(() => text(page)).toBe('Before target after');
    await page.evaluate(() => window.fixture.modeTo('source')); await redo(page); await expect.poll(() => text(page)).toBe(inserted);
    await page.evaluate(() => window.fixture.modeTo('wysiwyg')); await redo(page); await expect.poll(() => text(page)).toBe(edited);
    await expect(imageEditor(page).locator('[data-critrev-image]')).toHaveCount(1);
    expect((await logs(page)).filter(x => x.paste)).toHaveLength(0);
  });
  test('A14,H06 source metadata and deletion retain exact image records after switches', async ({page}) => {
    await page.evaluate(() => { window.fixture.modeTo('source'); window.fixture.load('![new alt](new.png "")'); });
    await page.evaluate(() => window.fixture.modeTo('wysiwyg'));
    const image = imageEditor(page).locator('[data-critrev-image]'); await image.click(); await page.keyboard.press('Delete');
    await page.evaluate(() => window.fixture.modeTo('source')); await undo(page); expect(await text(page)).toBe('![new alt](new.png "")');
    await page.evaluate(() => window.fixture.modeTo('wysiwyg')); await redo(page); expect(await text(page)).toBe('');
    await undo(page); await expect(image).toHaveAttribute('aria-label', 'new alt');
  });
  test('H10 committed outcome remains successful after controlled replacement', async ({page}) => {
    await choose(page, 0); await page.evaluate(() => window.fixture.flags({replaceOnChange: true}));
    await page.evaluate(() => window.fixture.paste());
    expect(await text(page)).toBe('Owner replacement'); expect((await logs(page)).find(x => x.outcome)!.outcome.inserted).toBe(true);
  });
  test('H12 incompatible older snapshot is retained for source replay', async ({page}) => {
    await page.evaluate(() => { window.fixture.modeTo('source'); window.fixture.load('_word_'); });
    // One replacement keeps this about replay compatibility, independent of
    // whether a busy browser exceeds the ordinary typing-group timeout.
    await choose(page, 0, 6); await page.keyboard.insertText('word');
    await page.evaluate(() => window.fixture.modeTo('wysiwyg')); await undo(page); expect(await text(page)).toBe('word');
    await page.evaluate(() => window.fixture.modeTo('source')); await undo(page); expect(await text(page)).toBe('_word_');
  });
  if (surface === 'react') {
    for (const method of ['direct', 'paste']) test(`H01 ${method}: rapid undo/redo keeps history during synchronous controlled notifications`, async ({page}) => {
      await choose(page, 0);
      expect(await page.evaluate(method => method === 'direct'
        ? window.fixture.insert(window.fixture.images) : window.fixture.paste(), method)).toBe(true);
      // Do not poll or yield to a paint between commands. A previous render's
      // passive effects can flush inside the next synchronous owner callback.
      for (let cycle = 0; cycle < 20; cycle++) { await undo(page); await redo(page); }
      const committed = '![Flow diagram](pasted-a.png "Draft flow")![](pasted-b.png "")Before target after';
      expect(await text(page)).toBe(committed);
      const events = await logs(page), changes = events.filter(event => event.change);
      expect(changes).toHaveLength(41);
      expect(changes.map(event => event.change)).toEqual([
        committed, ...Array.from({length: 20}, () => ['Before target after', committed]).flat(),
      ]);
      expect(events.filter(event => event.outcome)).toHaveLength(method === 'paste' ? 1 : 0);
      expect(events.filter(event => event.error)).toHaveLength(0);
    });
    test('H09,V08 a fresh draft key cannot undo into the previous draft', async ({page}) => {
      await choose(page, 0); await page.evaluate(() => window.fixture.insert(window.fixture.images));
      await page.evaluate(() => { window.fixture.flags({draft: 'fresh'}); window.fixture.load('Fresh draft'); });
      await imageEditor(page).focus(); await undo(page); expect(await text(page)).toBe('Fresh draft');
    });
    test('H11 read-only view projections do not replace authoritative annotations', async ({page}) => {
      await page.evaluate(() => window.fixture.loadModel({text: 'ab', suggestions: [{id: 's', type: 'addition', newRange: {start: 1, end: 2}}], comments: [], highlights: []}));
      for (const view of ['accept', 'reject', undefined]) {
        await page.evaluate(view => window.fixture.flags(view ? {view} : {}), view);
        expect(await page.evaluate(() => window.fixture.value.suggestions.length)).toBe(1);
      }
      expect(await logs(page)).toHaveLength(0);
    });
  }
});
