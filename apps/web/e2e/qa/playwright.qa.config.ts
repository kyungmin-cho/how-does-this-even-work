import path from "node:path";
import { defineConfig } from "@playwright/test";

// QA-only config (midpoint check). Its own port so it never collides with other sessions' dev servers.
// Run: pnpm --filter @assembly/web exec playwright test -c e2e/qa/playwright.qa.config.ts
// Test files end in .qa.ts so the main config (testDir ./e2e) never picks them up.
const PORT = Number(process.env.QA_PORT ?? 3210);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.qa\.ts$/,
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  retries: 3,
  timeout: 300_000,
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  },
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    cwd: path.resolve(__dirname, "../.."),
    url: `${baseURL}/dev/engine`,
    reuseExistingServer: true,
    timeout: 180_000,
    env: { AGENT_MOCK: "1" },
  },
});
