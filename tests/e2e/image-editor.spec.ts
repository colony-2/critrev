import {expect, test} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {choose, imageEditor, logs, openImages, redo, text, undo} from './image-helpers.js';

const formattedContexts = [
  {name: 'bold', markdown: '**bold text**', wrap: (value: string) => `**${value}**`, left: 'bold', right: ' text'},
  {name: 'italic', markdown: '*bold text*', wrap: (value: string) => `*${value}*`, left: 'bold', right: ' text'},
  {name: 'strikethrough', markdown: '~~bold text~~', wrap: (value: string) => `~~${value}~~`, left: 'bold', right: ' text'},
  {name: 'inline code', markdown: '`code text`', wrap: (value: string) => `\`${value}\``, left: 'code', right: ' text'},
  {name: 'fenced code', markdown: '```ts\ncode text\n```', wrap: (value: string) => `\`\`\`ts\n${value}\n\`\`\``, left: 'code', right: ' text'},
  {name: 'link', markdown: '[link text](https://example.org)', wrap: (value: string) => `[${value}](https://example.org)`, left: 'link', right: ' text'},
];
for (const surface of ['react', 'imperative']) for (const method of ['direct', 'paste']) {
  test.describe(`${surface} ${method} formatted image insertion`, () => {
    for (const context of formattedContexts) for (const replace of [false, true]) {
      test(`${context.name}: ${replace ? 'backward replacement' : 'following caret'}, export and cross-mode replay`, async ({page}, info) => {
        await openImages(page, surface);
        await page.evaluate(markdown => window.fixture.load(markdown), context.markdown);
        await choose(page, replace ? 2 : 4, replace ? 7 : 4, replace);
        await page.evaluate(() => window.fixture.resetLogs());
        if (method === 'direct') expect(await page.evaluate(() => window.fixture.insert(window.fixture.images))).toBe(true);
        else expect(await page.evaluate(() => window.fixture.paste())).toBe(true);
        const batch = '![Flow diagram](pasted-a.png "Draft flow")![](pasted-b.png "")';
        const left = replace ? context.left.slice(0, 2) : context.left;
        const right = replace ? 'xt' : context.right;
        // Markdown emphasis cannot open on whitespace. Keep that whitespace
        // outside the markers while preserving all remaining formatted text.
        const wrap = (value: string) => ['bold', 'italic', 'strikethrough'].includes(context.name)
          ? value.match(/^\s*/u)![0] + context.wrap(value.trim()) : context.wrap(value);
        const prefix = wrap(left) + (context.name === 'fenced code' ? '\n\n' : '');
        const suffix = (context.name === 'fenced code' ? '\n\n' : '') + wrap(right);
        const inserted = prefix + batch + suffix;
        expect(await text(page)).toBe(inserted);
        expect(await page.evaluate(() => window.fixture.inspect(window.fixture.value.text).exact)).toBe(true);
        await expect(imageEditor(page).locator('[data-critrev-image]')).toHaveCount(2);
        await expect(imageEditor(page).locator('a [data-critrev-image], code [data-critrev-image]')).toHaveCount(0);
        expect(await page.evaluate(() => window.fixture.range())).toEqual({start: prefix.length + batch.length, end: prefix.length + batch.length});
        const events = await logs(page);
        expect(events.filter(x => x.change)).toHaveLength(1);
        expect(events.filter(x => x.error)).toHaveLength(0);
        expect(events.filter(x => x.outcome)).toHaveLength(method === 'paste' ? 1 : 0);
        if (method === 'paste') expect(events.find(x => x.outcome)?.outcome.inserted).toBe(true);
        if (process.env.REVIEW_CAPTURE_DIR && surface === 'react' && method === 'direct' && !replace && ['link', 'fenced code'].includes(context.name)) {
          await mkdir(process.env.REVIEW_CAPTURE_DIR, {recursive: true});
          await page.screenshot({path: join(process.env.REVIEW_CAPTURE_DIR, `${context.name === 'link' ? 'link' : 'code'}-insertion-${info.project.name}.png`), fullPage: true});
        }
        await page.keyboard.insertText('X');
        expect(await imageEditor(page).locator('[data-critrev-image]').last().evaluate(atom => atom.nextSibling?.textContent?.startsWith('X'))).toBe(true);
        await undo(page); await expect.poll(() => text(page)).toBe(inserted);
        await undo(page); await expect.poll(() => text(page)).toBe(context.markdown);
        if (replace) expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(context.left.slice(2) + ' te');
        await redo(page); await expect.poll(() => text(page)).toBe(inserted);
        await expect(imageEditor(page).locator('[data-critrev-image]')).toHaveCount(2);
        expect(await page.evaluate(() => window.fixture.range())).toEqual({start: prefix.length + batch.length, end: prefix.length + batch.length});
        await page.evaluate(() => { window.fixture.echo(); window.fixture.modeTo('source'); });
        await undo(page); await expect.poll(() => text(page)).toBe(context.markdown);
        await redo(page); await expect.poll(() => text(page)).toBe(inserted);
        await page.evaluate(() => window.fixture.modeTo('wysiwyg'));
        await expect(imageEditor(page).locator('[data-critrev-image]')).toHaveCount(2);
      });
    }
  });
}

