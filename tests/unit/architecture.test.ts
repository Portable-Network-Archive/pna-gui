import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("shipped feature boundaries", () => {
  it("ships extraction through the archive browser instead of the legacy tab", () => {
    // ARCH-P2-UI-EXTRACT-VISIBLE
    const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
    const tabs = readFileSync(resolve(root, "src/tabs/index.ts"), "utf8");
    expect(app).not.toMatch(/import\s+\{?\s*Extract\b/);
    expect(app).toContain("<ExtractDialog");
    expect(app).toContain("jobApi.startExtract");
    expect(tabs).not.toMatch(/(?:import|export)[^;]*\bExtract\b/);
  });

  it("registers the phase two job IPC with a required extraction destination", () => {
    // ARCH-P2-IPC-JOBS-REGISTERED, ARCH-IPC-EXTRACT-DESTINATION-REQUIRED, ARCH-UX-JOB-RESULT-COMMANDS
    const backend = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8");
    const operations = readFileSync(
      resolve(root, "src-tauri/src/operations.rs"),
      "utf8",
    );
    for (const command of [
      "job_start_create",
      "job_start_extract",
      "job_list",
      "job_cancel",
      "job_retry",
      "job_dismiss",
      "job_reveal_output",
    ]) {
      expect(backend).toMatch(
        new RegExp(`generate_handler!\\[[\\s\\S]*\\b${command},?`),
      );
    }
    expect(operations).toMatch(/pub destination: PathBuf/);
    expect(operations).not.toMatch(/pub destination: Option<PathBuf>/);
  });

  it("preserves the five-platform CI architecture", () => {
    // ARCH-CI-FIVE-PLATFORMS, ARCH-CI-RUST-FRONTEND-ASSET
    const workflow = readFileSync(
      resolve(root, ".github/workflows/test.yml"),
      "utf8",
    );
    for (const platform of [
      "macos-latest",
      "ubuntu-latest",
      "ubuntu-24.04-arm",
      "windows-latest",
      "windows-11-arm",
    ]) {
      expect(workflow).toContain(`- ${platform}`);
    }
    expect(workflow).toContain("build frontend asset for Rust tests");
    expect(workflow.indexOf("run: npm run build")).toBeLessThan(
      workflow.indexOf("run: npm run test:rust"),
    );
  });

  it("keeps native file association and command-line opening configured", () => {
    // ARCH-NATIVE-FILE-ASSOCIATION, ARCH-NATIVE-CLI-SOURCE
    const config = JSON.parse(
      readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"),
    );
    expect(config.bundle.fileAssociations[0].ext).toContain(".pna");
    expect(config.plugins.cli.args).toContainEqual(
      expect.objectContaining({ name: "source", index: 1, takesValue: true }),
    );
  });

  it("keeps updater, application menu, and tray routes registered", () => {
    // ARCH-NATIVE-UPDATER, ARCH-NATIVE-MENU-TRAY
    const backend = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8");
    expect(backend).toContain("tauri_plugin_updater::Builder");
    expect(backend).toContain('handle.emit("tauri://update"');
    expect(
      backend.match(/handle\.emit\("switch_tab", "extract"\)/g),
    ).toHaveLength(2);
    expect(
      backend.match(/handle\.emit\("switch_tab", "create"\)/g),
    ).toHaveLength(2);
  });

  it("keeps the desktop automation bridge in the dedicated E2E build", () => {
    // ARCH-E2E-DEBUG-ONLY, ARCH-E2E-PRODUCTION-ISOLATED, ARCH-E2E-EMBEDDED, ARCH-E2E-FEATURE-GATED, ARCH-E2E-CAPABILITY-ISOLATED
    const backend = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8");
    const cargo = readFileSync(resolve(root, "src-tauri/Cargo.toml"), "utf8");
    const buildScript = readFileSync(
      resolve(root, "scripts/build-tauri-e2e.mjs"),
      "utf8",
    );
    const wdioConfig = readFileSync(resolve(root, "wdio.conf.ts"), "utf8");
    const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
    const defaultConfig = JSON.parse(
      readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"),
    );
    const e2eConfig = JSON.parse(
      readFileSync(resolve(root, "src-tauri/tauri.e2e.conf.json"), "utf8"),
    );
    const productionPermissions = readFileSync(
      resolve(root, "src-tauri/capabilities/migrated.json"),
      "utf8",
    );
    expect(backend).toMatch(
      /#\[cfg\(all\(debug_assertions, feature = "tauri-e2e"\)\)\][\s\S]*tauri_plugin_wdio::init\(\)[\s\S]*tauri_plugin_wdio_webdriver::init\(\)/,
    );
    expect(cargo).toMatch(/tauri-plugin-wdio[^\n]*optional = true/);
    expect(cargo).toMatch(/tauri-plugin-wdio-webdriver[^\n]*optional = true/);
    expect(cargo).toContain(
      'tauri-e2e = ["dep:tauri-plugin-wdio", "dep:tauri-plugin-wdio-webdriver"]',
    );
    expect(buildScript).toContain('"tauri-e2e"');
    expect(e2eConfig.build.beforeBuildCommand).toBe("npm run build");
    expect(defaultConfig.app.withGlobalTauri).not.toBe(true);
    expect(defaultConfig.app.security.capabilities).toEqual([
      "migrated",
      "desktop-capability",
    ]);
    expect(e2eConfig.app.withGlobalTauri).toBe(true);
    expect(e2eConfig.app.security.capabilities.at(-1).permissions).toEqual([
      "wdio:default",
      "wdio-webdriver:default",
    ]);
    expect(productionPermissions).not.toContain("wdio:");
    expect(productionPermissions).not.toContain("wdio-webdriver:");
    expect(app).toContain('from "@pna/e2e-bridge"');
    expect(wdioConfig).toContain('driverProvider: "embedded"');
    expect(wdioConfig).toContain("TAURI_WEBDRIVER_PORT");
    expect(wdioConfig).toContain("captureFrontendLogs");
    expect(wdioConfig).toContain("captureBackendLogs");
  });

  it("keeps non-product dependencies and APIs out of release builds", () => {
    // ARCH-RELEASE-RUST-DEPENDENCIES, ARCH-RELEASE-FRONTEND-BUNDLE, ARCH-RELEASE-NO-PRIVATE-API
    const cargo = readFileSync(resolve(root, "src-tauri/Cargo.toml"), "utf8");
    const backend = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8");
    const config = JSON.parse(
      readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"),
    );
    const packageJson = JSON.parse(
      readFileSync(resolve(root, "package.json"), "utf8"),
    );
    const releaseVerifier = readFileSync(
      resolve(root, "scripts/verify-release-boundary.mjs"),
      "utf8",
    );

    expect(cargo).not.toContain("macos-private-api");
    expect(cargo).not.toContain("tauri-plugin-shell");
    expect(backend).not.toContain("tauri_plugin_shell");
    expect(config.app.macOSPrivateApi).not.toBe(true);
    expect(config.build.beforeBuildCommand).toBe("npm run build:release");
    expect(packageJson.scripts["build:release"]).toContain(
      "test:release-boundary",
    );
    expect(
      packageJson.dependencies["@tauri-apps/plugin-shell"],
    ).toBeUndefined();
    expect(
      packageJson.dependencies["@tauri-apps/plugin-updater"],
    ).toBeUndefined();
    expect(packageJson.devDependencies["@wdio/tauri-plugin"]).toBeDefined();
    expect(releaseVerifier).toContain('"wdioTauri"');
    expect(releaseVerifier).toContain('"[WDIO Tauri Plugin]"');
    expect(releaseVerifier).toContain('"Drop .pna file here"');
  });

  it("grants only IPC permissions used by the shipped frontend", () => {
    // ARCH-RELEASE-MINIMAL-IPC
    const migrated = JSON.parse(
      readFileSync(
        resolve(root, "src-tauri/capabilities/migrated.json"),
        "utf8",
      ),
    );
    const desktop = JSON.parse(
      readFileSync(
        resolve(root, "src-tauri/capabilities/desktop.json"),
        "utf8",
      ),
    );
    expect(migrated.permissions).toEqual([
      "core:default",
      "fs:allow-read-dir",
      "dialog:allow-open",
      "dialog:allow-save",
    ]);
    expect(desktop.permissions).toEqual(["cli:default"]);
  });

  it("runs the desktop E2E layer inside the existing CI matrix", () => {
    // ARCH-CI-TAURI-E2E
    const workflow = readFileSync(
      resolve(root, ".github/workflows/test.yml"),
      "utf8",
    );
    expect(workflow).toContain("npm run test:e2e:build");
    expect(workflow).toContain("xvfb-run -a npm run test:e2e");
    expect(workflow).toContain("matrix.platform == 'ubuntu-latest'");
  });

  it("does not discard background job event delivery failures", () => {
    // ARCH-P2-JOB-EVENT-ERROR-VISIBLE
    const backend = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8");
    expect(backend).toContain("failed to emit job-update event");
    expect(backend).not.toContain('let _ = app.emit("job-update"');
  });
});
