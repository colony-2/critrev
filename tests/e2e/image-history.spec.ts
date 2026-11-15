import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {expect, test} from '@playwright/test';
import {choose, imageEditor, logs, openImages, redo, richView, text, undo} from './image-helpers.js';
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
    const edited = await text(page);
    await page.evaluate(annotation => { const current = window.fixture.value; const start = current.text.indexOf('Before'); window.fixture.resetLogs(); window.fixture.loadModel({text: annotation ? current.text : 'Different draft', suggestions: [], comments: annotation ? [{id: 'new', start, end: start + 1, value: 'note'}] : [], highlights: []}); }, annotation);
    expect(await logs(page)).toHaveLength(0); await imageEditor(page).focus(); await undo(page);
    expect(await text(page)).toBe(annotation ? edited : 'Different draft');
    expect(await page.evaluate(() => window.fixture.value.comments.length)).toBe(annotation ? 1 : 0);
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

for (const surface of ['react', 'imperative']) test.describe(`${surface} retained rich history`, () => {
  test.beforeEach(async ({page}) => {
    await openImages(page, surface);
    await page.evaluate(() => window.fixture.load('Build the release dashboard.'));
    await choose(page, 28);
  });
  test('R01,R03,R09,R10,F10 Enter and paste replay exact empty paragraphs and native carets', async ({page}, info) => {
    const initial = await richView(page);
    await page.keyboard.press('Enter');
    expect(await text(page)).toBe('Build the release dashboard.\n\n');
    const empty = await richView(page);
    expect(empty.blocks).toHaveLength(2); expect(empty.anchor).toEqual({path: [1], offset: 0});
    expect(await page.evaluate(() => window.fixture.inspect(window.fixture.value.text))).toEqual({exact: false, projectedMarkdown: 'Build the release dashboard.'});
    await page.evaluate(() => { window.fixture.echo(); window.fixture.callbacks(); window.fixture.modeTo('source'); window.fixture.modeTo('wysiwyg'); });
    expect(await richView(page)).toEqual(empty);
    await page.evaluate(() => window.fixture.paste(1));
    const pasted = await richView(page);
    expect(await text(page)).toBe('Build the release dashboard.\n\n![Flow diagram](pasted-a.png "Draft flow")');
    for (let cycle = 0; cycle < 3; cycle++) {
      await undo(page); expect(await text(page)).toBe('Build the release dashboard.\n\n'); expect(await richView(page)).toEqual(empty);
      await undo(page); expect(await text(page)).toBe('Build the release dashboard.'); expect(await richView(page)).toEqual(initial);
      await redo(page); expect(await richView(page)).toEqual(empty);
      await redo(page); expect(await richView(page)).toEqual(pasted);
    }
    await page.screenshot({path: info.outputPath('rich-paste-after-enter.png'), animations: 'disabled'});
    if (process.env.REVIEW_CAPTURE_DIR && surface === 'react') {
      await mkdir(process.env.REVIEW_CAPTURE_DIR, {recursive: true});
      await page.screenshot({path: join(process.env.REVIEW_CAPTURE_DIR, `rich-paste-after-enter-${info.project.name}.png`), animations: 'disabled'});
    }
    await undo(page);
    await page.screenshot({path: info.outputPath('rich-undo-paste-empty-paragraph.png'), animations: 'disabled'});
    if (process.env.REVIEW_CAPTURE_DIR && surface === 'react') await page.screenshot({path: join(process.env.REVIEW_CAPTURE_DIR, `rich-undo-paste-empty-paragraph-${info.project.name}.png`), animations: 'disabled'});
  });
  test('R02 rapid typing on both sides of Enter has separate boundaries', async ({page}) => {
    await page.keyboard.type('A'); const typed = await richView(page);
    await page.keyboard.press('Enter'); const empty = await richView(page);
    await page.keyboard.type('B'); const final = await richView(page);
    await undo(page); expect(await text(page)).toBe('Build the release dashboard.A\n\n'); expect(await richView(page)).toEqual(empty);
    await undo(page); expect(await text(page)).toBe('Build the release dashboard.A'); expect(await richView(page)).toEqual(typed);
    await undo(page); expect(await text(page)).toBe('Build the release dashboard.');
    await redo(page); expect(await richView(page)).toEqual(typed); await redo(page); expect(await richView(page)).toEqual(empty); await redo(page); expect(await richView(page)).toEqual(final);
  });
  for (const key of ['Delete', 'Backspace']) for (const title of [undefined, '', 'Draft flow']) test(`R04,R05 final image ${key} title=${title}`, async ({page}, info) => {
    await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
    await page.evaluate(title => window.fixture.insert([{src: 'pasted-a.png', alt: 'Flow diagram', ...(title === undefined ? {} : {title})}]), title);
    const committed = await text(page);
    const image = imageEditor(page).locator('[data-critrev-image]'); await image.click();
    await page.keyboard.press(key);
    const deleted = await richView(page);
    expect(await text(page)).toBe('Build the release dashboard.\n\n\n\n');
    expect(deleted.blocks).toHaveLength(3);
    for (let cycle = 0; cycle < 3; cycle++) {
      await undo(page); expect(await text(page)).toBe(committed); await expect(image).toHaveAttribute('data-critrev-image-selected', 'true');
      expect(await image.getAttribute('data-title')).toBe(title ?? null);
      await redo(page); expect(await text(page)).toBe('Build the release dashboard.\n\n\n\n'); expect(await richView(page)).toEqual(deleted);
    }
    if (process.env.REVIEW_CAPTURE_DIR && surface === 'react' && title === 'Draft flow' && key === 'Delete') {
      await mkdir(process.env.REVIEW_CAPTURE_DIR, {recursive: true});
      await page.screenshot({path: join(process.env.REVIEW_CAPTURE_DIR, `rich-final-image-deleted-${info.project.name}.png`), animations: 'disabled'});
      await undo(page);
      await page.screenshot({path: join(process.env.REVIEW_CAPTURE_DIR, `rich-final-image-restored-${info.project.name}.png`), animations: 'disabled'});
    }
  });
  test('R02 typing into a new empty paragraph coalesces as one ordinary edit', async ({page}) => {
    await page.keyboard.press('Enter'); const empty = await richView(page);
    await page.keyboard.type('word'); expect(await text(page)).toBe('Build the release dashboard.\n\nword');
    await undo(page); expect(await text(page)).toBe('Build the release dashboard.\n\n'); expect(await richView(page)).toEqual(empty);
    await redo(page); expect(await text(page)).toBe('Build the release dashboard.\n\nword');
  });
  test('R04 range deletion of an image stays separate from typing on both sides', async ({page}) => {
    await page.evaluate(() => window.fixture.load('A![alt](a.png)B')); await choose(page, 3);
    await page.keyboard.type('C'); expect(await text(page)).toBe('A![alt](a.png)BC');
    await choose(page, 1, 2); await page.keyboard.press('Delete'); expect(await text(page)).toBe('ABC');
    await page.keyboard.type('D'); expect(await text(page)).toBe('ADBC');
    await undo(page); expect(await text(page)).toBe('ABC');
    await undo(page); expect(await text(page)).toBe('A![alt](a.png)BC');
    await undo(page); expect(await text(page)).toBe('A![alt](a.png)B');
    await redo(page); await redo(page); await redo(page); expect(await text(page)).toBe('ADBC');
  });
  test('R06 intervening empty paragraphs survive insertion and branch edits', async ({page}) => {
    await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
    const empty = await richView(page);
    await page.evaluate(() => window.fixture.insert(window.fixture.images));
    const inserted = await richView(page);
    expect(await text(page)).toBe('Build the release dashboard.\n\n\n\n\n\n![Flow diagram](pasted-a.png "Draft flow")![](pasted-b.png "")');
    await undo(page); expect(await richView(page)).toEqual(empty); await redo(page); expect(await richView(page)).toEqual(inserted);
    await undo(page); await page.keyboard.type('Branch'); await redo(page);
    expect(await text(page)).toBe('Build the release dashboard.\n\n\n\n\n\nBranch');
    await undo(page); expect(await richView(page)).toEqual(empty);
  });
  for (const fault of ['fail', 'prepare-fail']) test(`F02,F03 ${fault} after Enter restores document, selection and redo branch`, async ({page}) => {
    await page.keyboard.press('Enter'); const empty = await richView(page);
    await page.evaluate(() => window.fixture.insert(window.fixture.images)); const inserted = await text(page); await undo(page);
    await page.evaluate(fault => { window.fixture.resetLogs(); window.fixture.flags({paste: fault}); window.fixture.paste(); }, fault);
    expect(await richView(page)).toEqual(empty); expect(await text(page)).toBe('Build the release dashboard.\n\n');
    expect((await logs(page)).filter(x => x.change)).toHaveLength(0);
    expect((await logs(page)).filter(x => x.outcome).map(x => x.outcome)).toMatchObject([{inserted: false, reason: 'insertion-failed'}]);
    await redo(page); expect(await text(page)).toBe(inserted);
  });
  for (const backward of [false, true]) test(`R08 rich insertion replays native range direction backward=${backward}`, async ({page}) => {
    await choose(page, 6, 17, backward); const selected = await richView(page);
    await page.evaluate(() => window.fixture.insert(window.fixture.images)); const inserted = await richView(page);
    expect(inserted.anchor).toEqual(inserted.focus);
    await undo(page); expect(await richView(page)).toEqual(selected);
    await redo(page); expect(await richView(page)).toEqual(inserted);
  });
  test('R07 equal-model structural edits are replayable and caret movement creates no entry', async ({page}) => {
    await page.evaluate(() => window.fixture.load('a\n\nb')); await choose(page, 0);
    const initial = await richView(page); await page.evaluate(() => { window.fixture.resetLogs(); window.fixture.equalModelStructure(); });
    const changed = await richView(page); expect(changed.blocks).toHaveLength(1); expect(await text(page)).toBe('a\n\nb');
    expect(await logs(page)).toHaveLength(0);
    await page.keyboard.press('ArrowLeft'); await undo(page); expect(await richView(page)).toEqual(initial);
    await redo(page); expect(await richView(page)).toEqual(changed); expect(await logs(page)).toHaveLength(0);
  });
  for (const fault of ['projection', 'render']) test(`F09 ${fault} failure refuses replay without consuming its endpoint`, async ({page}) => {
    await page.keyboard.press('Enter'); await page.evaluate(() => window.fixture.insert(window.fixture.images));
    await page.evaluate(() => window.fixture.imageProjectionFault(false));
    await imageEditor(page).locator('[data-critrev-image]').first().click(); await page.keyboard.press('Delete');
    await imageEditor(page).locator('[data-critrev-image]').first().click(); await page.keyboard.press('Delete');
    const before = await richView(page), beforeText = await text(page);
    await page.evaluate(fault => { window.fixture.resetLogs(); if (fault === 'projection') window.fixture.imageProjectionFault(true); else window.fixture.failNextRender(); }, fault);
    await undo(page); expect(await text(page)).toBe(beforeText); expect(await richView(page)).toEqual(before);
    expect((await logs(page)).filter(x => x.change)).toHaveLength(0);
    await page.evaluate(() => window.fixture.imageProjectionFault(false));
    await undo(page); await expect(imageEditor(page).locator('[data-critrev-image]')).toHaveCount(1);
  });
  test('F07 replay observer errors preserve committed history and use the existing error handler', async ({page}) => {
    const unhandled: string[] = []; page.on('pageerror', error => unhandled.push(error.message));
    await page.keyboard.press('Enter'); await page.evaluate(() => window.fixture.paste(1));
    const pasted = await text(page);
    await page.evaluate(() => { window.fixture.resetLogs(); window.fixture.flags({changeThrow: true}); });
    await undo(page); expect(await text(page)).toBe('Build the release dashboard.\n\n');
    await redo(page); expect(await text(page)).toBe(pasted);
    expect((await logs(page)).filter(x => x.error).map(x => x.error)).toEqual(['change callback failure', 'change callback failure']);
    expect((await logs(page)).filter(x => x.paste || x.outcome)).toHaveLength(0); expect(unhandled).toEqual([]);
  });
  test('R13 synchronous owner replacement during replay clears the previous branch', async ({page}) => {
    await page.keyboard.press('Enter'); await page.evaluate(() => window.fixture.insert(window.fixture.images));
    await page.evaluate(() => window.fixture.flags({replaceOnChange: true})); await undo(page);
    expect(await text(page)).toBe('Owner replacement');
    await page.evaluate(() => window.fixture.flags({})); await redo(page); await undo(page);
    expect(await text(page)).toBe('Owner replacement');
  });
  for (const blocked of [{readOnly: true}, ...(surface === 'react' ? [{view: 'accept'}, {view: 'reject'}] : [])]) test(`R16 ${JSON.stringify(blocked)} replay preserves the endpoint for later editing`, async ({page}) => {
    await page.keyboard.press('Enter'); const empty = await richView(page);
    await page.evaluate(blocked => window.fixture.flags(blocked), blocked); await undo(page);
    expect(await text(page)).toBe('Build the release dashboard.\n\n'); expect((await richView(page)).blocks).toEqual(empty.blocks);
    await page.evaluate(() => window.fixture.flags({})); await imageEditor(page).focus(); await undo(page);
    expect(await text(page)).toBe('Build the release dashboard.');
  });
  test('R02 a fresh empty adapter keeps ordinary typing in one undo step', async ({page}) => {
    await page.evaluate(() => { window.fixture.createPeer(''); window.fixture.selectPeerEnd(); });
    await page.keyboard.type('word'); expect((await page.evaluate(() => window.fixture.peerValue())).text).toBe('word');
    await undo(page); expect((await page.evaluate(() => window.fixture.peerValue())).text).toBe('');
    await redo(page); expect((await page.evaluate(() => window.fixture.peerValue())).text).toBe('word');
    await page.evaluate(() => window.fixture.disposePeer());
  });
  test('R14 two adapters keep independent rich endpoints and disposal releases replay', async ({page}) => {
    await page.keyboard.press('Enter');
    await page.evaluate(() => window.fixture.createPeer());
    const peer = page.locator('[data-peer-editor]'); await peer.focus(); await undo(page);
    expect((await page.evaluate(() => window.fixture.peerValue())).text).toBe('Peer draft');
    await page.evaluate(() => window.fixture.selectPeerEnd()); await page.keyboard.press('Enter');
    expect((await page.evaluate(() => window.fixture.peerValue())).text).toBe('Peer draft\n\n');
    await imageEditor(page).focus(); await undo(page); expect(await text(page)).toBe('Build the release dashboard.');
    await peer.focus(); await undo(page); expect((await page.evaluate(() => window.fixture.peerValue())).text).toBe('Peer draft');
    expect(await page.evaluate(() => { window.fixture.disposePeer(); return window.fixture.insertPeer(); })).toBe(false);
  });
  test('R10 undoing a compatible source edit reuses the preceding rich empty paragraph', async ({page}) => {
    await page.keyboard.press('Enter'); const empty = await richView(page);
    await page.evaluate(() => window.fixture.modeTo('source')); await choose(page, 30); await page.keyboard.type('X');
    expect(await text(page)).toBe('Build the release dashboard.\n\nX');
    expect((await page.evaluate(() => window.fixture.inspect(window.fixture.value.text))).exact).toBe(true);
    await page.evaluate(() => window.fixture.modeTo('wysiwyg'));
    await undo(page); expect(await text(page)).toBe('Build the release dashboard.\n\n'); expect(await richView(page)).toEqual(empty);
    await undo(page); expect(await text(page)).toBe('Build the release dashboard.');
    await redo(page); expect(await richView(page)).toEqual(empty);
    await redo(page); expect(await text(page)).toBe('Build the release dashboard.\n\nX');
  });
  for (const backward of [false, true]) test(`R11 source-edit undo maps the moved range backward=${backward}`, async ({page}) => {
    await page.keyboard.press('Enter');
    await page.evaluate(() => window.fixture.modeTo('source')); await choose(page, 0, 30, backward); await page.keyboard.insertText('After');
    await page.evaluate(() => window.fixture.modeTo('wysiwyg')); await undo(page);
    expect(await text(page)).toBe('Build the release dashboard.\n\n');
    expect(await page.evaluate(() => window.fixture.range())).toEqual({start: 0, end: 30});
    const view = await richView(page); expect(view.blocks).toHaveLength(2);
    expect(backward ? view.focus : view.anchor).toEqual({path: [0, 0, 0], offset: 0});
    expect(backward ? view.anchor : view.focus).toEqual({path: [1], offset: 0});
    await redo(page); expect(await text(page)).toBe('After');
  });
  test('R11 a mode switch preserves an outside focus and selection', async ({page}) => {
    await page.keyboard.press('Enter'); await page.evaluate(() => window.fixture.modeTo('source')); await choose(page, 0);
    await page.evaluate(() => { const outside = document.getElementById('outside')!; outside.focus(); window.getSelection()!.selectAllChildren(outside); window.fixture.modeTo('wysiwyg'); });
    expect(await page.evaluate(() => ({active: document.activeElement!.id, selected: window.getSelection()!.toString()}))).toEqual({active: 'outside', selected: 'Outside editor'});
    expect((await richView(page)).blocks).toHaveLength(2);
  });
  test('R11 moved source caret maps current selection on a rich round trip', async ({page}) => {
    await page.keyboard.press('Enter');
    await page.evaluate(() => window.fixture.modeTo('source')); await choose(page, 0);
    await page.evaluate(() => window.fixture.modeTo('wysiwyg'));
    expect((await richView(page)).anchor).toEqual({path: [0, 0, 0], offset: 0});
    expect((await richView(page)).blocks).toHaveLength(2);
  });
});
