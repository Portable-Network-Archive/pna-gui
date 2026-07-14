import { defineConfig } from "@playwright/experimental-ct-react";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  use: {
    ctPort: 3100,
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 720 },
  },
  reporter: "line",
});
