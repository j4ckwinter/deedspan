import { expect, test } from '@playwright/test';
test.use({ launchOptions: { args: ['--enable-features=WebMCP'] } });

test('browser discovers and executes registered application tools', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Connected: 3 WebMCP tools')).toBeVisible();
  const names = await page.evaluate(async () => {
    const context = (
      document as unknown as {
        modelContext: import('../../src/sdk/webmcp.js').ModelContext;
      }
    ).modelContext;
    const tools = await context.getTools?.();
    if (!tools || !context.executeTool)
      throw new Error('Native WebMCP unavailable');
    const create = tools.find((tool) => tool.name === 'create_draft');
    if (!create) throw new Error('create_draft not discovered');
    await context.executeTool(create, {
      projectId: 'marketing',
      title: 'Native browser draft',
    });
    return tools.map((tool) => tool.name);
  });
  expect(names.sort()).toEqual(['create_draft', 'find_project', 'get_draft']);
  await expect(page.locator('.draft-card')).toContainText(
    'Native browser draft',
  );
});
