import {expect, test} from '@playwright/test';
import {choose, imageEditor, logs, openImages, redo, text, undo} from './image-helpers.js';
for (const surface of ['react', 'imperative']) for (const mode of ['source', 'wysiwyg']) test.describe(`${surface} ${mode} clipboard`, () => {
  test.beforeEach(async ({page}) => { await openImages(page, surface, mode); await choose(page, 7, 13); });
  test('P01,P02,P15 original files, order, one change and synchronous completion', async ({page}) => {
    expect(await page.evaluate(() => window.fixture.paste())).toBe(true);
    const events = await logs(page);
    expect(events.map(x => typeof x === 'string' ? x : Object.keys(x)[0])).toEqual(['paste', 'change', 'outcome', 'return']);
    expect(events[0]!.paste).toEqual(['clipboard-0.png', 'clipboard-1.png']);
    expect(events[2]!.identities).toBe(true); expect(events[2]!.outcome.inserted).toBe(true);
    expect(await text(page)).toBe('Before ![Flow diagram](pasted-a.png "Draft flow")![](pasted-b.png "") after');
    await undo(page); await redo(page); expect((await logs(page)).filter(x => x.paste)).toHaveLength(1);
  });
  for (const [paste, reason] of [['reject', 'rejected'], ['promise', 'invalid-result'], ['malformed', 'invalid-result'], ['empty', 'invalid-result'], ['count', 'count-mismatch'], ['invalid', 'invalid-image'], ['throw', 'callback-error'], ['fail', 'insertion-failed']]) {
    test(`P07–P14 ${paste} reports ${reason} once without partial edits`, async ({page}) => {
      await page.evaluate(paste => window.fixture.flags({paste}), paste);
      expect(await page.evaluate(() => window.fixture.paste())).toBe(true);
      expect(await text(page)).toBe('Before target after');
      const events = await logs(page); expect(events.filter(x => x.change)).toHaveLength(0);
      const outcomes = events.filter(x => x.outcome); expect(outcomes).toHaveLength(1);
      expect(outcomes[0]!.outcome).toMatchObject({inserted: false, reason}); expect(outcomes[0]!.identities).toBe(true);
      if (paste === 'throw' || paste === 'fail') {
        expect(events.findIndex(x => x.outcome)).toBeLessThan(events.findIndex(x => x.error));
      }
    });
  }
  for (const paste of ['move', 'outside', 'replace', 'disable', 'mode', 'dispose']) test(`P11,P12 host ${paste} aborts stale insertion`, async ({page}) => {
    await page.evaluate(paste => window.fixture.flags({paste}), paste);
    await page.evaluate(() => window.fixture.paste());
    const outcomes = (await logs(page)).filter(x => x.outcome);
    expect(outcomes).toHaveLength(1); expect(outcomes[0]!.outcome).toMatchObject({inserted: false, reason: 'selection-unavailable'});
    expect(await text(page)).toBe(paste === 'replace' ? 'Host replacement' : 'Before target after');
  });
  for (const resultThrow of [false, true]) test(`P16,P17 committed onChange failure with observer throw=${resultThrow}`, async ({page}) => {
    await page.evaluate(resultThrow => window.fixture.flags({changeThrow: true, resultThrow}), resultThrow);
    await page.evaluate(() => window.fixture.paste());
    expect(await text(page)).toContain('pasted-a.png');
    const events = await logs(page); expect(events.filter(x => x.outcome)).toHaveLength(1);
    expect(events.find(x => x.outcome)!.outcome.inserted).toBe(true);
    expect(events.filter(x => x.error)).toHaveLength(resultThrow ? 2 : 1);
    expect(events.findIndex(x => x.outcome)).toBeLessThan(events.findIndex(x => x.error));
  });
  for (const noError of [false, true]) test(`P18 rethrow occurs after outcome, default=${noError}`, async ({page}) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(noError => window.fixture.flags({paste: 'throw', noError, errorThrow: !noError}), noError);
    await page.evaluate(() => window.fixture.paste());
    await expect.poll(() => errors.length).toBeGreaterThan(0);
    expect((await logs(page)).filter(x => x.outcome)).toHaveLength(1);
  });
  test('P17 rejected outcome observer failure cannot insert fallback or emit another outcome', async ({page}) => {
    await page.evaluate(() => window.fixture.flags({paste: 'reject', resultThrow: true})); await page.evaluate(() => window.fixture.paste());
    expect(await text(page)).toBe('Before target after'); const events = await logs(page);
    expect(events.filter(x => x.outcome)).toHaveLength(1); expect(events.filter(x => x.error)).toHaveLength(1);
  });
  test('P03 ordinary non-image paste skips image callbacks', async ({page}) => {
    await page.evaluate(() => window.fixture.paste(1, 'text/plain'));
    expect((await logs(page)).filter(x => x.paste || x.outcome)).toHaveLength(0); expect(await text(page)).toContain('DUPLICATE');
  });
  for (const flags of [{readOnly: true}, {noChange: true}, {noPaste: true}, ...(surface === 'react' ? [{view: 'accept'}, {view: 'reject'}] : [])]) test(`P04,P06 ineligible ${JSON.stringify(flags)}`, async ({page}) => {
    await page.evaluate(flags => window.fixture.flags(flags), flags);
    await page.evaluate(() => window.fixture.paste());
    expect((await logs(page)).filter(x => x.paste || x.outcome)).toHaveLength(0); expect(await text(page)).not.toContain('pasted-a.png');
  });
  test('P05 selection outside and crossing the editor does not stage files', async ({page}) => {
    await page.evaluate(() => window.getSelection()!.setBaseAndExtent(document.getElementById('outside')!.firstChild!, 0, document.querySelector('[data-fixture-editor]')!.firstChild!, 0));
    await page.evaluate(() => window.fixture.paste()); expect((await logs(page)).filter(x => x.paste)).toHaveLength(0);
    await page.evaluate(() => window.getSelection()!.removeAllRanges());
    await page.evaluate(() => window.fixture.paste()); expect((await logs(page)).filter(x => x.paste)).toHaveLength(0);
  });
  test('P19 successful insertion without an outcome observer', async ({page}) => {
    await page.evaluate(() => window.fixture.flags({noResult: true})); await page.evaluate(() => window.fixture.paste());
    expect(await text(page)).toContain('pasted-a.png'); expect((await logs(page)).filter(x => x.outcome)).toHaveLength(0);
    await expect(imageEditor(page)).toBeAttached();
  });
});
