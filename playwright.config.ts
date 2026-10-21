import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  projects: [{ name: "phone", use: { ...devices["Pixel 7"] } }],
  webServer: {
    // dotenv-cli applies .env.test first, so the app talks to the throwaway test database.
    // A separate build folder lets the tests run while a normal `npm run dev` is open.
    command: "npx dotenv run -f .env.test --override -- next dev -p 3100",
    // Blank AI settings so the tests never call a real AI host, even though Next also reads the developer's own .env.
    env: {
      NEXT_DIST_DIR: ".next-e2e",
      LLM_BASE_URL: "", LLM_API_KEY: "", LLM_MODEL: "", LLM_VISION_MODEL: "",
      STT_BASE_URL: "", STT_API_KEY: "", STT_MODEL: "",
    },
    url: "http://localhost:3100/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
