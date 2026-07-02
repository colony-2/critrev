import {expect, test} from '@playwright/test';

const sampleRangeComment = 'Range comment: tighten the action wording';
const samplePointComment = 'Point comment: confirm the delivery owner';
const sampleEditorMarkup = [
  'this {~~is **a great idea** for us.~>**great** for us~~}',
  '',
  `{==Please ship==}{>>${sampleRangeComment}<<} the {~~first draft.~>polished draft.~~}{>>${samplePointComment}<<}`,
].join('\n');

test('shows each CriticMarkup pipeline stage', async ({page}) => {
  await page.goto('/');

  await expect(page).toHaveTitle('review2 CriticMarkup demo');
  await expect(page.getByRole('heading', {name: 'CriticMarkup Pipeline'})).toBeVisible();

  await expect(page.getByRole('heading', {name: 'Raw Editor Input'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Review Editor'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Changes'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Raw Editor Output'})).toBeVisible();
  await expect(page.getByTestId('critic-input')).toHaveValue(sampleEditorMarkup);
  await expect(page.getByTestId('critic-output')).toHaveValue(sampleEditorMarkup);

  await expect(page.getByTestId('rendered-review')).toHaveAttribute('data-editor-engine', 'lexical');
  await expect(page.getByTestId('rendered-review')).toHaveAttribute('data-lexical-editor', 'true');
  await expect(page.getByTestId('rendered-review')).toContainText('is **a great idea** for us.');
  await expect(page.getByTestId('rendered-review')).toContainText('**great** for us');
  await expect(page.getByTestId('rendered-review')).not.toContainText(sampleRangeComment);
  await expect(page.getByTestId('rendered-review')).not.toContainText(samplePointComment);
  await expect(page.getByTestId('comment-anchor')).toHaveCount(1);
  await expect(page.getByTestId('range-comment')).toHaveCount(1);
  await expect(page.locator('.rendered-review .arrow')).toHaveCount(0);
  await expect(page.locator('.rendered-review .substitution')).toHaveCount(0);
  await expect(page.getByTestId('info-popover')).toBeHidden();
  await page.getByTestId('info-toggle').click();
  await expect(page.getByText('2substitution')).toBeVisible();
  await expect(page.getByText('0highlight')).toBeVisible();
  await expect(page.getByText('2comment')).toBeVisible();
  await expect(page.locator('.change-description').first()).toContainText(
    'is a great idea for us. changed to great for us',
  );
  await expect(page.getByTestId('final-output')).toHaveValue(
    `this **great** for us\n\n{==Please ship==}{>>${sampleRangeComment}<<} the polished draft.{>>${samplePointComment}<<}`,
  );
  await expect(page.getByTestId('clean-output')).toHaveValue(
    'this **great** for us\n\nPlease ship the polished draft.',
  );
});

test('renders revisions with Google Docs-style inline marks only', async ({page}) => {
  await page.goto('/');

  const additionStyle = await page.locator('.rendered-review ins').first().evaluate(element => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      textDecorationLine: style.textDecorationLine,
    };
  });
  const deletionStyle = await page.locator('.rendered-review del').first().evaluate(element => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      textDecorationColor: style.textDecorationColor,
      textDecorationLine: style.textDecorationLine,
    };
  });

  expect(additionStyle).toEqual({
    backgroundColor: 'rgba(0, 0, 0, 0)',
    color: 'rgb(24, 128, 56)',
    textDecorationLine: 'none',
  });
  expect(deletionStyle).toEqual({
    backgroundColor: 'rgba(0, 0, 0, 0)',
    color: 'rgb(32, 33, 36)',
    textDecorationColor: 'rgb(24, 128, 56)',
    textDecorationLine: 'line-through',
  });
});

