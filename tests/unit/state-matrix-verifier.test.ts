import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseTsv,
  validateMatrix,
} from "../../scripts/verify-state-matrix.mjs";

const header =
  "case_id\tfeature_id\tfeature\tavailability\tstate_dimension\tstate\texpected\tlayer\tplatforms\ttest_file\tautomation\tnotes";

function fixture(row: string, source = "// UI-FIXTURE-STATE") {
  const root = mkdtempSync(join(tmpdir(), "pna-gui-matrix-"));
  mkdirSync(join(root, "tests"));
  writeFileSync(join(root, "tests/example.test.ts"), source);
  return { root, matrix: `${header}\n${row}\n` };
}

const validRow =
  "UI-FIXTURE-STATE\tfixture\tFixture\tvisible_ui\tmode\tready\tReady is shown.\tts-unit\tall-desktop\ttests/example.test.ts\tautomated\tfixture";

describe("state matrix verifier", () => {
  it("accepts a complete automated state", () => {
    const { root, matrix } = fixture(validRow);
    expect(validateMatrix(matrix, root).errors).toEqual([]);
  });

  it("rejects missing columns and malformed rows", () => {
    expect(() => parseTsv("case_id\nUI-FIXTURE-STATE\n")).toThrow(
      "Missing required column",
    );
    expect(() => parseTsv(`${header}\nUI-FIXTURE-STATE\n`)).toThrow("columns");
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
      "// UI-FIXTURE-STATE UI-FIXTURE-ORPHAN",
    );
    expect(validateMatrix(matrix, root).errors).toContain(
      "Test marker is missing from matrix: UI-FIXTURE-ORPHAN",
    );
  });
});
