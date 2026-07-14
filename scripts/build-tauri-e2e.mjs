import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(
  npm,
  [
    "run",
    "tauri",
    "--",
    "build",
    "--debug",
    "--no-bundle",
    "--features",
    "tauri-e2e",
    "--config",
    "src-tauri/tauri.e2e.conf.json",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_PUBLIC_TAURI_E2E: "true",
    },
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
