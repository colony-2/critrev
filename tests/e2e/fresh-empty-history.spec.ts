import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {expect, test, type Page} from '@playwright/test';
import {choose, imageEditor, logs, openImages, png, redo, richView, text, undo} from './image-helpers.js';

const empty = {text: '', comments: [], suggestions: [], highlights: []};
const typingTime = new Date('2026-11-21T00:00:00Z').getTime();
// These rapid-typing scenarios require one group. Bound Date.now explicitly so
// worker stalls cannot introduce an unintended >=300 ms pause between native
// key events. Timers, animation frames and selection scheduling remain real.
test.beforeEach(async ({page}) => {
  await page.addInitScript(time => { Date.now = () => time; }, typingTime);
});
const complete = (page: Page, value = '') => page.evaluate(() => window.fixture.value).then(model => expect(model).toEqual({...empty, text: value}));
const valid = async (page: Page) => expect(await imageEditor(page).evaluate(root => {
  const editor = (root as HTMLElement & {__lexicalEditor: {getEditorState(): {isEmpty(): boolean}}}).__lexicalEditor;
  return editor.getEditorState().isEmpty();
})).toBe(false);
const quiet = async (page: Page, errors: string[]) => {
  expect((await logs(page)).filter(x => x.error)).toEqual([]); expect(errors).toEqual([]);
};
const settle = async (page: Page) => {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
};

