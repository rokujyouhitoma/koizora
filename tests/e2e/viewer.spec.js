const { test, expect } = require('@playwright/test');

test.describe('Yuzora E2E Reader Tests', () => {
    test.beforeEach(async ({ page }) => {
        // Load the page from local server
        await page.goto('http://localhost:8080/');
    });

    test('should load welcome screen and show recommendation cards', async ({ page }) => {
        // Assert welcome screen is visible
        const welcomeScreen = page.locator('#welcome-screen');
        await expect(welcomeScreen).toBeVisible();

        // Check if recommendation grid has books
        const developerBooks = page.locator('#developer-books-grid .book-card');
        await expect(developerBooks.first()).toBeVisible();
    });

    test('should open reader screen when clicking a recommended book card', async ({ page }) => {
        // Click on the first book card (e.g. Kokoro)
        const bookCard = page.locator('#developer-books-grid .book-card').first();
        await bookCard.click();

        // Assert reader screen is visible and welcome screen is hidden
        const readerScreen = page.locator('#reader-screen');
        await expect(readerScreen).toBeVisible();
        
        const welcomeScreen = page.locator('#welcome-screen');
        await expect(welcomeScreen).toHaveClass(/hidden/);
    });

    test('should open setting drawer and change themes', async ({ page }) => {
        // Open a book first
        await page.locator('#developer-books-grid .book-card').first().click();

        // Check reader page is open
        const readerScreen = page.locator('#reader-screen');
        await expect(readerScreen).toBeVisible();

        // Open settings drawer
        const btnSettings = page.locator('#btn-settings');
        await btnSettings.click();

        // Assert settings drawer is open
        const drawer = page.locator('#settings-drawer');
        await expect(drawer).toHaveClass(/open/);

        // Click "dark" theme button
        const darkThemeBtn = page.locator('.theme-btn[data-theme="dark"]');
        await darkThemeBtn.click();

        // Assert body has theme class "theme-dark"
        const body = page.locator('body');
        await expect(body).toHaveClass(/theme-dark/);
    });
});
