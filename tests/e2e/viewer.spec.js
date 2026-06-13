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

    test('should maintain safety margin for the last line of the last page to prevent clipping', async ({ page }) => {
        // Open the first book card
        const bookCard = page.locator('#developer-books-grid .book-card').first();
        await bookCard.click();

        // Wait for reader screen
        const readerScreen = page.locator('#reader-screen');
        await expect(readerScreen).toBeVisible();

        // Wait for content to load
        await page.waitForSelector('#reader-content p');

        // Scroll all the way to the left (end of the book)
        await page.evaluate(() => {
            const viewport = document.getElementById('reader-viewport');
            viewport.scrollLeft = -(viewport.scrollWidth - viewport.clientWidth);
        });

        // Wait for smooth scrolling to settle
        await page.waitForFunction(() => {
            const viewport = document.getElementById('reader-viewport');
            const target = -(viewport.scrollWidth - viewport.clientWidth);
            return Math.abs(viewport.scrollLeft - target) < 2;
        });

        // Get viewport and last paragraph bounding boxes
        const viewportBox = await page.locator('#reader-viewport').boundingBox();
        const lastParagraph = page.locator('#reader-content p').last();
        const lastParagraphBox = await lastParagraph.boundingBox();

        // The leftmost edge of the last paragraph should be at least 15px inside the viewport
        const leftMargin = lastParagraphBox.x - viewportBox.x;
        console.log(`Last paragraph left margin: ${leftMargin}px`);
        expect(leftMargin).toBeGreaterThanOrEqual(15);
    });
});
