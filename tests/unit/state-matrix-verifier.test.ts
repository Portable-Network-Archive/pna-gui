import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeRepositoryPath,
  parseTsv,
  validateInvariantCensus,
  validateMatrix,
} from "../../scripts/verify-state-matrix.mjs";

const header =
  "case_id\tfeature_id\tfeature\tavailability\tstate_dimension\tstate\texpected\tlayer\tplatforms\ttest_file\tautomation\tnotes";

const fixtureState = `UI-${"FIXTURE-STATE"}`;
const fixtureOrphan = `UI-${"FIXTURE-ORPHAN"}`;

function fixture(row: string, source = `// ${fixtureState}`) {
  const root = mkdtempSync(join(tmpdir(), "pna-gui-matrix-"));
  mkdirSync(join(root, "tests"));
  writeFileSync(join(root, "tests/example.test.ts"), source);
  return { root, matrix: `${header}\n${row}\n` };
}

const validRow = `${fixtureState}\tfixture\tFixture\tvisible_ui\tmode\tready\tReady is shown.\tts-unit\tall-desktop\ttests/example.test.ts\tautomated\tfixture`;

describe("state matrix verifier", () => {
  it("accepts a complete automated state", () => {
    const { root, matrix } = fixture(validRow);
    expect(validateMatrix(matrix, root).errors).toEqual([]);
  });

  it("rejects missing columns and malformed rows", () => {
    expect(() => parseTsv(`case_id\n${fixtureState}\n`)).toThrow(
      "Missing required column",
    );
    expect(() => parseTsv(`${header}\n${fixtureState}\n`)).toThrow("columns");
  });

  it("rejects duplicate, unautomated, invalid-layer, and missing-marker states", () => {
    const bad = validRow
      .replace("\tts-unit\t", "\tmanual\t")
      .replace("\tautomated\t", "\tplanned\t");
    const { root, matrix } = fixture(`${bad}\n${bad}`, "// no marker");
    const errors = validateMatrix(matrix, root).errors.join("\n");
    expect(errors).toContain("Duplicate case_id");
    expect(errors).toContain("Invalid layer");
    expect(errors).toContain("is not automated");
    expect(errors).toContain("is absent");
  });

  it("rejects test markers that are not inventoried", () => {
    const { root, matrix } = fixture(
      validRow,
      `// ${fixtureState} ${fixtureOrphan}`,
    );
    expect(validateMatrix(matrix, root).errors).toContain(
      `Test marker is missing from matrix: ${fixtureOrphan}`,
    );
  });

  it("[ARCH-INVARIANT-CENSUS] requires every shipped job and picker class to inherit cross-feature guards", () => {
    const repositoryRoot = join(import.meta.dirname, "../..");
    const matrix = parseTsv(
      readFileSync(
        join(repositoryRoot, "tests/resources/feature-state-matrix.tsv"),
        "utf8",
      ),
    );
    expect(validateInvariantCensus(matrix, repositoryRoot)).toEqual([]);
  });

  it("[ARCH-INVARIANT-PATH-PORTABILITY] compares invariant-managed source paths independently of the host separator", () => {
    expect(
      normalizeRepositoryPath(
        "D:\\a\\pna-gui\\pna-gui",
        "D:\\a\\pna-gui\\pna-gui\\src\\tabs\\Extract.tsx",
      ),
    ).toBe("src/tabs/Extract.tsx");
    expect(
      normalizeRepositoryPath(
        "/home/runner/work/pna-gui/pna-gui",
        "/home/runner/work/pna-gui/pna-gui/src/tabs/Extract.tsx",
      ),
    ).toBe("src/tabs/Extract.tsx");
  });

  it("rejects a newly added job API until its invariant class is declared", () => {
    const repositoryRoot = join(import.meta.dirname, "../..");
    const matrix = parseTsv(
      readFileSync(
        join(repositoryRoot, "tests/resources/feature-state-matrix.tsv"),
        "utf8",
      ),
    );
    const root = mkdtempSync(join(tmpdir(), "pna-gui-invariant-"));
    mkdirSync(join(root, "src/features/jobs"), { recursive: true });
    mkdirSync(join(root, "src-tauri/src"), { recursive: true });
    const realJobApi = readFileSync(
      join(repositoryRoot, "src/features/jobs/api.ts"),
      "utf8",
    );
    writeFileSync(
      join(root, "src/features/jobs/api.ts"),
      realJobApi.replace(
        /\n};\s*$/,
        '\n  startFutureJob: () => invoke("job_start_future_job"),\n};\n',
      ),
    );
    writeFileSync(
      join(root, "src-tauri/src/jobs.rs"),
      readFileSync(join(repositoryRoot, "src-tauri/src/jobs.rs"), "utf8"),
    );

    expect(validateInvariantCensus(matrix, root)).toContain(
      "Job API startFutureJob has no single-flight invariant mapping or explicit read-only exclusion.",
    );
  });

  it("rejects an ungated picker added to a file that already uses the shared gate", () => {
    const repositoryRoot = join(import.meta.dirname, "../..");
    const matrix = parseTsv(
      readFileSync(
        join(repositoryRoot, "tests/resources/feature-state-matrix.tsv"),
        "utf8",
      ),
    );
    const root = mkdtempSync(join(tmpdir(), "pna-gui-picker-invariant-"));
    mkdirSync(join(root, "src/features/jobs"), { recursive: true });
    mkdirSync(join(root, "src-tauri/src"), { recursive: true });
    writeFileSync(
      join(root, "src/features/jobs/api.ts"),
      readFileSync(join(repositoryRoot, "src/features/jobs/api.ts"), "utf8"),
    );
    writeFileSync(
      join(root, "src-tauri/src/jobs.rs"),
      readFileSync(join(repositoryRoot, "src-tauri/src/jobs.rs"), "utf8"),
    );
    writeFileSync(
      join(root, "src/picker.tsx"),
      `
        import { open } from "@tauri-apps/plugin-dialog";
        import { createSingleFlightGate } from "./features/singleFlight";
        const gate = createSingleFlightGate();
        export const existing = () => gate.run("picker", async () => open());
        export const regression = () => open();
      `,
    );

    expect(validateInvariantCensus(matrix, root)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^Native picker call bypasses the shared gate: src\/picker\.tsx:\d+\.$/,
        ),
      ]),
    );
  });
});
