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
  await expect(page.getByText('2substitution')).toBeVisible();
  await expect(page.getByTestId('final-output')).toHaveValue(
    'this **great** for us\n\nPlease ship the polished draft.',
  );
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

test('phone viewport exposes the same review controls', async ({page}) => {
  await page.goto('/');

  await expect(page.getByTestId('critic-input')).toBeVisible();
  await expect(page.getByTestId('reject-change').first()).toBeVisible();

  await page.getByTestId('accept-change').first().click();
  await expect(page.getByTestId('final-output')).toHaveValue(
    'this **great** for us\n\nPlease ship the polished draft.',
  );
});
