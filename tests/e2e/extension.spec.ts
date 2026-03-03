import { test, expect } from './fixtures';

test('extension loads and has popup', async ({ context, extensionId }) => {
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popupPage.locator('body')).toBeVisible();
});
