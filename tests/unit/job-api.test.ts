import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));

import { jobApi, type CreateJobRequest } from "../../src/features/jobs/api";

const CREATE_REQUEST: CreateJobRequest = {
  sources: ["/tmp/source.txt"],
  outputPath: "/tmp/archive.pna",
  overwrite: false,
  options: {
    solid: false,
    compression: "zstd",
    encryption: "none",
    password: null,
    preservePermissions: true,
    reproducible: false,
  },
};

describe("job API concurrency", () => {
  beforeEach(() => {
    bridge.invoke.mockReset();
  });

  it("[UI-JOB-SINGLE-FLIGHT-CREATE] coalesces concurrent identical create requests", async () => {
    const resolvers: Array<(value: { id: string }) => void> = [];
    bridge.invoke.mockImplementation(
      () =>
        new Promise((done) => {
          resolvers.push(done);
        }),
    );

    const first = jobApi.startCreate(CREATE_REQUEST);
    const second = jobApi.startCreate(CREATE_REQUEST);
    resolvers.forEach((resolve) => resolve({ id: "job-1" }));

    expect(bridge.invoke).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);

    await expect(first).resolves.toEqual({ id: "job-1" });
  });

  it("[UI-JOB-SINGLE-FLIGHT-IDENTITY] does not coalesce materially different requests that share an output", async () => {
    bridge.invoke.mockImplementation(
      (_command, { request }: { request: CreateJobRequest }) =>
        Promise.resolve({ id: request.sources[0] }),
    );

    const first = jobApi.startCreate(CREATE_REQUEST);
    const second = jobApi.startCreate({
      ...CREATE_REQUEST,
      sources: ["/tmp/other.txt"],
    });

    expect(bridge.invoke).toHaveBeenCalledTimes(2);
    await expect(first).resolves.toEqual({ id: "/tmp/source.txt" });
    await expect(second).resolves.toEqual({ id: "/tmp/other.txt" });
  });

  it("[UI-JOB-SINGLE-FLIGHT-SECRET-IDENTITY] distinguishes passwords without placing plaintext in the request key", async () => {
    bridge.invoke.mockResolvedValue({ id: "job-1" });

    const first = jobApi.startVerify({
      archivePath: "/tmp/source.pna",
      password: "first-secret",
      mode: "complete",
    });
    const second = jobApi.startVerify({
      archivePath: "/tmp/source.pna",
      password: "second-secret",
      mode: "complete",
    });

    expect(bridge.invoke).toHaveBeenCalledTimes(2);
    await Promise.all([first, second]);
  });

  it.each([
    [
      "UI-JOB-SINGLE-FLIGHT-EXTRACT",
      () =>
        jobApi.startExtract({
          archivePath: "/tmp/source.pna",
          destination: "/tmp/restored",
          entries: [],
          password: null,
          conflict: "rename",
          restorePermissions: true,
          keepCompletedOnCancel: true,
        }),
    ],
    [
      "UI-JOB-SINGLE-FLIGHT-APPEND",
      () =>
        jobApi.startAppend({
          archivePath: "/tmp/source.pna",
          sources: ["/tmp/new.txt"],
          options: CREATE_REQUEST.options,
        }),
    ],
    [
      "UI-JOB-SINGLE-FLIGHT-DELETE",
      () =>
        jobApi.startDelete({
          archivePath: "/tmp/source.pna",
          entries: ["old.txt"],
          password: null,
        }),
    ],
    [
      "UI-JOB-SINGLE-FLIGHT-RENAME",
      () =>
        jobApi.startRename({
          archivePath: "/tmp/source.pna",
          sourcePath: "old.txt",
          destinationPath: "new.txt",
          password: null,
        }),
    ],
    [
      "UI-JOB-SINGLE-FLIGHT-SPLIT",
      () =>
        jobApi.startSplit({
          archivePath: "/tmp/source.pna",
          outputDirectory: "/tmp/parts",
          maxPartBytes: 1024,
        }),
    ],
    [
      "UI-JOB-SINGLE-FLIGHT-CONCAT",
      () =>
        jobApi.startConcat({
          parts: ["/tmp/source.part1.pna"],
          outputPath: "/tmp/joined.pna",
        }),
    ],
    [
      "UI-JOB-SINGLE-FLIGHT-SORT",
      () =>
        jobApi.startSort({
          archivePath: "/tmp/source.pna",
          outputPath: "/tmp/sorted.pna",
          password: null,
          descending: false,
        }),
    ],
    [
      "UI-JOB-SINGLE-FLIGHT-STRIP",
      () =>
        jobApi.startStrip({
          archivePath: "/tmp/source.pna",
          outputPath: "/tmp/stripped.pna",
          password: null,
          keepTimestamps: false,
          keepPermissions: false,
          keepXattrs: false,
          keepPrivateChunks: false,
        }),
    ],
    [
      "UI-JOB-SINGLE-FLIGHT-MIGRATE",
      () =>
        jobApi.startMigrate({
          archivePath: "/tmp/source.pna",
          outputPath: "/tmp/migrated.pna",
          password: null,
        }),
    ],
    [
      "UI-JOB-SINGLE-FLIGHT-VERIFY",
      () =>
        jobApi.startVerify({
          archivePath: "/tmp/source.pna",
          password: null,
          mode: "complete",
        }),
    ],
    [
      "UI-JOB-SINGLE-FLIGHT-COMPARE",
      () =>
        jobApi.startCompare({
          left: {
            kind: "archive",
            path: "/tmp/left.pna",
            password: null,
          },
          right: {
            kind: "folder",
            path: "/tmp/right",
            password: null,
          },
        }),
    ],
    ["UI-JOB-SINGLE-FLIGHT-CANCEL", () => jobApi.cancel("job-1")],
    ["UI-JOB-SINGLE-FLIGHT-RETRY", () => jobApi.retry("job-1")],
    ["UI-JOB-SINGLE-FLIGHT-DISMISS", () => jobApi.dismiss("job-1")],
    ["UI-JOB-SINGLE-FLIGHT-REVEAL", () => jobApi.revealOutput("job-1")],
  ] as const)(
    "[%s] coalesces a repeated lifecycle action",
    async (_, start) => {
      let resolve!: (value: { id: string }) => void;
      bridge.invoke.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );

      const first = start();
      const second = start();

      expect(bridge.invoke).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
      resolve({ id: "job-1" });
      await first;
    },
  );
});