for (const surface of ['react', 'imperative']) for (const method of ['direct', 'paste']) {
  for (const replace of [false, true]) test(`${surface} ${method}: a native ${replace ? 'backward range' : 'caret'} supersedes a previously selected image immediately`, async ({page}) => {
    await openImages(page, surface);
    const initial = 'Before target ![existing](existing.png) after';
    await page.evaluate(markdown => window.fixture.load(markdown), initial);
    await imageEditor(page).locator('[data-critrev-image]').click();
    await expect(imageEditor(page).locator('[data-critrev-image]')).toHaveAttribute('data-critrev-image-selected', 'true');
    expect(await page.evaluate(({method, replace}) => {
      window.fixture.select(7, replace ? 13 : 7, replace); window.fixture.resetLogs();
      return method === 'direct' ? window.fixture.insert(window.fixture.images) : window.fixture.paste();
    }, {method, replace})).toBe(true);
    const batch = '![Flow diagram](pasted-a.png "Draft flow")![](pasted-b.png "")';
    const committed = 'Before ' + batch + (replace ? '' : 'target') + ' ![existing](existing.png) after';
    expect(await text(page)).toBe(committed);
    await expect(imageEditor(page).locator('[data-critrev-image]')).toHaveCount(3);
    expect(await page.evaluate(() => window.fixture.range())).toEqual({start: 7 + batch.length, end: 7 + batch.length});
    expect((await logs(page)).filter(event => event.change)).toHaveLength(1);
    if (method === 'paste') expect((await logs(page)).find(event => event.outcome)?.outcome.inserted).toBe(true);
    await undo(page); await expect.poll(() => text(page)).toBe(initial);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(replace ? 'target' : '');
    expect(await page.evaluate(() => window.fixture.range())).toEqual({start: 7, end: replace ? 13 : 7});
    await redo(page); await expect.poll(() => text(page)).toBe(committed);
    await expect(imageEditor(page).locator('[data-critrev-image]')).toHaveCount(3);
  });
}

