import { defineConfig } from "@playwright/test";

const testPort = process.env.HYZR_CHAT_TEST_PORT ?? process.env.VMX_TEST_PORT ?? "4173";
const testBaseUrl = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: { baseURL: testBaseUrl, trace: "retain-on-failure" },
  reporter: "line",
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${testPort}`,
    url: `${testBaseUrl}/api/health`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
