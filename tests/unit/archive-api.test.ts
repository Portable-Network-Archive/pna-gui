import { describe, expect, it } from "vitest";
import { normalizeAppError } from "../../src/features/archive/api";

describe("archive API errors", () => {
  it("[UI-ERROR-INTERNAL-BOUNDARY] keeps raw bridge failures out of the user-facing message", () => {
    const error = normalizeAppError(
      "thread 'worker' panicked at src/operations.rs:42",
    );

    expect(error.message).toBe("The operation could not be completed.");
    expect(error.context).toBe(
      "thread 'worker' panicked at src/operations.rs:42",
    );
    expect(normalizeAppError(new Error("native picker failed"))).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "The operation could not be completed.",
      context: "native picker failed",
    });
  });
});