for (const surface of ['react', 'imperative']) {
  test(`${surface} FE-T01 a 300 ms typing pause creates a separate undo group`, async ({page}) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await openImages(page, surface, 'source', true); await choose(page, 0);
    await page.keyboard.type('-');
    await page.evaluate(time => { Date.now = () => time; }, typingTime + 300);
    await page.keyboard.type('--'); await complete(page, '---');
    await undo(page); await complete(page, '-'); await undo(page); await complete(page);
    await redo(page); await complete(page, '-'); await redo(page); await complete(page, '---');
    await quiet(page, errors);
  });
  for (const mode of ['wysiwyg', 'source']) test(`${surface} FE-N01–04,N08,N11 fresh ${mode} initialization, echoes and untouched switches`, async ({page}) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await openImages(page, surface, mode, true);
    await valid(page); await complete(page);
    expect((await richView(page)).blocks).toEqual([{tag: 'P', text: '', images: []}]);
    expect(await page.evaluate(() => ({active: document.activeElement?.tagName, range: window.fixture.range()}))).toEqual({active: 'BODY', range: null});
    await page.evaluate(() => { for (let i = 0; i < 3; i++) { window.fixture.echo(); window.fixture.modeTo('source'); window.fixture.modeTo('wysiwyg'); } });
    await valid(page); await complete(page); expect(await logs(page)).toEqual([]);
    expect(await page.evaluate(() => window.fixture.range())).toBeNull();
    await choose(page, 0); await page.evaluate(() => { window.fixture.echo(); window.fixture.modeTo('source'); window.fixture.modeTo('wysiwyg'); });
    expect(await page.evaluate(() => window.fixture.range())).toEqual({start: 0, end: 0});
    await undo(page); await redo(page); await complete(page); expect(await logs(page)).toEqual([]); await quiet(page, errors);
  });
  if (surface === 'imperative') test('FE-N02 imperative synchronous use before setModel', async ({page}) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/images.html?surface=imperative&empty&before-set-model'); await page.waitForFunction(() => window.fixture?.ready);
    await valid(page); await complete(page); expect(await logs(page)).toEqual([]);
    await choose(page, 0); await page.keyboard.type('word'); await complete(page, 'word');
    await undo(page); await complete(page); await valid(page); await redo(page); await complete(page, 'word'); await quiet(page, errors);
  });

  // Each repetition navigates to a new document whose empty value exists before
  // either surface mounts. Immediate selection never dispatches selectionchange;
  // paste and mode changes run in that same event. Settled cases wait two frames.
  for (const timing of ['immediate', 'settled']) {
    for (const initialMode of ['wysiwyg', 'source']) {
      for (const route of initialMode === 'source' ? ['direct', 'switched'] : ['switched']) for (const value of ['---', '## ', 'word']) test(`${surface} FE-N05–09,N15,R09 ${timing} fresh ${initialMode} ${route} first source edit ${JSON.stringify(value)} ×10`, async ({page}, info) => {
        test.setTimeout(90_000);
        const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
        for (let mount = 0; mount < 10; mount++) {
          await openImages(page, surface, initialMode, true);
          if (timing === 'settled') await settle(page);
          await page.evaluate(switched => {
            if (switched) { window.fixture.modeTo('source'); window.fixture.modeTo('wysiwyg'); }
            window.fixture.modeTo('source'); window.fixture.select(0, 0, false, false);
          }, route === 'switched');
          if (timing === 'settled') await settle(page);
          await page.keyboard.type(value); await complete(page, value);
          const edited = await richView(page);
          expect(await page.evaluate(() => window.fixture.range())).toEqual({start: value.length, end: value.length});
          for (let cycle = 0; cycle < 3; cycle++) {
            await undo(page); await complete(page); await valid(page);
            expect(await page.evaluate(() => window.fixture.range())).toEqual({start: 0, end: 0});
            await redo(page); await complete(page, value); expect(await richView(page)).toEqual(edited);
          }
          // Inspection reports the actual importer/exporter result, including the trailing space.
          const inspection = await page.evaluate(value => window.fixture.inspect(value), value);
          expect(inspection.exact).toBe(inspection.projectedMarkdown === value);
          if (value === '## ') expect(inspection.projectedMarkdown).toBe('## ');
          if (value === 'word') {
            await undo(page); await page.evaluate(() => window.fixture.modeTo('wysiwyg')); await redo(page); await complete(page, value);
          }
          if (mount === 0 && value === '## ' && initialMode === 'wysiwyg' && timing === 'immediate' && surface === 'react' && process.env.REVIEW_CAPTURE_DIR) {
            await mkdir(process.env.REVIEW_CAPTURE_DIR, {recursive: true});
            await page.screenshot({path: join(process.env.REVIEW_CAPTURE_DIR, `fresh-source-heading-${info.project.name}.png`), animations: 'disabled'});
          }
          await quiet(page, errors);
        }
      });
      for (const route of ['direct', 'switched']) test(`${surface} FE-I01–04,I09,R09 ${timing} fresh ${initialMode} ${route} first paste ×10`, async ({page}, info) => {
        test.setTimeout(90_000);
        const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
        for (let mount = 0; mount < 10; mount++) {
          await openImages(page, surface, initialMode, true);
          const selectAndSwitch = ({mode, switched}: {mode: string; switched: boolean}) => {
            if (switched) { window.fixture.modeTo(mode === 'source' ? 'wysiwyg' : 'source'); window.fixture.modeTo(mode as 'source' | 'wysiwyg'); }
            window.fixture.select(0, 0, false, false);
          };
          const setup = {mode: initialMode, switched: route === 'switched'};
          if (timing === 'settled') { await page.evaluate(selectAndSwitch, setup); await settle(page); }
          expect(await page.evaluate(({mode, switched, immediate}) => {
            if (immediate) {
              if (switched) { window.fixture.modeTo(mode === 'source' ? 'wysiwyg' : 'source'); window.fixture.modeTo(mode as 'source' | 'wysiwyg'); }
              window.fixture.select(0, 0, false, false);
            }
            return window.fixture.paste();
          }, {...setup, immediate: timing === 'immediate'})).toBe(true);
          const committed = '![Flow diagram](pasted-a.png "Draft flow")![](pasted-b.png "")';
          await complete(page, committed); const pasted = await richView(page);
          const events = await logs(page);
          expect(events.filter(x => Object.prototype.hasOwnProperty.call(x, 'change'))).toHaveLength(1); expect(events.filter(x => x.paste)).toHaveLength(1);
          expect(events.filter(x => x.outcome)).toMatchObject([{outcome: {inserted: true}, identities: true}]);
          for (let cycle = 0; cycle < 3; cycle++) {
            await undo(page); await complete(page); await valid(page);
            expect(await page.evaluate(() => window.fixture.range())).toEqual({start: 0, end: 0});
            await redo(page); await complete(page, committed); expect(await richView(page)).toEqual(pasted);
          }
          expect((await logs(page)).filter(x => Object.prototype.hasOwnProperty.call(x, 'change'))).toHaveLength(7);
          expect((await logs(page)).filter(x => x.paste || x.outcome)).toHaveLength(2);
          if (mount === 0 && route === 'switched' && initialMode === 'wysiwyg' && timing === 'immediate' && surface === 'react' && process.env.REVIEW_CAPTURE_DIR) {
            await mkdir(process.env.REVIEW_CAPTURE_DIR, {recursive: true});
            await page.screenshot({path: join(process.env.REVIEW_CAPTURE_DIR, `fresh-first-paste-${info.project.name}.png`), animations: 'disabled'});
          }
          await quiet(page, errors);
        }
      });
    }
  }
  test(`${surface} FE-N13 legacy empty endpoint prepares separately before source selection mapping`, async ({page}) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await openImages(page, surface, 'wysiwyg', true);
    expect(await page.evaluate(() => window.fixture.legacyEmptyEndpoint())).toEqual({injected: true, unchanged: true, empty: true});
    await choose(page, 0); await page.keyboard.type('first'); await complete(page, 'first');
    await undo(page); await complete(page); await page.evaluate(() => window.fixture.modeTo('wysiwyg')); await valid(page);
    await redo(page); await complete(page, 'first'); await quiet(page, errors);
  });
  test(`${surface} FE-N15 nonexact first source history remains available after rich refusal`, async ({page}) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await openImages(page, surface, 'source', true); await choose(page, 0); await page.keyboard.insertText('_first_');
    // Moving from the end caret to a range creates a separate typing group.
    await choose(page, 0, 7); await page.keyboard.insertText('plain');
    await page.evaluate(() => window.fixture.modeTo('wysiwyg')); await undo(page); await complete(page, 'plain');
    await page.evaluate(() => window.fixture.modeTo('source')); await undo(page); await complete(page, '_first_');
    await undo(page); await complete(page); await redo(page); await complete(page, '_first_'); await redo(page); await complete(page, 'plain');
    await quiet(page, errors);
  });
  for (const mode of ['source', 'wysiwyg']) test(`${surface} FE-N07,N12 first ${mode} typing coalesces and Enter separates edits`, async ({page}) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await openImages(page, surface, mode, true); await choose(page, 0);
    await page.keyboard.type('word'); await undo(page); await complete(page); await valid(page); await redo(page); await complete(page, 'word');
    await page.keyboard.press('Enter'); const entered = await text(page), paragraph = await richView(page);
    await page.keyboard.type('next'); const final = await text(page);
    await undo(page); await complete(page, entered); if (mode === 'wysiwyg') expect(await richView(page)).toEqual(paragraph);
    await undo(page); await complete(page, 'word'); await undo(page); await complete(page);
    await redo(page); await redo(page); await redo(page); await complete(page, final); await quiet(page, errors);
  });
  for (const backward of [false, true]) test(`${surface} FE-N09,N10 first source ranges map direction backward=${backward}`, async ({page}) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await openImages(page, surface, 'wysiwyg', true);
    await page.evaluate(() => { window.fixture.modeTo('source'); window.fixture.select(0); }); await page.keyboard.type('first');
    await page.evaluate(() => window.fixture.modeTo('wysiwyg')); await page.evaluate(() => window.fixture.modeTo('source'));
    await choose(page, 1, 4, backward); await page.keyboard.insertText('X'); await complete(page, 'fXt');
    await page.evaluate(() => window.fixture.modeTo('wysiwyg'));
    await undo(page); await complete(page, 'first'); const range = await richView(page);
    expect(range.anchor?.offset).toBe(backward ? 4 : 1); expect(range.focus?.offset).toBe(backward ? 1 : 4);
    await redo(page); await complete(page, 'fXt'); await quiet(page, errors);
  });
  for (const mode of ['source', 'wysiwyg']) test(`${surface} FE-I04,I05 first ${mode} public batch retains exact metadata and previews`, async ({page}) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await openImages(page, surface, mode, true);
    expect(await page.evaluate(() => {
      window.fixture.select(0, 0, false, false);
      return window.fixture.insert([{src: 'a(b).png', alt: 'a]b'}, {src: 'empty.png', alt: '', title: ''}, {src: 'title.png', alt: 'Label', title: 'A "title"'}]);
    })).toBe(true);
    const committed = await text(page); expect(committed).toContain('a\\]b'); expect(committed).toContain('a\\(b\\).png');
    await page.evaluate(() => window.fixture.modeTo('wysiwyg'));
    const images = imageEditor(page).locator('[data-critrev-image]'); await expect(images).toHaveCount(3);
    expect(await images.evaluateAll(elements => elements.map(x => ({src: x.getAttribute('data-src'), title: x.getAttribute('data-title')})))).toEqual([{src: 'a(b).png', title: null}, {src: 'empty.png', title: ''}, {src: 'title.png', title: 'A "title"'}]);
    await page.evaluate(url => window.fixture.previews([['empty.png', url]]), png);
    for (let cycle = 0; cycle < 3; cycle++) {
      await undo(page); await complete(page); await valid(page); await redo(page); await complete(page, committed);
      await expect(images.nth(1).locator('img')).toHaveAttribute('src', png);
    }
    await undo(page); await page.evaluate(() => window.fixture.previews([])); await redo(page);
    await expect(images.nth(1)).toContainText('Preview unavailable');
    await images.nth(1).click(); const selected = await richView(page);
    await page.evaluate(() => { window.fixture.modeTo('source'); window.fixture.modeTo('wysiwyg'); });
    expect(await richView(page)).toEqual(selected); await quiet(page, errors);
  });
  for (const fault of ['prepare-fail', 'fail']) test(`${surface} FE-I06,I07 fresh ${fault} keeps empty state and redo`, async ({page}) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await openImages(page, surface, 'wysiwyg', true); await choose(page, 0); await page.evaluate(() => window.fixture.paste());
    const committed = await text(page); await undo(page); const before = await richView(page);
    await page.evaluate(fault => { window.fixture.resetLogs(); window.fixture.flags({paste: fault}); window.fixture.paste(); }, fault);
    await complete(page); expect(await richView(page)).toEqual(before); await valid(page);
    expect((await logs(page)).filter(x => Object.prototype.hasOwnProperty.call(x, 'change'))).toHaveLength(0);
    expect((await logs(page)).filter(x => x.outcome)).toMatchObject([{outcome: {inserted: false, reason: 'insertion-failed'}}]);
    expect((await logs(page)).filter(x => x.error)).toHaveLength(1); expect(errors).toEqual([]);
    await redo(page); await complete(page, committed);
  });
  test(`${surface} FE-R04,R05 fresh inspection is strict and nonmutating`, async ({page}) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await openImages(page, surface, 'source', true); await choose(page, 0); const before = await richView(page);
    const requests: string[] = []; await page.route('https://*.invalid/**', route => { requests.push(route.request().url()); return route.abort(); });
    const results = await page.evaluate(() => ['','---','## ',' ', '\n', '\r\n', '![remote](https://unbound.invalid/x)'].map(value => ({value, ...window.fixture.inspect(value)})));
    expect(results[0]).toEqual({value: '', exact: true, projectedMarkdown: ''});
    for (const result of results) expect(result.exact).toBe(result.value === result.projectedMarkdown);
    expect(results.find(x => x.value === '## ')?.projectedMarkdown).toBe('## ');
    await complete(page); expect(await richView(page)).toEqual(before); expect(await logs(page)).toEqual([]); expect(requests).toEqual([]);
    await undo(page); await redo(page); await complete(page); await quiet(page, errors);
  });
}
