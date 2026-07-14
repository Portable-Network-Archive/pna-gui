import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("shipped feature boundaries", () => {
  it("keeps the legacy extract component dormant", () => {
    // ARCH-UI-EXTRACT-DORMANT
    const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");
    expect(app).not.toMatch(/import\s+\{?\s*Extract\b/);
    expect(app).not.toContain("<Extract");
  });

  it("keeps extraction available only through its registered IPC contract", () => {
    // ARCH-IPC-EXTRACT-REGISTERED, ARCH-IPC-EXTRACT-DESTINATION-REQUIRED
    const backend = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8");
    expect(backend).toMatch(/async fn extract\([\s\S]*out_dir: PathBuf/);
    expect(backend).toMatch(/generate_handler!\[[\s\S]*\bextract,/);
    expect(backend).not.toMatch(
      /async fn extract\([\s\S]*out_dir: Option<PathBuf>/,
    );
  });

  it("preserves the five-platform CI architecture", () => {
    // ARCH-CI-FIVE-PLATFORMS
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
});
