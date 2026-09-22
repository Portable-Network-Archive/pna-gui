import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const bundleRoot = resolve(
  process.argv[2] ?? join(root, "src-tauri", "target", "release", "bundle"),
);
const outputRoot = resolve(
  process.env.TAURI_VERIFY_OUTPUT ?? join(root, "target", "tauri-action-v1-verification"),
);
const version = JSON.parse(
  readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"),
).version;

function fail(message) {
  throw new Error(message);
}

function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

const files = filesUnder(bundleRoot);
const signatures = files.filter((path) => path.endsWith(".sig"));
const signedBundles = signatures.map((signaturePath) => signaturePath.slice(0, -4));

if (signatures.length === 0) {
  fail(`No updater signatures were produced below ${bundleRoot}`);
}

for (const signaturePath of signatures) {
  const bundlePath = signaturePath.slice(0, -4);
  const signature = readFileSync(signaturePath, "utf8").trim();
  if (!existsSync(bundlePath)) {
    fail(`Signature has no matching bundle: ${signaturePath}`);
  }
  if (!signature) {
    fail(`Signature is empty: ${signaturePath}`);
  }
}

if (!files.some((path) => basename(path).includes(version))) {
  fail(`Version is missing from bundle artifact names below ${bundleRoot}`);
}

const owner = "Portable-Network-Archive";
const repo = "pna-gui";
const releaseAssetApi = `https://api.github.com/repos/${owner}/${repo}/releases/assets`;
const platforms = {};

for (const [index, bundlePath] of signedBundles.entries()) {
  const signaturePath = `${bundlePath}.sig`;
  const name = basename(bundlePath);
  const platform = process.platform === "darwin" ? "darwin" : process.platform;
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  const key = `${platform}-${arch}-${index}`;
  platforms[key] = {
    signature: readFileSync(signaturePath, "utf8"),
    url: `${releaseAssetApi}/${index + 1}`,
    asset: name,
  };
}

const latest = {
  version,
  notes: "CI-only tauri-action v1 release contract",
  pub_date: new Date().toISOString(),
  platforms,
};

for (const [key, entry] of Object.entries(latest.platforms)) {
  if (!entry.url.startsWith(`${releaseAssetApi}/`)) {
    fail(`Updater URL is not a v1 GitHub release asset URL for ${key}`);
  }
  if (!entry.signature.trim()) {
    fail(`latest.json contains an empty signature for ${key}`);
  }
  const matchingSignature = files.find((path) => basename(path) === `${entry.asset}.sig`);
  if (!matchingSignature) {
    fail(`latest.json asset has no matching signature file: ${entry.asset}`);
  }
  if (readFileSync(matchingSignature, "utf8") !== entry.signature) {
    fail(`latest.json signature does not match ${basename(matchingSignature)}`);
  }
}

const publishWorkflow = readFileSync(join(root, ".github", "workflows", "publish.yml"), "utf8");
if (!publishWorkflow.includes("tauri-apps/tauri-action@v1")) {
  fail("publish.yml is not migrated to tauri-action@v1");
}
if (!publishWorkflow.includes("uploadUpdaterJson: true")) {
  fail("publish.yml does not explicitly enable uploadUpdaterJson");
}
for (const removedInput of ["includeUpdaterJson", "updaterJsonKeepUniversal"]) {
  if (publishWorkflow.includes(removedInput)) {
    fail(`publish.yml still contains removed tauri-action input: ${removedInput}`);
  }
}

mkdirSync(outputRoot, { recursive: true });
const latestPath = join(outputRoot, "latest.json");
writeFileSync(latestPath, `${JSON.stringify(latest, null, 2)}\n`);
console.log(`Verified ${signatures.length} signed artifacts and wrote ${latestPath}`);
