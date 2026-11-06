import { expect, test } from '@playwright/test';

test('independent app creates and updates drafts with approval, conflict checks, and user isolation', async ({
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
  await page
    .getByLabel('Find drafts', { exact: true })
    .fill('Approved browser');
  await page.getByRole('button', { name: 'Find drafts', exact: true }).click();
  await expect(page.getByLabel('Existing draft')).toContainText('version 1');
  await page.getByLabel('New title').fill('Updated browser draft');
  await page
    .getByRole('button', { name: 'Request update', exact: true })
    .click();
  await expect(page.locator('#drafts li')).toContainText(
    'Approved browser draft',
  );
  await expect(page.locator('#update-approvals')).toContainText(
    'Change “Approved browser draft” to “Updated browser draft” in marketing (version 1)',
  );
  await page
    .getByRole('button', {
      name: 'Approve update to “Updated browser draft”',
      exact: true,
    })
    .click();
  await expect(page.getByRole('status')).toHaveText(
    'Update saved and verified.',
  );
  await expect(page.locator('#drafts li')).toContainText(
    'Updated browser draft',
  );
  await page.getByLabel('Find drafts', { exact: true }).fill('browser draft');
  await page.getByRole('button', { name: 'Find drafts', exact: true }).click();
  await expect(page.getByLabel('Existing draft')).toContainText('version 2');
  await page.getByLabel('New title').fill('Rejected browser draft');
  await page
    .getByRole('button', { name: 'Request update', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'Reject update to “Rejected browser draft”',
      exact: true,
    })
    .click();
  await expect(page.getByRole('status')).toHaveText(
    'Update rejected. The draft was not changed.',
  );
  await expect(page.locator('#drafts li')).toContainText(
    'Updated browser draft',
  );
  await expect(page.getByLabel('Existing draft')).toContainText('version 2');

  await page.getByLabel('New title').fill('First browser draft edit');
  await page
    .getByRole('button', { name: 'Request update', exact: true })
    .click();
  await expect(page.locator('#update-approvals')).toContainText(
    'First browser draft edit',
  );
  await page.getByLabel('New title').fill('Stale browser draft edit');
  await page
    .getByRole('button', { name: 'Request update', exact: true })
    .click();
  await expect(page.locator('#update-approvals')).toContainText(
    'Stale browser draft edit',
  );
  await page
    .getByRole('button', {
      name: 'Approve update to “First browser draft edit”',
      exact: true,
    })
    .click();
  await expect(page.getByRole('status')).toHaveText(
    'Update saved and verified.',
  );
  await page
    .getByRole('button', {
      name: 'Approve update to “Stale browser draft edit”',
      exact: true,
    })
    .click();
  await expect(page.getByRole('status')).toContainText(
    'Update not applied: the draft has changed.',
  );
  await expect(page.locator('#drafts li')).toContainText(
    'First browser draft edit',
  );
  await expect(page.getByLabel('Existing draft')).toContainText('version 3');
  await expect(page.locator('#events')).toContainText('update_rejected');
  await expect(page.locator('#events')).toContainText('update_conflict');
  await page.reload();
  await expect(page.locator('#drafts li')).toHaveCount(1);
  await expect(page.locator('#drafts li')).toContainText(
    'First browser draft edit',
  );
  await page.getByLabel('Find drafts', { exact: true }).fill('browser draft');
  await page.getByRole('button', { name: 'Find drafts', exact: true }).click();
  await page.getByLabel('New title').fill('Retried browser draft edit');
  await page
    .getByRole('button', { name: 'Request update', exact: true })
    .click();
  await expect(page.locator('#update-approvals')).toContainText(
    'Retried browser draft edit',
  );
  await page.route('**/api/draft-updates', (route) => route.abort(), {
    times: 1,
  });
  await page
    .getByRole('button', {
      name: 'Approve update to “Retried browser draft edit”',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Retry approved update to “Retried browser draft edit”',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Reject update to “Retried browser draft edit”',
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.locator('#drafts li')).toContainText(
    'First browser draft edit',
  );
  await page.reload();
  await page
    .getByRole('button', {
      name: 'Retry approved update to “Retried browser draft edit”',
      exact: true,
    })
    .click();
  await expect(page.getByRole('status')).toHaveText(
    'Update saved and verified.',
  );
  await expect(page.locator('#drafts li')).toContainText(
    'Retried browser draft edit',
  );
  await page.getByLabel('Find drafts', { exact: true }).fill('browser draft');
  await page.getByRole('button', { name: 'Find drafts', exact: true }).click();
  await expect(page.getByLabel('Existing draft')).toContainText('version 4');
  await expect(page.locator('#update-approvals')).toBeEmpty();
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