test('toggles between revisions, reject-all preview, and accept-all preview', async ({page}) => {
  await page.goto('/');

  const renderedReview = page.getByTestId('rendered-review');
  await page.getByTestId('view-mode-toggle').click();
  await page.getByRole('button', {name: 'Preview reject all'}).click();
  await expect(renderedReview).toContainText('this is **a great idea** for us.');
  await expect(renderedReview).toContainText('the first draft.');
  await expect(renderedReview).toHaveAttribute('contenteditable', 'false');

  await page.getByTestId('view-mode-toggle').click();
  await page.getByRole('button', {name: 'Preview accept all'}).click();
  await expect(renderedReview).toContainText('this **great** for us');
  await expect(renderedReview).toContainText('the polished draft.');
  await expect(renderedReview).toHaveAttribute('contenteditable', 'false');

  await page.getByTestId('view-mode-toggle').click();
  await page.getByRole('button', {name: 'Show revisions'}).click();
  await expect(renderedReview).toHaveAttribute('contenteditable', 'true');
  await expect(renderedReview.locator('ins')).toHaveCount(2);
  await expect(renderedReview.locator('del')).toHaveCount(2);
});

test('rendered review edits become suggestions instead of hard changes', async ({page}) => {
  await page.goto('/');

  await page.getByTestId('critic-input').fill('Plain text');
  await page.getByRole('button', {name: 'Load'}).click();

  const renderedReview = page.getByTestId('rendered-review');
  await expect(renderedReview).toHaveAttribute('contenteditable', 'true');
  await setRenderedCaret(page, 'Plain text'.length);
  await page.keyboard.type(' now');

  await expect(page.locator('#status-pill')).toHaveText(/Suggestion/);
  await expect(page.getByTestId('critic-input')).toHaveValue('Plain text');
  await expect(page.getByTestId('critic-output')).toHaveValue('Plain text{++ now++}');
  await expect(page.locator('.change-description')).toContainText('now added');
  await expect(page.getByTestId('final-output')).toHaveValue('Plain text now');
});

test('typing in unchanged text keeps the caret at the insertion point', async ({page}) => {
  await page.goto('/');

  await page.getByRole('button', {name: 'Load'}).click();
  await setRenderedCaret(page, 2);
  await page.keyboard.type('XYZ');

  await expect(page.getByTestId('critic-output')).toHaveValue(
    sampleEditorMarkup.replace('this ', 'th{++XYZ++}is '),
  );
  await expect(page.getByTestId('rendered-review')).not.toContainText('{++');
  await expect(page.getByTestId('rendered-review').locator('ins').filter({hasText: 'XYZ'})).toHaveCount(1);
  expect(await renderedCaretOffset(page)).toBe(5);
});

test('backspacing unchanged text creates a deletion without moving the caret to the start', async ({page}) => {
  await page.goto('/');

  await page.getByTestId('critic-input').fill('Plain text');
  await page.getByRole('button', {name: 'Load'}).click();

  await setRenderedCaret(page, 5);
  await page.keyboard.press('Backspace');

  await expect(page.getByTestId('critic-output')).toHaveValue('Plai{--n--} text');
  await expect(page.getByTestId('rendered-review')).not.toContainText('{--');
  await expect(page.getByTestId('rendered-review').locator('del')).toContainText('n');
  expect(await renderedCaretOffset(page)).toBe(4);
});

test('typing inside an existing addition extends that suggestion', async ({page}) => {
  await page.goto('/');

  await page.getByTestId('critic-input').fill('Plain {++ad++}');
  await page.getByRole('button', {name: 'Load'}).click();

  await setRenderedCaret(page, 7);
  await page.keyboard.type('bc');

  await expect(page.getByTestId('critic-output')).toHaveValue('Plain {++abcd++}');
  await expect(page.getByTestId('rendered-review').locator('ins')).toHaveText('abcd');
  expect(await renderedCaretOffset(page)).toBe(9);
});

test('editing inside an existing addition keeps it editable as one suggestion', async ({page}) => {
  await page.goto('/');

  await page.getByTestId('critic-input').fill('Plain {++abcd++}');
  await page.getByRole('button', {name: 'Load'}).click();

  await setRenderedCaret(page, 8);
  await page.keyboard.press('Backspace');

  await expect(page.getByTestId('critic-output')).toHaveValue('Plain {++acd++}');
  await expect(page.getByTestId('rendered-review')).not.toContainText('{++');
  await expect(page.getByTestId('rendered-review').locator('ins')).toContainText('acd');
  await expect(page.locator('.change-description')).toContainText('acd added');
});

