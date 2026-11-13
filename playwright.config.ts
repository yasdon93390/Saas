import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de bout en bout : un vrai navigateur, la vraie application et la pile
 * Supabase locale (`pnpm supabase:start`). Les emails sont interceptés par
 * Mailpit, rien ne part sur Internet.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "off",
    locale: "fr-FR",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm build && pnpm start",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
