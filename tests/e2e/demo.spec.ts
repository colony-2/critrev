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

  await expect(page.getByTestId('rendered-review')).toContainText('is a great idea for us.');
  await expect(page.getByTestId('rendered-review')).toContainText('great for us');
  await expect(page.getByTestId('rendered-review')).not.toContainText(sampleRangeComment);
  await expect(page.getByTestId('rendered-review')).not.toContainText(samplePointComment);
  await expect(page.getByTestId('comment-anchor')).toHaveCount(2);
  await expect(page.locator('.rendered-review .arrow')).toHaveCount(0);
  await expect(page.locator('.rendered-review .substitution')).toHaveCount(0);
  await expect(page.getByTestId('info-popover')).toBeHidden();
  await page.getByTestId('info-toggle').click();
  await expect(page.getByText('2substitution')).toBeVisible();
  await expect(page.getByText('1highlight')).toBeVisible();
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
  await expect(renderedReview).toContainText('this is a great idea for us.');
  await expect(renderedReview).toContainText('the first draft.');
  await expect(renderedReview).toHaveAttribute('contenteditable', 'false');

  await page.getByTestId('view-mode-toggle').click();
  await page.getByRole('button', {name: 'Preview accept all'}).click();
  await expect(renderedReview).toContainText('this great for us');
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
  await renderedReview.evaluate(element => {
    element.insertAdjacentText('beforeend', ' now');
    element.dispatchEvent(new InputEvent('input', {bubbles: true, data: ' now'}));
  });

  await expect(page.locator('#status-pill')).toHaveText('Suggestion added');
  await expect(page.getByTestId('critic-input')).toHaveValue('Plain text');
  await expect(page.getByTestId('critic-output')).toHaveValue('Plain text{++ now++}');
  await expect(page.locator('.change-description')).toContainText('now added');
  await expect(page.getByTestId('final-output')).toHaveValue('Plain text now');
});

test('rendered edits preserve unresolved suggestion markers', async ({page}) => {
  await page.goto('/');

  await page.getByTestId('rendered-review').evaluate(element => {
    element.insertAdjacentText('beforeend', ' Extra note.');
    element.dispatchEvent(new InputEvent('input', {bubbles: true, data: ' Extra note.'}));
  });

  await expect(page.getByTestId('critic-input')).toHaveValue(sampleEditorMarkup);
  await expect(page.getByTestId('critic-output')).toHaveValue(
    `${sampleEditorMarkup}{++ Extra note.++}`,
  );
  await expect(page.getByTestId('final-output')).toHaveValue(
    `this **great** for us\n\n{==Please ship==}{>>${sampleRangeComment}<<} the polished draft.{>>${samplePointComment}<<} Extra note.`,
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

test('shows inline accept/reject controls from the rendered suggestion', async ({page}) => {
  await page.goto('/');

  await page.locator('.rendered-review [data-change-index="0"]').first().click();
  await expect(page.getByTestId('inline-review-actions')).toBeVisible();
  await expect(page.getByTestId('suggestion-card').first()).toHaveClass(/active/);

  await page.getByRole('button', {name: 'Reject suggestion'}).click();
  await expect(page.getByTestId('critic-output')).toHaveValue(
    `this is **a great idea** for us.\n\n{==Please ship==}{>>${sampleRangeComment}<<} the {~~first draft.~>polished draft.~~}{>>${samplePointComment}<<}`,
  );
});

test('clicking inline comment icons opens comment overlays', async ({page}) => {
  await page.goto('/');

  await page.getByTestId('comment-anchor').first().click();
  await expect(page.getByTestId('comment-display')).toBeVisible();
  await expect(page.getByTestId('comment-display')).toHaveText(sampleRangeComment);
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
      const textNode = Array.from(element.childNodes).find(
        node => node.nodeType === Node.TEXT_NODE && (node.nodeValue ?? '').length >= range.end,
      );
      if (textNode === undefined) {
        throw new Error('Could not find selectable rendered text');
      }

      const selection = window.getSelection();
      const domRange = document.createRange();
      domRange.setStart(textNode, range.start);
      domRange.setEnd(textNode, range.end);
      selection?.removeAllRanges();
      selection?.addRange(domRange);
    },
    {end, start},
  );
}
