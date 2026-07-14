import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_COLUMNS = [
  "case_id",
  "feature_id",
  "feature",
  "availability",
  "state_dimension",
  "state",
  "expected",
  "layer",
  "platforms",
  "test_file",
  "automation",
];
const ALLOWED_LAYERS = new Set([
  "ts-unit",
  "react-component",
  "rust-unit",
  "rust-integration",
  "browser-component",
  "tauri-e2e",
  "build-contract",
]);
const CASE_PATTERN = /\b(?:UI|BE|ARCH|E2E)-[A-Z0-9-]+\b/g;

export function parseTsv(source) {
  const lines = source.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("The state matrix has no state rows.");
  const columns = lines[0].split("\t");
  for (const required of REQUIRED_COLUMNS) {
    if (!columns.includes(required)) {
      throw new Error(`Missing required column: ${required}`);
    }
  }
  return lines.slice(1).map((line, index) => {
    const values = line.split("\t");
    if (values.length !== columns.length) {
      throw new Error(
        `Row ${index + 2} has ${values.length} columns; expected ${columns.length}.`,
      );
    }
    return Object.fromEntries(
      columns.map((column, offset) => [column, values[offset]]),
    );
  });
}

export function validateMatrix(source, repositoryRoot) {
  const rows = parseTsv(source);
  const errors = [];
  const ids = new Set();

  for (const row of rows) {
    if (!/^(?:UI|BE|ARCH|E2E)-[A-Z0-9-]+$/.test(row.case_id)) {
      errors.push(`Invalid case_id: ${row.case_id}`);
    }
    if (ids.has(row.case_id)) errors.push(`Duplicate case_id: ${row.case_id}`);
    ids.add(row.case_id);
    if (!ALLOWED_LAYERS.has(row.layer)) {
      errors.push(`Invalid layer for ${row.case_id}: ${row.layer}`);
    }
    if (row.automation !== "automated") {
      errors.push(`${row.case_id} is not automated.`);
    }
    const testPath = resolve(repositoryRoot, row.test_file);
    if (!existsSync(testPath)) {
      errors.push(`Missing test file for ${row.case_id}: ${row.test_file}`);
      continue;
    }
    const testSource = readFileSync(testPath, "utf8");
    if (!new RegExp(`\\b${row.case_id}\\b`).test(testSource)) {
      errors.push(
        `Test marker ${row.case_id} is absent from ${row.test_file}.`,
      );
    }
  }

  const managedFiles = new Set(rows.map((row) => row.test_file));
  for (const file of managedFiles) {
    const testSource = readFileSync(resolve(repositoryRoot, file), "utf8");
    for (const caseId of testSource.match(CASE_PATTERN) ?? []) {
      if (!ids.has(caseId))
        errors.push(`Test marker is missing from matrix: ${caseId}`);
    }
  }

  return { rows, errors };
}

function main() {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const matrixPath = resolve(
    repositoryRoot,
    "tests/resources/feature-state-matrix.tsv",
  );
  const result = validateMatrix(
    readFileSync(matrixPath, "utf8"),
    repositoryRoot,
  );
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Verified ${result.rows.length} automated feature-state rows.`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
