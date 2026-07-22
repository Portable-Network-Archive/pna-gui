import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

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

const FRONTEND_JOB_CASES = {
  startCreate: "UI-JOB-SINGLE-FLIGHT-CREATE",
  startExtract: "UI-JOB-SINGLE-FLIGHT-EXTRACT",
  startAppend: "UI-JOB-SINGLE-FLIGHT-APPEND",
  startDelete: "UI-JOB-SINGLE-FLIGHT-DELETE",
  startRename: "UI-JOB-SINGLE-FLIGHT-RENAME",
  startSplit: "UI-JOB-SINGLE-FLIGHT-SPLIT",
  startConcat: "UI-JOB-SINGLE-FLIGHT-CONCAT",
  startSort: "UI-JOB-SINGLE-FLIGHT-SORT",
  startStrip: "UI-JOB-SINGLE-FLIGHT-STRIP",
  startMigrate: "UI-JOB-SINGLE-FLIGHT-MIGRATE",
  startVerify: "UI-JOB-SINGLE-FLIGHT-VERIFY",
  startCompare: "UI-JOB-SINGLE-FLIGHT-COMPARE",
  cancel: "UI-JOB-SINGLE-FLIGHT-CANCEL",
  retry: "UI-JOB-SINGLE-FLIGHT-RETRY",
  dismiss: "UI-JOB-SINGLE-FLIGHT-DISMISS",
  revealOutput: "UI-JOB-SINGLE-FLIGHT-REVEAL",
};

const BACKEND_JOB_CASES = {
  Create: "BE-JOB-CONFLICT-CREATE",
  Extract: "BE-JOB-CONFLICT-EXTRACT",
  Append: "BE-JOB-CONFLICT-APPEND",
  Delete: "BE-JOB-CONFLICT-DELETE",
  Rename: "BE-JOB-CONFLICT-RENAME",
  Split: "BE-JOB-CONFLICT-SPLIT",
  Concat: "BE-JOB-CONFLICT-CONCAT",
  Sort: "BE-JOB-CONFLICT-SORT",
  Strip: "BE-JOB-CONFLICT-STRIP",
  Migrate: "BE-JOB-CONFLICT-MIGRATE",
  Verify: "BE-JOB-CONFLICT-VERIFY",
  Compare: "BE-JOB-CONFLICT-COMPARE",
};

const FRONTEND_JOB_READ_ONLY_METHODS = new Set([
  "verificationSourceMatches",
  "list",
]);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

export function normalizeRepositoryPath(repositoryRoot, absolutePath) {
  return absolutePath
    .slice(repositoryRoot.length)
    .replace(/^[\\/]+/, "")
    .replaceAll("\\", "/");
}

function ungatedNativePickerCalls(path, source) {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const pickerNames = new Set();
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      statement.moduleSpecifier.text === "@tauri-apps/plugin-dialog" &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      for (const element of statement.importClause.namedBindings.elements) {
        pickerNames.add(element.name.text);
      }
    }
  }
  const failures = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      pickerNames.has(node.expression.text)
    ) {
      let ancestor = node.parent;
      let gated = false;
      while (ancestor) {
        if (
          (ts.isArrowFunction(ancestor) || ts.isFunctionExpression(ancestor)) &&
          ts.isCallExpression(ancestor.parent) &&
          ancestor.parent.arguments.includes(ancestor) &&
          ts.isPropertyAccessExpression(ancestor.parent.expression) &&
          ancestor.parent.expression.name.text === "run"
        ) {
          gated = true;
          break;
        }
        ancestor = ancestor.parent;
      }
      if (!gated) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        );
        failures.push(line + 1);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return failures;
}

export function validateInvariantCensus(rows, repositoryRoot) {
  const errors = [];
  const ids = new Set(rows.map((row) => row.case_id));
  const frontend = readFileSync(
    resolve(repositoryRoot, "src/features/jobs/api.ts"),
    "utf8",
  );
  const jobApiBody = frontend.slice(frontend.indexOf("export const jobApi"));
  const methods = [
    ...jobApiBody.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]+):/gm),
  ].map((match) => match[1]);
  for (const method of methods.filter(
    (candidate) => candidate in FRONTEND_JOB_CASES,
  )) {
    const caseId = FRONTEND_JOB_CASES[method];
    if (!ids.has(caseId)) {
      errors.push(`Job API ${method} has no invariant matrix row ${caseId}.`);
    }
    const implementation =
      jobApiBody.match(
        new RegExp(
          `^ {2}${method}:([\\s\\S]*?)(?=^ {2}[A-Za-z][A-Za-z0-9]+:|^};)`,
          "m",
        ),
      )?.[0] ?? "";
    if (!implementation.includes("invokeSingleFlight")) {
      errors.push(`Job API ${method} bypasses the single-flight boundary.`);
    }
  }
  for (const method of Object.keys(FRONTEND_JOB_CASES)) {
    if (!methods.includes(method)) {
      errors.push(`Expected invariant-managed Job API is missing: ${method}.`);
    }
  }
  for (const method of methods) {
    if (
      !(method in FRONTEND_JOB_CASES) &&
      !FRONTEND_JOB_READ_ONLY_METHODS.has(method)
    ) {
      errors.push(
        `Job API ${method} has no single-flight invariant mapping or explicit read-only exclusion.`,
      );
    }
  }

  const backend = readFileSync(
    resolve(repositoryRoot, "src-tauri/src/jobs.rs"),
    "utf8",
  );
  const kindBody =
    backend.match(/pub enum JobKind \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const kinds = [...kindBody.matchAll(/^\s{4}([A-Z][A-Za-z0-9]+),$/gm)].map(
    (match) => match[1],
  );
  for (const kind of kinds) {
    const caseId = BACKEND_JOB_CASES[kind];
    if (!caseId) {
      errors.push(
        `JobKind ${kind} has no resource-conflict invariant mapping.`,
      );
    } else if (!ids.has(caseId)) {
      errors.push(`JobKind ${kind} has no invariant matrix row ${caseId}.`);
    }
  }

  const dormantPickerExclusions = new Set(["src/tabs/Extract.tsx"]);
  for (const path of sourceFiles(resolve(repositoryRoot, "src"))) {
    if (!/\.(?:ts|tsx)$/.test(path)) continue;
    const relative = normalizeRepositoryPath(repositoryRoot, path);
    const source = readFileSync(path, "utf8");
    if (
      source.includes("@tauri-apps/plugin-dialog") &&
      !dormantPickerExclusions.has(relative) &&
      !source.includes("createSingleFlightGate")
    ) {
      errors.push(
        `Native picker consumer bypasses the shared gate: ${relative}.`,
      );
    }
    if (!dormantPickerExclusions.has(relative)) {
      for (const line of ungatedNativePickerCalls(path, source)) {
        errors.push(
          `Native picker call bypasses the shared gate: ${relative}:${line}.`,
        );
      }
    }
  }
  return errors;
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
  result.errors.push(...validateInvariantCensus(result.rows, repositoryRoot));
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
