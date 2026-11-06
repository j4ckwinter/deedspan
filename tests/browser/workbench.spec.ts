import { expect, test } from '@playwright/test';

test('runs, detects regression, persists evidence and resets without duplicates', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Run scenario', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: /Run report Passed/i }),
  ).toBeVisible();
  await expect(page.locator('.draft-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Run scenario', exact: true }).click();
  await expect(page.locator('.draft-card')).toHaveCount(1);
  await page.getByRole('checkbox', { name: /Introduce a regression/ }).check();
  await page.getByRole('button', { name: 'Run scenario', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: /Run report Failed/i }),
  ).toBeVisible();
  await expect(page.locator('.assertion.failed')).toContainText(
    'Project assignment',
  );
  await expect(page.locator('.comparison-note')).toContainText('passed');
  await page.screenshot({
    path: 'test-results/workbench-desktop.png',
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole('heading', { name: /Run report Failed/i }),
  ).toBeVisible();
  await expect(page.getByLabel('Run history').locator('option')).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole('button', { name: 'Run scenario', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/workbench-mobile.png',
    fullPage: true,
  });
});

test('saves independent expectations and exports a reusable scenario', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /New scenario/ }).click();
  await page
    .getByLabel('Scenario name', { exact: true })
    .fill('Engineering release');
  await page
    .getByRole('textbox', { name: 'Task prompt', exact: true })
    .fill('Create Release checklist in the Engineering project.');
  await page
    .getByLabel('Expected draft title', { exact: true })
    .fill('Release checklist');
  await page
    .getByRole('combobox', { name: 'Expected project', exact: true })
    .selectOption('engineering');
  await page
    .getByRole('button', { name: 'Save scenario', exact: true })
    .click();
  await page.getByRole('button', { name: 'Run scenario', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: /Run report Passed/i }),
  ).toBeVisible();
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export scenario', exact: true })
    .click();
  expect((await download).suggestedFilename()).toMatch(/^scenario-.*\.json$/);
  await page.reload();
  await expect(
    page.getByRole('navigation', { name: 'Saved scenarios' }),
  ).toContainText('Engineering release');
});

test('model mode executes returned calls and checks application state', async ({
  page,
}) => {
  await page.route('**/api/agent/step', async (route) => {
    const request = route.request().postDataJSON();
    const results = request.messages.filter(
      (m: { role: string }) => m.role === 'tool',
    );
    const call = (name: string, input: unknown) => ({
      content: null,
      tool_calls: [
        {
          id: crypto.randomUUID(),
          type: 'function',
          function: { name, arguments: JSON.stringify(input) },
        },
      ],
    });
    let response;
    if (!results.length) response = call('find_project', { name: 'Marketing' });
    else if (results.length === 1)
      response = call('create_draft', {
        projectId: 'marketing',
        title: 'November launch notes',
      });
    else if (results.length === 2)
      response = call('get_draft', { id: JSON.parse(results[1].content).id });
    else response = { content: 'Completed using tools.' };
    await route.fulfill({ json: response });
  });
  await page.goto('/');
  await page
    .getByRole('combobox', { name: 'Execution mode', exact: true })
    .selectOption('model');
  await page.getByRole('button', { name: 'Run scenario', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: /Run report Passed/i }),
  ).toBeVisible();
  await expect(page.locator('.agent-message')).toContainText(
    'Completed using tools.',
  );
});
