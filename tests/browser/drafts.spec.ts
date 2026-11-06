import { expect, test } from '@playwright/test';

test('independent app persists an approved draft and isolates users', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:3102');
  await page.getByLabel('Password').fill('browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Signed in as Alice');
  await page
    .getByLabel('Title', { exact: true })
    .fill('Approved browser draft');
  await page.getByRole('button', { name: 'Request draft' }).click();
  await expect(page.locator('#drafts li')).toHaveCount(0);
  await page
    .getByRole('button', {
      name: 'Approve creation of “Approved browser draft” in marketing',
    })
    .click();
  await expect(page.locator('#drafts li')).toHaveCount(1);
  await expect(page.locator('#events')).toContainText('completed');
  await expect(page.locator('#events')).toContainText('operation_id');
  await expect(page.locator('#traces')).not.toContainText(
    'Approved browser draft',
  );
  await page.reload();
  await expect(page.locator('#drafts li')).toHaveCount(1);
  await page.screenshot({
    path: 'test-results/drafts-integration.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByLabel('Username').fill('bob');
  await page.getByLabel('Password').fill('browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Signed in as Bob');
  await expect(page.locator('#drafts li')).toHaveCount(0);
  await expect(page.getByLabel('Project')).toHaveValue('engineering');
  await expect(page.locator('#events')).not.toContainText(
    'Approved browser draft',
  );
});
