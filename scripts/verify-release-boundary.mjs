import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  console.error(`- ${message}`);
  process.exitCode = 1;
}

function cargoTree() {
  const cargo = spawnSync(
    "cargo",
    [
      "tree",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--edges",
      "normal",
      "--features",
      "custom-protocol",
      "--prefix",
      "none",
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (cargo.status !== 0) {
    fail(`Could not inspect the normal Cargo graph: ${cargo.stderr.trim()}`);
    return "";
  }
  return cargo.stdout;
}

function javascriptFiles(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) files.push(...javascriptFiles(path));
    else if (extname(path) === ".js") files.push(path);
  }
  return files;
}

const tree = cargoTree();
for (const dependency of [
  "tauri-plugin-shell",
  "tauri-plugin-wdio",
  "tauri-plugin-wdio-webdriver",
]) {
  if (tree.split("\n").some((line) => line.split(" v", 1)[0] === dependency)) {
    fail(`${dependency} is present in the normal Cargo dependency graph.`);
  }
}

const output = resolve(root, "out");
if (!existsSync(output)) {
  fail("The production frontend output is missing; run `npm run build` first.");
} else {
  const bundle = javascriptFiles(output)
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  for (const marker of [
    "wdioTauri",
    "[WDIO Tauri Plugin]",
    "Drop .pna file here",
  ]) {
    if (bundle.includes(marker)) {
      fail(
        `Production frontend output contains test/dormant marker: ${marker}`,
      );
    }
  }
}

if (!process.exitCode) {
  console.log("Verified production release dependency and bundle boundaries.");
}
