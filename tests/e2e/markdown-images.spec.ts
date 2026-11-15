import {expect, test} from '@playwright/test';
import {choose, imageEditor, openImages, text} from './image-helpers.js';
for (const surface of ['react', 'imperative']) test.describe(`${surface} ordinary Markdown`, () => {
  test.beforeEach(async ({page}) => { await openImages(page, surface); await page.evaluate(() => window.fixture.load('')); });
  test('M01 literal punctuation, review delimiters and backslashes survive authoring and reload', async ({page}) => {
    const literal = '*stars* _under_ [brackets](paren) "quotes" \\path {++review++} {~~old~>new~~} #tag 😀';
    await imageEditor(page).focus(); await page.keyboard.insertText(literal);
    const markdown = await text(page); expect(markdown).not.toBe(literal);
    await page.evaluate(value => { window.fixture.modeTo('source'); window.fixture.load(value); window.fixture.modeTo('wysiwyg'); }, markdown);
    await expect(imageEditor(page)).toHaveText(literal);
  });
  for (const literal of ['a`b', '`edge`', ' edge spaces ', '  ', 'a``b`c']) test(`M02 code span ${JSON.stringify(literal)} retains exact content`, async ({page}) => {
    await imageEditor(page).focus(); await page.keyboard.insertText(literal); await choose(page, 0, literal.length);
    await page.evaluate(() => window.fixture.format('code')); const markdown = await text(page);
    await page.evaluate(value => { window.fixture.modeTo('source'); window.fixture.load(value); window.fixture.modeTo('wysiwyg'); }, markdown);
    await expect(imageEditor(page).locator('code')).toHaveText(literal);
  });
  test('M03 code containing conflicting fences survives reload', async ({page}) => {
    const literal = 'line\n```\n````\nend'; await imageEditor(page).focus(); await page.keyboard.insertText(literal);
    await choose(page, 0, literal.length); await page.evaluate(() => window.fixture.format('block')); const markdown = await text(page);
    expect(markdown.startsWith('`````')).toBe(true);
    await page.evaluate(value => { window.fixture.modeTo('source'); window.fixture.load(value); window.fixture.modeTo('wysiwyg'); }, markdown);
    await expect(imageEditor(page).locator('[spellcheck="false"]')).toContainText('````');
  });
  test('M04 escaping grows source offsets while UTF-16 ranges remain correct', async ({page}) => {
    const literal = '😀 *literal* end'; await imageEditor(page).focus(); await page.keyboard.insertText(literal);
    await choose(page, 3, 12); expect(await page.evaluate(() => window.fixture.range())).toEqual({start: 3, end: 14});
    const markdown = await text(page);
    await page.evaluate(value => window.fixture.loadModel({text: value, suggestions: [], comments: [{id: 'c', start: 3, end: 14, value: 'literal note'}], highlights: []}), markdown);
    await expect(imageEditor(page).locator('[data-comment-id="c"]')).toHaveText('*literal*');
  });
  test('M05 punctuation-heavy image fields survive insertion, switches and reload', async ({page}) => {
    await imageEditor(page).focus(); await choose(page, 0);
    expect(await page.evaluate(() => window.fixture.insert([{src: 'a(b)\\c[1]".png', alt: '[x] \\ (y) "', title: ''}, {src: 'absent.png', alt: ''}]))).toBe(true);
    const markdown = await text(page);
    await page.evaluate(value => { window.fixture.modeTo('source'); window.fixture.load(value); window.fixture.modeTo('wysiwyg'); }, markdown);
    await expect(imageEditor(page).locator('[data-critrev-image]')).toHaveCount(2);
    await expect(imageEditor(page).locator('[data-critrev-image]').first()).toHaveAttribute('data-title', '');
    await expect(imageEditor(page).locator('[data-critrev-image]').last()).not.toHaveAttribute('data-title');
    await choose(page, 0); await page.keyboard.type('X'); expect(await text(page)).toBe('X' + markdown);
  });
});