test('editing inside an existing deletion keeps it editable as one suggestion', async ({page}) => {
  await page.goto('/');

  await page.getByTestId('critic-input').fill('Plain {--abcd--}');
  await page.getByRole('button', {name: 'Load'}).click();

  await setRenderedCaret(page, 8);
  await page.keyboard.press('Backspace');

  await expect(page.getByTestId('critic-output')).toHaveValue('Plain {--acd--}');
  await expect(page.getByTestId('rendered-review')).not.toContainText('{--');
  await expect(page.getByTestId('rendered-review').locator('del')).toContainText('acd');
  await expect(page.locator('.change-description')).toContainText('acd deleted');
});

test('rendered edits preserve unresolved suggestion markers', async ({page}) => {
  await page.goto('/');

  await setRenderedCaret(page, 5);
  await page.keyboard.type('Extra note. ');

  await expect(page.getByTestId('critic-input')).toHaveValue(sampleEditorMarkup);
  await expect(page.getByTestId('critic-output')).toHaveValue(
    sampleEditorMarkup.replace('this ', 'this {++Extra note. ++}'),
  );
  await expect(page.getByTestId('final-output')).toHaveValue(
    `this Extra note. **great** for us\n\n{==Please ship==}{>>${sampleRangeComment}<<} the polished draft.{>>${samplePointComment}<<}`,
  );
});

test('rejects one formatted-boundary substitution as a single change', async ({page}) => {
  await page.goto('/');

  await page.getByTestId('reject-change').first().click();

  await expect(page.getByTestId('critic-input')).toHaveValue(sampleEditorMarkup);
  await expect(page.getByTestId('critic-output')).toHaveValue(
    `this is **a great idea** for us.\n\n{==Please ship==}{>>${sampleRangeComment}<<} the {~~first draft.~>polished draft.~~}{>>${samplePointComment}<<}`,
  );
  await expect(page.getByTestId('final-output')).toHaveValue(
    `this is **a great idea** for us.\n\n{==Please ship==}{>>${sampleRangeComment}<<} the polished draft.{>>${samplePointComment}<<}`,
  );
});

test('hovering a rendered suggestion shows inline accept/reject controls', async ({page}) => {
  await page.goto('/');

  const suggestion = page.locator('.rendered-review [data-change-index="0"]').first();
  await suggestion.click();
  await expect(page.getByTestId('inline-review-actions')).toBeHidden();

  await suggestion.hover();
  await expect(page.getByTestId('inline-review-actions')).toBeVisible();
  await expect(page.getByTestId('suggestion-card').first()).toHaveClass(/active/);

  await page.mouse.move(4, 4);
  await expect(page.getByTestId('inline-review-actions')).toBeHidden();

  await suggestion.hover();
  await expect(page.getByTestId('inline-review-actions')).toBeVisible();
  await page.getByRole('button', {name: 'Reject suggestion'}).click();
  await expect(page.getByTestId('critic-output')).toHaveValue(
    `this is **a great idea** for us.\n\n{==Please ship==}{>>${sampleRangeComment}<<} the {~~first draft.~>polished draft.~~}{>>${samplePointComment}<<}`,
  );
});

test('hovering range comments and point comment icons opens comment overlays', async ({page}) => {
  await page.goto('/');

  await page.getByTestId('range-comment').click();
  await expect(page.getByTestId('comment-display')).toBeHidden();

  await page.getByTestId('range-comment').hover();
  await expect(page.getByTestId('comment-display')).toBeVisible();
  await expect(page.getByTestId('comment-display')).toHaveText(sampleRangeComment);

  await page.getByTestId('comment-anchor').first().hover();
  await expect(page.getByTestId('comment-display')).toBeVisible();
  await expect(page.getByTestId('comment-display')).toHaveText(samplePointComment);

  await page.mouse.move(4, 4);
  await expect(page.getByTestId('comment-display')).toBeHidden();
});

test('adds a range comment from selected text with the context menu', async ({page}) => {
  await page.goto('/');

  await page.getByTestId('critic-input').fill('Plain text for comments');
  await page.getByRole('button', {name: 'Load'}).click();

  await selectRenderedText(page, 0, 5);
  await page.getByTestId('rendered-review').dispatchEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 80,
    clientY: 120,
  });
  await expect(page.getByTestId('comment-popover')).toBeVisible();
  await page.getByTestId('comment-input').fill('Needs detail');
  await page.getByRole('button', {name: 'Add comment'}).click();

  await expect(page.getByTestId('critic-output')).toHaveValue(
    '{==Plain==}{>>Needs detail<<} text for comments',
  );
  await expect(page.getByTestId('comment-anchor')).toHaveCount(0);
  await expect(page.getByTestId('range-comment')).toHaveCount(1);
  await expect(page.getByTestId('final-output')).toHaveValue(
    '{==Plain==}{>>Needs detail<<} text for comments',
  );
  await expect(page.getByTestId('clean-output')).toHaveValue('Plain text for comments');
});

