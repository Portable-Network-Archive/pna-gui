import { resolve } from "node:path";
import type { Capabilities, Options } from "@wdio/types";

const repositoryRoot = import.meta.dirname;
process.env.TAURI_WEBDRIVER_PORT ??= "55445";
const binaryName =
  process.platform === "win32"
    ? "Portable Network Archive.exe"
    : "Portable Network Archive";

type TestrunnerConfig = Options.Testrunner & {
  capabilities: Capabilities.TestrunnerCapabilities;
};

export const config: TestrunnerConfig = {
  runner: "local",
  specs: ["./tests/e2e/**/*.spec.ts"],
  maxInstances: 1,
  capabilities: [{ browserName: "tauri" }],
  logLevel: "warn",
  bail: 0,
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  services: [
    [
      "tauri",
      {
        appBinaryPath: resolve(
          repositoryRoot,
          "src-tauri",
          "target",
          "debug",
          binaryName,
        ),
        appArgs: [resolve(repositoryRoot, ".e2e", "e2e-fixture.pna")],
        driverProvider: "embedded",
        embeddedPort: Number(process.env.TAURI_WEBDRIVER_PORT),
        captureBackendLogs: true,
        captureFrontendLogs: true,
        startTimeout: 60_000,
      },
    ],
  ],
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000,
  },
};
