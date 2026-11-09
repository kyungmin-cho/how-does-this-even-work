import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  // Real WebGL (SwiftShader) is slow, and several sessions share this machine.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL,
    headless: true,
    trace: "on-first-retry",
    // Headless Chromium needs SwiftShader for WebGL (the studio draws with the real engine).
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, headless: true } },
    {
      name: "phone",
      use: { ...devices["Pixel 7"], headless: true },
      // The engine dev page is a desktop tool.
      testIgnore: /engine\.spec\.ts/,
    },
  ],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
