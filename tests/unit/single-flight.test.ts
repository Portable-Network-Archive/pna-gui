import { describe, expect, it, vi } from "vitest";
import { createSingleFlightGate } from "../../src/features/singleFlight";

describe("single-flight action gate", () => {
  it("[UI-PICKER-SINGLE-FLIGHT] coalesces one action without blocking an unrelated action", async () => {
    const gate = createSingleFlightGate();
    let release!: () => void;
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const unrelated = vi.fn().mockResolvedValue("other");

    const first = gate.run("picker", action);
    const duplicate = gate.run("picker", action);
    const other = gate.run("archive-open", unrelated);

    expect(action).toHaveBeenCalledTimes(1);
    expect(duplicate).toBe(first);
    await expect(other).resolves.toBe("other");
    release();
    await first;

    const next = gate.run("picker", action);
    expect(action).toHaveBeenCalledTimes(2);
    release();
    await next;
  });
});
