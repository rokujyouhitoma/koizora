const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    actionTimeout: 0,
    baseURL: 'http://localhost:8080',
    trace: 'on-first-retry',
    headless: true,
  },
  webServer: {
    command: 'npx -y http-server -p 8080 -c-1',
    url: 'http://localhost:8080',
    reuseExistingServer: true,
    timeout: 10000,
  },
});