test('long touch opens the comment popover for selected text', async ({page}) => {
  await page.goto('/');

  await page.getByTestId('critic-input').fill('Plain text for comments');
  await page.getByRole('button', {name: 'Load'}).click();

  await selectRenderedText(page, 6, 10);
  await page.getByTestId('rendered-review').dispatchEvent('pointerdown', {
    bubbles: true,
    clientX: 80,
    clientY: 120,
    pointerType: 'touch',
  });

  await expect(page.getByTestId('comment-popover')).toBeVisible();
});

test('phone viewport exposes the same review controls', async ({page}) => {
  await page.goto('/');

  await expect(page.getByTestId('critic-input')).toBeVisible();
  await expect(page.getByTestId('reject-change').first()).toBeVisible();

  const editorBox = await page.getByTestId('rendered-review').boundingBox();
  const suggestionsBox = await page.locator('.suggestion-pane').boundingBox();
  expect(editorBox).not.toBeNull();
  expect(suggestionsBox).not.toBeNull();
  expect(suggestionsBox!.y).toBeGreaterThan(editorBox!.y + editorBox!.height - 1);

  await page.getByTestId('accept-change').first().click();
  await expect(page.getByTestId('final-output')).toHaveValue(
    `this **great** for us\n\n{==Please ship==}{>>${sampleRangeComment}<<} the polished draft.{>>${samplePointComment}<<}`,
  );
});

async function selectRenderedText(page: import('@playwright/test').Page, start: number, end: number) {
  await page.getByTestId('rendered-review').evaluate(
    (element, range) => {
      const textPosition = (targetOffset: number): {node: Node; offset: number} => {
        let remaining = Math.max(0, targetOffset);
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();

        while (node !== null) {
          const length = node.nodeValue?.length ?? 0;
          if (remaining <= length) {
            return {node, offset: remaining};
          }
          remaining -= length;
          node = walker.nextNode();
        }

        return {node: element, offset: element.childNodes.length};
      };

      const selection = window.getSelection();
      const domRange = document.createRange();
      const startPosition = textPosition(range.start);
      const endPosition = textPosition(range.end);
      domRange.setStart(startPosition.node, startPosition.offset);
      domRange.setEnd(endPosition.node, endPosition.offset);
      selection?.removeAllRanges();
      selection?.addRange(domRange);
    },
    {end, start},
  );
}

async function setRenderedCaret(page: import('@playwright/test').Page, offset: number) {
  await page.getByTestId('rendered-review').evaluate((element, targetOffset) => {
    const root = element as HTMLElement;
    const visibleTextPosition = (root: HTMLElement): {node: Node; offset: number} => {
      let remaining = Math.max(0, targetOffset);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();

      while (node !== null) {
        const length = node.nodeValue?.length ?? 0;
        if (remaining <= length) {
          return {node, offset: remaining};
        }
        remaining -= length;
        node = walker.nextNode();
      }

      return {node: root, offset: root.childNodes.length};
    };

    const position = visibleTextPosition(root);
    const selection = window.getSelection();
    const range = document.createRange();
    root.focus();
    range.setStart(position.node, position.offset);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, offset);
}

async function renderedCaretOffset(page: import('@playwright/test').Page): Promise<number> {
  return page.getByTestId('rendered-review').evaluate(element => {
    const selection = window.getSelection();
    if (selection === null || selection.rangeCount === 0 || !selection.isCollapsed) {
      return -1;
    }
    const range = selection.getRangeAt(0);
    if (!element.contains(range.endContainer)) {
      return -1;
    }

    const prefixRange = document.createRange();
    prefixRange.selectNodeContents(element);
    prefixRange.setEnd(range.endContainer, range.endOffset);
    return prefixRange.toString().length;
  });
}
