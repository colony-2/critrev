import {expect, test, type Page} from '@playwright/test';

const editor = (page: Page) => page.getByRole('textbox', {name: 'Review editor', exact: true});
const markup = (page: Page) => page.getByTestId('react-markup');

async function selectText(page: Page, text: string) {
  await editor(page).evaluate((root, wanted) => {
    root.focus();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const start = node.textContent?.indexOf(wanted) ?? -1;
      if (start === -1) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + wanted.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error(`Text not found: ${wanted}`);
  }, text);
}

test.beforeEach(async ({page}) => { await page.goto('/react.html'); });

test('custom app styling, both mode axes, and accept/reject actions', async ({page}) => {
  const original = await markup(page).textContent();
  await expect(editor(page).locator('.app-addition')).toContainText('polished');
  await expect(editor(page).locator('.review-addition')).toHaveCount(0);
  await expect(editor(page).locator('.app-bold')).toHaveText('team');
  await page.getByRole('combobox', {name: 'Content', exact: true}).selectOption('source');
  await expect(editor(page)).toContainText('**team**');
  await page.getByRole('combobox', {name: 'View', exact: true}).selectOption('accept');
  await expect(editor(page)).toHaveAttribute('contenteditable', 'false');
  await expect(editor(page).locator('[data-suggestion-id]')).toHaveCount(0);
  await expect(markup(page)).toHaveText(original!);
  await page.getByRole('combobox', {name: 'View', exact: true}).selectOption('reject');
  await expect(editor(page)).not.toContainText('polished');
  await page.getByRole('combobox', {name: 'View', exact: true}).selectOption('revisions');
  await expect(editor(page)).toHaveAttribute('contenteditable', 'true');
  await page.getByRole('button', {name: 'Accept', exact: true}).click();
  await expect(markup(page)).toHaveText('Hello **team**.\n\nShip the polished draft.');
  await page.getByRole('button', {name: 'Reset diff'}).click();
  await page.getByRole('button', {name: 'Reject', exact: true}).click();
  await expect(markup(page)).toHaveText('Hello **team**.\n\nShip the draft.');
});

test('controlled edits create suggestions and preserve the caret over successive keystrokes', async ({page}) => {
  await editor(page).click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('Hi ');
  await expect(markup(page)).toContainText('{++Hi ++}Hello');
  await page.getByLabel('Read only', {exact: true}).check();
  await expect(editor(page)).toHaveAttribute('aria-readonly', 'true');
  await page.getByLabel('Read only', {exact: true}).uncheck();
  await page.getByLabel('Track changes').uncheck();
  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('!');
  await expect(markup(page)).toContainText('draft.!');
});

test('source mode preserves literal Markdown instead of firing rich-text shortcuts', async ({page}) => {
  await page.getByRole('combobox', {name: 'Content', exact: true}).selectOption('source');
  await page.getByLabel('Track changes').uncheck();
  await editor(page).click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('# ');
  await expect(markup(page)).toContainText('# Hello **team**.');
  await expect(editor(page).locator('h1')).toHaveCount(0);
});

test('WYSIWYG comments target formatted text in later paragraphs with source offsets', async ({page}) => {
  await page.getByText('Integration checks', {exact: true}).click();
  await page.getByRole('button', {name: 'Load document'}).click();
  await selectText(page, 'bold');
  await page.getByRole('button', {name: 'Comment on selection'}).click();
  await page.getByLabel('Comment', {exact: true}).fill('Check this');
  await page.getByRole('button', {name: 'Save comment'}).click();
  await expect(markup(page)).toHaveText('First paragraph.\n\nSecond **{==bold==}{>>Check this<<}** word.');
  await expect(page.locator('[data-comment-card] q')).toHaveText('bold');
  await page.getByRole('combobox', {name: 'Content', exact: true}).selectOption('source');
  await expect(editor(page).locator('[data-comment-id]')).toHaveText('bold');
  await page.getByRole('button', {name: 'Delete comment'}).click();
  await expect(markup(page)).toHaveText('First paragraph.\n\nSecond **bold** word.');
});

test('context menu requests a comment without imposing a popover', async ({page}) => {
  await selectText(page, 'Hello');
  await editor(page).dispatchEvent('contextmenu');
  await page.getByLabel('Comment', {exact: true}).fill('Greeting');
  await page.getByRole('button', {name: 'Save comment'}).click();
  await expect(markup(page)).toContainText('{==Hello==}{>>Greeting<<}');
});

test('StrictMode remounts, external resets, batched actions, and editor instances are isolated', async ({page}) => {
  await page.getByText('Integration checks', {exact: true}).click();
  await page.getByRole('button', {name: 'Add two comments'}).click();
  await expect(page.locator('[data-comment-card]')).toHaveCount(2);
  await page.getByRole('button', {name: 'Toggle editor mount'}).click();
  await expect(editor(page)).toHaveCount(0);
  await page.getByRole('button', {name: 'Toggle editor mount'}).click();
  await expect(editor(page).locator('[data-critrev-comment-anchor]')).toHaveCount(2);
  await page.getByRole('button', {name: 'Load document'}).click();
  await expect(editor(page)).toContainText('Second bold word.');
  await editor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('!');
  await expect(page.getByTestId('change-count')).toHaveText('1');
  await expect(page.getByRole('textbox', {name: 'Independent editor'})).toHaveText('Independent document');
});

test('a controlled owner can decline edits without leaving stale editor content', async ({page}) => {
  await page.getByText('Integration checks', {exact: true}).click();
  await page.getByLabel('Decline edits').check();
  const original = await markup(page).textContent();
  await editor(page).click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('X');
  await expect(markup(page)).toHaveText(original!);
  await expect(editor(page)).not.toContainText('X');
  await expect(page.getByTestId('change-count')).toHaveText('1');
});
