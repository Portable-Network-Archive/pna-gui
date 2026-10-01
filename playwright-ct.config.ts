import { defineConfig } from "@playwright/experimental-ct-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  use: {
    ctPort: 3100,
    ctViteConfig: {
      resolve: {
        alias: {
          "@pna/e2e-bridge": fileURLToPath(
            new URL("./src/testing/e2e-bridge.ts", import.meta.url),
          ),
        },
      },
    },
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 720 },
  },
  reporter: "line",
});
