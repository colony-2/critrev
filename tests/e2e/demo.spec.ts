import {expect, test} from '@playwright/test';

test('shows each CriticMarkup pipeline stage', async ({page}) => {
  await page.goto('/');

  await expect(page).toHaveTitle('review2 CriticMarkup demo');
  await expect(page.getByRole('heading', {name: 'CriticMarkup Pipeline'})).toBeVisible();

  await expect(page.getByTestId('critic-input')).toHaveValue(
    [
      'this {~~is **a great idea** for us.~>**great** for us~~}',
      '',
      'Please ship the {~~first draft.~>polished draft.~~}',
    ].join('\n'),
  );

  await expect(page.getByTestId('rendered-review')).toContainText('is a great idea for us.');
  await expect(page.getByTestId('rendered-review')).toContainText('great for us');
  await expect(page.locator('.rendered-review .arrow')).toHaveCount(0);
  await expect(page.locator('.rendered-review .substitution')).toHaveCount(0);
  await expect(page.getByText('2substitution')).toBeVisible();
  await expect(page.locator('.change-description').first()).toContainText(
    'is a great idea for us. changed to great for us',
  );
  await expect(page.getByTestId('final-output')).toHaveValue(
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
  await page.getByRole('button', {name: 'Preview reject all'}).click();
  await expect(renderedReview).toHaveText(
    'this is a great idea for us.\n\nPlease ship the first draft.',
  );

  await page.getByRole('button', {name: 'Preview accept all'}).click();
  await expect(renderedReview).toHaveText('this great for us\n\nPlease ship the polished draft.');

  await page.getByRole('button', {name: 'Show revisions'}).click();
  await expect(renderedReview.locator('ins')).toHaveCount(2);
  await expect(renderedReview.locator('del')).toHaveCount(2);
});

test('rejects one formatted-boundary substitution as a single change', async ({page}) => {
  await page.goto('/');

  await page.getByTestId('reject-change').first().click();

  await expect(page.getByTestId('critic-input')).toHaveValue(
    'this is **a great idea** for us.\n\nPlease ship the {~~first draft.~>polished draft.~~}',
  );
  await expect(page.getByTestId('final-output')).toHaveValue(
    'this is **a great idea** for us.\n\nPlease ship the polished draft.',
  );
});

test('shows inline accept/reject controls from the rendered suggestion', async ({page}) => {
  await page.goto('/');

  await page.locator('.rendered-review [data-change-index="0"]').first().click();
  await expect(page.getByTestId('inline-review-actions')).toBeVisible();

  await page.getByRole('button', {name: 'Reject suggestion'}).click();
  await expect(page.getByTestId('critic-input')).toHaveValue(
    'this is **a great idea** for us.\n\nPlease ship the {~~first draft.~>polished draft.~~}',
  );
});

test('phone viewport exposes the same review controls', async ({page}) => {
  await page.goto('/');

  await expect(page.getByTestId('critic-input')).toBeVisible();
  await expect(page.getByTestId('reject-change').first()).toBeVisible();

  await page.getByTestId('accept-change').first().click();
  await expect(page.getByTestId('final-output')).toHaveValue(
    'this **great** for us\n\nPlease ship the polished draft.',
  );
});
