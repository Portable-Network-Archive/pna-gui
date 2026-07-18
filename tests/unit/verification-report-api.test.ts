import { describe, expect, it } from "vitest";
import { normalizeReportExportError } from "../../src/features/verification/api";

describe("normalizeReportExportError", () => {
  it("passes through a well-shaped error with a known code", () => {
    const error = { code: "conflict", message: "x" };
    expect(normalizeReportExportError(error)).toEqual(error);
  });

  it("falls back to io for a plain Error instance", () => {
    const error = new Error("boom");
    expect(normalizeReportExportError(error)).toEqual({
      code: "io",
      message: "boom",
    });
  });

  it("falls back to io for a plain string value", () => {
    expect(normalizeReportExportError("boom")).toEqual({
      code: "io",
      message: "boom",
    });
  });

  it("rejects an object with an unknown code and falls back to io", () => {
    const error = { code: "not_a_real_code", message: "x" };
    expect(normalizeReportExportError(error)).toEqual({
      code: "io",
      message: String(error),
    });
  });
});
