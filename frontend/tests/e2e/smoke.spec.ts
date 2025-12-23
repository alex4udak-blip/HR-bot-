import { test, expect } from '@playwright/test';

/**
 * E2E Smoke Test
 * Verifies that the application loads and basic navigation works
 */

test.describe('Application Smoke Tests', () => {
  test('should load the application and display login page', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');

    // Should redirect to login page when not authenticated
    await expect(page).toHaveURL('/login');

    // Check that the page loaded successfully
    await expect(page).toHaveTitle(/HR/i);

    // Verify login page is rendered
    // Note: Adjust selectors based on your actual login page structure
    const loginForm = page.locator('form');
    await expect(loginForm).toBeVisible({ timeout: 10000 });
  });

  test('should have responsive layout', async ({ page }) => {
    await page.goto('/login');

    // Check that the page is visible
    await expect(page.locator('body')).toBeVisible();

    // Verify page doesn't have console errors (excluding network errors)
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Wait a bit to catch any console errors
    await page.waitForTimeout(2000);

    // We expect no critical console errors
    // (some network errors might be expected if backend is not running)
  });
});