for (const surface of ['react', 'imperative']) for (const mode of ['source', 'wysiwyg']) {
  test.describe(`${surface} ${mode} atomic insertions`, () => {
    test.beforeEach(async ({page}) => openImages(page, surface, mode));
    for (const method of ['direct', 'paste']) {
      test(`current DOM selection: immediate ${method} replacement and rollback preserve the backward range`, async ({page}) => {
        // Deliberately do not yield between changing the native range and
        // inserting. Lexical's queued selectionchange can still hold a caret.
        const inserted = await page.evaluate(method => {
          window.fixture.select(7, 13, true);
          return method === 'direct' ? window.fixture.insert(window.fixture.images) : window.fixture.paste();
        }, method);
        expect(inserted).toBe(true);
        const committed = 'Before ![Flow diagram](pasted-a.png "Draft flow")![](pasted-b.png "") after';
        expect(await text(page)).toBe(committed);
        await undo(page); await expect.poll(() => text(page)).toBe('Before target after');
        expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('target');
        const failed = await page.evaluate(method => {
          window.fixture.select(7, 13, true); window.fixture.resetLogs(); window.fixture.failNextRender();
          const returned = method === 'direct' ? window.fixture.insert(window.fixture.images) : window.fixture.paste();
          const selection = window.getSelection()!;
          return {returned, text: selection.toString(), backward: selection.anchorOffset > selection.focusOffset, range: window.fixture.range(), logs: window.fixture.logs};
        }, method);
        expect(failed.returned).toBe(method === 'paste');
        expect(failed.text).toBe('target'); expect(failed.backward).toBe(true);
        expect(failed.range).toEqual({start: 7, end: 13});
        expect(failed.logs.filter((event: any) => event.change)).toHaveLength(0);
        expect(failed.logs.filter((event: any) => event.error)).toHaveLength(1);
        if (method === 'paste') expect(failed.logs).toEqual(expect.arrayContaining([
          expect.objectContaining({outcome: expect.objectContaining({inserted: false, reason: 'insertion-failed'})}),
        ]));
        await redo(page); await expect.poll(() => text(page)).toBe(committed);
      });
    }
    for (const position of [0, 7, 19]) test(`A01,A03,A08 ordered insertion at ${position} has one separate undo boundary`, async ({page}) => {
      await choose(page, position);
      expect(await page.evaluate(() => window.fixture.insert(window.fixture.images))).toBe(true);
      const inserted = await text(page);
      expect(inserted).toContain('![Flow diagram](pasted-a.png "Draft flow")![](pasted-b.png "")');
      expect((await logs(page)).filter(x => x.change)).toHaveLength(1);
      expect((await logs(page)).filter(x => x.paste || x.outcome)).toHaveLength(0);
      expect(await page.evaluate(() => window.fixture.range())).toEqual({start: position + '![Flow diagram](pasted-a.png "Draft flow")![](pasted-b.png "")'.length, end: position + '![Flow diagram](pasted-a.png "Draft flow")![](pasted-b.png "")'.length});
      await page.keyboard.type('X'); expect(await text(page)).toContain(')X');
      await undo(page); await expect.poll(() => text(page)).toBe(inserted);
      await undo(page); await expect.poll(() => text(page)).toBe('Before target after');
      await redo(page); await expect.poll(() => text(page)).toBe(inserted);
    });
    for (const backward of [false, true]) test(`A02,A04 selected-text replacement ${backward}`, async ({page}) => {
      await choose(page, 7, 13, backward);
      expect(await page.evaluate(() => window.fixture.insert([window.fixture.images[0]!]))).toBe(true);
      expect(await text(page)).toBe('Before ![Flow diagram](pasted-a.png "Draft flow") after');
      await undo(page); await expect.poll(() => text(page)).toBe('Before target after');
      expect(await page.evaluate(() => ({text: window.getSelection()?.toString(), backward: window.getSelection()!.anchorOffset > window.getSelection()!.focusOffset}))).toEqual({text: 'target', backward});
      await redo(page); expect(await text(page)).toContain('pasted-a.png');
    });
    test('A05,A06 invalid batches and unavailable selection do not change anything', async ({page}) => {
      await choose(page, 7, 13); const before = await page.evaluate(() => window.fixture.range());
      for (const images of [[], [{src: 'valid', alt: ''}, {src: 'data:x', alt: ''}], [{src: '', alt: ''}]]) {
        expect(await page.evaluate(value => window.fixture.insert(value), images)).toBe(false);
      }
      expect(await page.evaluate(() => window.fixture.range())).toEqual(before);
      expect(await logs(page)).toEqual([]); expect(await text(page)).toBe('Before target after');
      await page.evaluate(() => window.getSelection()!.selectAllChildren(document.getElementById('outside')!));
      expect(await page.evaluate(() => window.fixture.insert(window.fixture.images))).toBe(false);
      await choose(page, 0); await page.evaluate(() => window.fixture.flags({readOnly: true}));
      expect(await page.evaluate(() => window.fixture.insert(window.fixture.images))).toBe(false);
      await page.evaluate(() => window.fixture.dispose());
      expect(await page.evaluate(() => window.fixture.insert(window.fixture.images))).toBe(false);
    });
    test('A07 precommit failure restores content, selected text and pending redo', async ({page}) => {
      await choose(page, 0);
      expect(await page.evaluate(() => window.fixture.insert([window.fixture.images[0]!]))).toBe(true);
      await expect.poll(() => text(page)).toContain('pasted-a.png');
      await undo(page); await expect.poll(() => text(page)).toBe('Before target after');
      await choose(page, 7, 13, true);
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('target');
      await page.evaluate(() => window.fixture.resetLogs());
      const result = await page.evaluate(() => { window.fixture.failNextRender(); return window.fixture.insert(window.fixture.images); });
      expect(result).toBe(false); expect(await text(page)).toBe('Before target after');
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('target');
      expect((await logs(page)).filter(x => x.change)).toHaveLength(0);
      expect((await logs(page)).filter(x => x.error)).toHaveLength(1);
      await redo(page); await expect.poll(() => text(page)).toContain('pasted-a.png');
    });
    test('A09 descriptor mutation cannot alter committed or restored metadata', async ({page}) => {
      await choose(page, 0);
      expect(await page.evaluate(() => { const image = {src: 'owned.png', alt: 'Owned', title: ''}; const inserted = window.fixture.insert([image]); image.src = 'mutated'; image.title = 'mutated'; return inserted; })).toBe(true);
      await undo(page); await redo(page); expect(await text(page)).toContain('![Owned](owned.png "")');
    });
  });
}
for (const surface of ['react', 'imperative']) test.describe(`${surface} rich atoms`, () => {
  test.beforeEach(async ({page}) => openImages(page, surface));
  for (const key of ['Backspace', 'Delete']) test(`A10–A13 pointer selection and ${key} delete one duplicate atom`, async ({page}) => {
    await page.evaluate(() => window.fixture.load('A ![Flow diagram](pasted-a.png "Draft flow")![Flow diagram](pasted-a.png "Draft flow") Z'));
    const images = imageEditor(page).locator('[data-critrev-image]');
    await expect(images).toHaveCount(2); await images.first().click();
    await expect(images.first()).toHaveAttribute('data-critrev-image-selected', 'true');
    await expect(images.first()).toHaveClass('fixture-image'); await expect(images.first()).toHaveAttribute('aria-label', 'Flow diagram');
    await page.keyboard.press(key); await expect(images).toHaveCount(1);
    await undo(page); await expect(images).toHaveCount(2); await expect(images.first()).toHaveAttribute('data-critrev-image-selected', 'true');
    await redo(page); await expect(images).toHaveCount(1);
  });
  test('A10 arrow navigation selects atom and returns to a following caret', async ({page}) => {
    await page.evaluate(() => window.fixture.load('A ![x](a.png) Z')); await choose(page, 2);
    await page.keyboard.press('ArrowRight'); await expect(imageEditor(page).locator('[data-critrev-image]')).toHaveAttribute('data-critrev-image-selected', 'true');
    await page.keyboard.press('ArrowRight'); await page.keyboard.type('X'); expect(await text(page)).toBe('A ![x](a.png)X Z');
    await expect(imageEditor(page).locator('[data-critrev-image]')).toHaveAttribute('contenteditable', 'false');
  });
});
