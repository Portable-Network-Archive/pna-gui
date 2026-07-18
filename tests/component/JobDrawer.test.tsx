import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../src/features/i18n";
import JobDrawer from "../../src/features/jobs/JobDrawer";
import type { JobSnapshot } from "../../src/features/jobs/api";

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  jobHandler: undefined as
    | ((event: { payload: JobSnapshot }) => void)
    | undefined,
  listenError: undefined as Error | undefined,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: async (
      event: string,
      handler: (event: { payload: JobSnapshot }) => void,
    ) => {
      if (bridge.listenError) throw bridge.listenError;
      if (event === "job-update") bridge.jobHandler = handler;
      return () => undefined;
    },
  }),
}));

const running: JobSnapshot = {
  id: "job-1",
  kind: "create",
  status: "running",
  phase: "writing",
  currentItem: "docs/readme.txt",
  completedUnits: 1,
  totalUnits: 4,
};

const completed: JobSnapshot = {
  ...running,
  status: "succeeded",
  phase: "completed",
  currentItem: "source/input.txt",
  completedUnits: 4,
  outputPath: "/output/archive.pna",
};

describe("background job drawer", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      value: ["en-US"],
    });
    bridge.jobHandler = undefined;
    bridge.listenError = undefined;
    bridge.invoke.mockReset().mockImplementation(async (command: string) => {
      if (command === "job_list") return [running];
      return running;
    });
  });

  it("[UI-P2-JOB-DRAWER] reports live progress and cancels a running job", async () => {
    render(
      <I18nProvider>
        <JobDrawer />
      </I18nProvider>,
    );

    const drawer = await screen.findByRole("region", {
      name: "Background jobs",
    });
    expect(
      within(drawer).getByRole("progressbar", {
        name: "In Progress: 1 of 4",
      }),
    ).toBeVisible();
    await userEvent.click(
      within(drawer).getByRole("button", { name: "Cancel job" }),
    );
    expect(bridge.invoke).toHaveBeenCalledWith("job_cancel", {
      jobId: "job-1",
    });

    act(() =>
      bridge.jobHandler?.({
        payload: { ...running, status: "failed", error: "disk full" },
      }),
    );
    expect(
      await screen.findByText("The operation could not be completed."),
    ).toBeVisible();
    expect(screen.getByText("disk full")).not.toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Retry job" }));
    expect(bridge.invoke).toHaveBeenCalledWith("job_retry", { jobId: "job-1" });
  });

  it("[UI-JOB-TERMINAL-ANNOUNCEMENT] announces a completed job from an always-mounted status region", async () => {
    render(
      <I18nProvider>
        <JobDrawer />
      </I18nProvider>,
    );
    await screen.findByRole("region", { name: "Background jobs" });
    const announcer = screen.getByTestId("job-announcer");
    expect(announcer).toHaveTextContent("");

    act(() => bridge.jobHandler?.({ payload: completed }));

    expect(announcer).toHaveTextContent("Archive creation: Completed");
  });

  it("[UI-REPORT-PERSISTENCE-FAILURE] explains that a completed result will not survive restart", async () => {
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "job_list") {
        return [
          {
            ...completed,
            errorCode: "VERIFICATION_REPORT_NOT_PERSISTED",
          },
        ];
      }
      return completed;
    });
    render(
      <I18nProvider>
        <JobDrawer />
      </I18nProvider>,
    );

    expect(
      await screen.findByText(
        "The verification completed, but this result will not be available after the app restarts. Save a report before closing the app.",
      ),
    ).toBeVisible();
  });

  it("[UI-JOB-RESTART-RECONCILED] explains a restored interruption without offering an impossible retry", async () => {
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "job_list") {
        return [
          {
            ...running,
            status: "interrupted",
            errorCode: "APP_RESTARTED",
            error: "the application closed before the job completed",
            retryable: false,
          },
        ];
      }
      return running;
    });
    render(
      <I18nProvider>
        <JobDrawer />
      </I18nProvider>,
    );

    expect(
      await screen.findByText(
        "The app closed before this job finished. Start the operation again from its original screen if it is still needed.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Retry job" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("the application closed before the job completed"),
    ).not.toBeVisible();
  });

  it("[UI-P2-JOB-CENTER] expands the durable job list and filters failures", async () => {
    render(
      <I18nProvider>
        <JobDrawer />
      </I18nProvider>,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Job center" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Job center" });
    expect(dialog).toBeVisible();
    expect(
      within(dialog).getByText(
        "Review progress, saved results, and available actions.",
      ),
    ).toBeVisible();
    expect(within(dialog).getByText("docs/readme.txt")).toBeVisible();
  });

  it("[UI-UX-JOB-DISMISS] lets the user close a completed job result", async () => {
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "job_list") return [completed];
      if (command === "job_dismiss") return [];
      return completed;
    });

    render(
      <I18nProvider>
        <JobDrawer />
      </I18nProvider>,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Dismiss completed job" }),
    );
    expect(bridge.invoke).toHaveBeenCalledWith("job_dismiss", {
      jobId: "job-1",
    });
    expect(
      screen.queryByRole("region", { name: "Background jobs" }),
    ).not.toBeInTheDocument();
  });

  it("[UI-UX-JOB-RESULT-ACTIONS] opens a created archive or reveals its folder", async () => {
    // UI-UX-JOB-RESULT-IDENTITY
    const onOpenArchive = vi.fn();
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "job_list") return [completed];
      return completed;
    });

    render(
      <I18nProvider>
        <JobDrawer onOpenArchive={onOpenArchive} />
      </I18nProvider>,
    );

    const bar = await screen.findByRole("region", { name: "Background jobs" });
    expect(within(bar).getByText("archive.pna")).toBeVisible();
    expect(within(bar).getByText("/output")).toBeVisible();
    expect(within(bar).queryByText("source/input.txt")).not.toBeInTheDocument();

    await userEvent.click(
      within(bar).getByRole("button", { name: "Open containing folder" }),
    );
    expect(bridge.invoke).toHaveBeenCalledWith("job_reveal_output", {
      jobId: "job-1",
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Open Created Archive" }),
    );
    expect(onOpenArchive).toHaveBeenCalledWith("/output/archive.pna");
  });

  it("[UI-VOLUME-SPLIT-RESULT-ACTION] reveals split parts without opening an incomplete part", async () => {
    const splitResult: JobSnapshot = {
      ...completed,
      kind: "split",
      outputPath: "/output/archive.part1.pna",
    };
    const onOpenArchive = vi.fn();
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "job_list") return [splitResult];
      return splitResult;
    });

    render(
      <I18nProvider>
        <JobDrawer onOpenArchive={onOpenArchive} />
      </I18nProvider>,
    );

    const bar = await screen.findByRole("region", { name: "Background jobs" });
    expect(
      within(bar).getByRole("button", { name: "Open containing folder" }),
    ).toBeVisible();
    expect(
      within(bar).queryByRole("button", { name: "Open Output Archive" }),
    ).not.toBeInTheDocument();
    expect(onOpenArchive).not.toHaveBeenCalled();
  });

  it("[UI-VERIFY-JOB-RESULT] keeps completed verification evidence available from the job drawer", async () => {
    const verification = {
      ...completed,
      kind: "verify" as const,
      outputPath: null,
      verificationReport: {
        archivePath: "/output/archive.pna",
        sourceSize: 4096,
        sourceModifiedAt: 1784160000,
        sourceSha256:
          "f1a5a48b3b1f91208b982163be46f3a865f157989a4a195c6806144c4f8f23ac",
        completedAt: 1784160300,
        mode: "quick" as const,
        conclusion: "passed" as const,
        encrypted: false,
        solid: false,
        entriesChecked: 4,
        filesChecked: 0,
        bytesChecked: 0,
        failedChecks: 0,
        notCheckedChecks: 1,
        checksOmitted: 0,
        checks: [],
      },
    } satisfies JobSnapshot;
    const onViewVerification = vi.fn();
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "job_list") return [verification];
      return verification;
    });

    render(
      <I18nProvider>
        <JobDrawer onViewVerification={onViewVerification} />
      </I18nProvider>,
    );

    const bar = await screen.findByRole("region", { name: "Background jobs" });
    expect(within(bar).getByText("Archive verification")).toBeVisible();
    expect(
      within(bar).getByText("Structure verified; file contents not checked"),
    ).toBeVisible();
    expect(within(bar).queryByText("source/input.txt")).not.toBeInTheDocument();
    await userEvent.click(
      within(bar).getByRole("button", { name: "View results" }),
    );
    expect(onViewVerification).toHaveBeenCalledWith(
      verification.id,
      verification.verificationReport,
    );
  });

  it("[UI-VERIFY-RESULT-DISMISS-WARNING] does not delete an unexported verification result without explicit confirmation", async () => {
    const verification = {
      ...completed,
      kind: "verify" as const,
      outputPath: null,
      verificationReport: {
        archivePath: "/output/archive.pna",
        sourceSize: 4096,
        sourceModifiedAt: 1784160000,
        sourceSha256:
          "f1a5a48b3b1f91208b982163be46f3a865f157989a4a195c6806144c4f8f23ac",
        completedAt: 1784160300,
        mode: "quick" as const,
        conclusion: "passed" as const,
        encrypted: false,
        solid: false,
        entriesChecked: 4,
        filesChecked: 0,
        bytesChecked: 0,
        failedChecks: 0,
        notCheckedChecks: 1,
        checksOmitted: 0,
        checks: [],
      },
    } satisfies JobSnapshot;
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "job_list") return [verification];
      return verification;
    });
    render(
      <I18nProvider>
        <JobDrawer />
      </I18nProvider>,
    );

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Delete saved verification result",
      }),
    );
    expect(
      screen.getByRole("alertdialog", {
        name: "Delete verification result?",
      }),
    ).toHaveTextContent(
      "Delete this verification result? It will no longer be available to view or export.",
    );
    expect(bridge.invoke).not.toHaveBeenCalledWith("job_dismiss", {
      jobId: verification.id,
    });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("alertdialog", {
        name: "Delete verification result?",
      }),
    ).not.toBeInTheDocument();
  });

  it("[UI-JOB-DIAGNOSTIC-DISMISS-WARNING] confirms before removing failure and retry evidence", async () => {
    const failed = {
      ...completed,
      status: "failed" as const,
      errorCode: "OPERATION_FAILED",
      error: "low-level failure",
      retryable: true,
    };
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "job_list") return [failed];
      return [];
    });
    render(
      <I18nProvider>
        <JobDrawer />
      </I18nProvider>,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Dismiss completed job" }),
    );
    expect(
      screen.getByRole("alertdialog", { name: "Remove job history?" }),
    ).toHaveTextContent(
      "This removes saved results, error details, and retry entries from the Job Center. It does not delete output files.",
    );
    expect(bridge.invoke).not.toHaveBeenCalledWith("job_dismiss", {
      jobId: failed.id,
    });
  });

  it("[UI-VERIFY-JOB-ISSUES] signals a verification that found issues instead of a generic success", async () => {
    const verification = {
      ...completed,
      kind: "verify" as const,
      outputPath: null,
      verificationReport: {
        archivePath: "/output/archive.pna",
        sourceSize: 4096,
        sourceModifiedAt: 1784160000,
        sourceSha256:
          "f1a5a48b3b1f91208b982163be46f3a865f157989a4a195c6806144c4f8f23ac",
        completedAt: 1784160300,
        mode: "complete" as const,
        conclusion: "issues_found" as const,
        encrypted: false,
        solid: false,
        entriesChecked: 4,
        filesChecked: 3,
        bytesChecked: 2048,
        failedChecks: 1,
        notCheckedChecks: 0,
        checksOmitted: 0,
        checks: [],
      },
    } satisfies JobSnapshot;
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "job_list") return [verification];
      return verification;
    });

    render(
      <I18nProvider>
        <JobDrawer />
      </I18nProvider>,
    );

    const bar = await screen.findByRole("region", { name: "Background jobs" });
    expect(within(bar).getByText("Some checks failed")).toBeVisible();
    expect(within(bar).queryByText("Completed")).not.toBeInTheDocument();
    expect(
      within(bar).getByText("Archive verification").closest("article"),
    ).toHaveAttribute("data-verification", "issues_found");
  });

  it("[UI-UX-JOB-RECOVERABLE-CONFLICT] localizes an output collision and keeps its file discoverable", async () => {
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      value: ["ja-JP"],
    });
    const failedSplit: JobSnapshot = {
      ...completed,
      kind: "split",
      status: "failed",
      phase: "failed",
      outputPath: "/output/archive.part1.pna",
      error: "backend wording intentionally changed",
      errorCode: "OUTPUT_ALREADY_EXISTS",
    };
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "job_list") return [failedSplit];
      return failedSplit;
    });

    render(
      <I18nProvider>
        <JobDrawer />
      </I18nProvider>,
    );

    const bar = await screen.findByRole("region", {
      name: "バックグラウンドジョブ",
    });
    expect(
      within(bar).getByText("出力ファイルは既に存在します。"),
    ).toBeVisible();
    expect(
      within(bar).getByText(
        "既存ファイルを移動または名前変更するか、別の出力先を選んでから再試行してください。",
      ),
    ).toBeVisible();
    expect(
      within(bar).queryByText(/backend wording intentionally changed/),
    ).not.toBeVisible();
    expect(
      within(bar).getByRole("button", { name: "保存先フォルダーを開く" }),
    ).toBeVisible();
  });

  it("[UI-UX-JOB-OPEN-TRANSITION] closes the job center after opening its result", async () => {
    // The destination view or password prompt must not remain hidden by the job center.
    const onOpenArchive = vi.fn().mockResolvedValue(undefined);
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "job_list") return [completed];
      return completed;
    });

    render(
      <I18nProvider>
        <JobDrawer onOpenArchive={onOpenArchive} />
      </I18nProvider>,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Job center" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Job center" });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Open Created Archive" }),
    );

    expect(onOpenArchive).toHaveBeenCalledWith("/output/archive.pna");
    expect(
      screen.queryByRole("dialog", { name: "Job center" }),
    ).not.toBeInTheDocument();
  });

  it("[UI-UX-JOB-ORDER] keeps the newest numeric job visible after job 9", async () => {
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "job_list") {
        return [
          { ...completed, id: "job-9", outputPath: "/output/nine.pna" },
          { ...completed, id: "job-10", outputPath: "/output/ten.pna" },
        ];
      }
      return completed;
    });

    render(
      <I18nProvider>
        <JobDrawer />
      </I18nProvider>,
    );

    const bar = await screen.findByRole("region", { name: "Background jobs" });
    expect(within(bar).getByText("ten.pna")).toBeVisible();
  });

  it("[UI-UX-JOB-LATEST-RESULT] surfaces a newer completion above an older cancelling job", async () => {
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "job_list") {
        return [
          {
            ...running,
            id: "job-1",
            status: "cancel_requested",
          },
          {
            ...completed,
            id: "job-2",
            outputPath: "/output/new-result.pna",
          },
        ];
      }
      return completed;
    });

    render(
      <I18nProvider>
        <JobDrawer />
      </I18nProvider>,
    );

    const bar = await screen.findByRole("region", { name: "Background jobs" });
    expect(within(bar).getByText("new-result.pna")).toBeVisible();
    expect(within(bar).getByText("1 active · 1 finished")).toBeVisible();
  });

  it("[UI-UX-JOB-CANCEL-WAIT] explains why cancellation can take time", async () => {
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "job_list") {
        return [{ ...running, status: "cancel_requested" }];
      }
      return running;
    });

    render(
      <I18nProvider>
        <JobDrawer />
      </I18nProvider>,
    );

    expect(
      await screen.findByText(
        "Finishing the current safe step before stopping. You can continue using the app.",
      ),
    ).toBeVisible();
  });

  it("[UI-UX-JOB-LONG-PATH] keeps the result filename and parent location independently readable", async () => {
    const longResult = {
      ...completed,
      outputPath:
        "/Users/example/Documents/Very Long Project Name/Exports/顧客データ-2026.pna",
    };
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "job_list") return [longResult];
      return longResult;
    });

    render(
      <I18nProvider>
        <JobDrawer />
      </I18nProvider>,
    );

    const bar = await screen.findByRole("region", { name: "Background jobs" });
    expect(within(bar).getByText("顧客データ-2026.pna")).toBeVisible();
    expect(
      within(bar).getByText(
        "/Users/example/Documents/Very Long Project Name/Exports",
      ),
    ).toBeVisible();
    expect(
      within(bar).getByLabelText(
        "/Users/example/Documents/Very Long Project Name/Exports/顧客データ-2026.pna",
      ),
    ).toBeVisible();
  });

  it("[UI-UX-CREATE-RESULT-LIVE-RECENT] announces a newly created archive so Home can refresh immediately", async () => {
    const onCreatedArchive = vi.fn();
    render(
      <I18nProvider>
        <JobDrawer onCreatedArchive={onCreatedArchive} />
      </I18nProvider>,
    );
    await screen.findByRole("region", { name: "Background jobs" });

    act(() => bridge.jobHandler?.({ payload: completed }));

    expect(onCreatedArchive).toHaveBeenCalledTimes(1);
  });

  it("[UI-UX-JOB-ACTION-ERROR] reports a failed result action next to the job", async () => {
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "job_list") return [completed];
      if (command === "job_reveal_output")
        throw new Error("folder unavailable");
      return completed;
    });

    render(
      <I18nProvider>
        <JobDrawer />
      </I18nProvider>,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Open containing folder" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could Not Complete the Job Action",
    );
    expect(screen.getByText("folder unavailable")).not.toBeVisible();
  });

  it("[UI-UX-JOB-CANCEL-ERROR] reports failed lifecycle actions instead of rejecting silently", async () => {
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "job_list") return [running];
      if (command === "job_cancel") throw new Error("already completed");
      return running;
    });

    render(
      <I18nProvider>
        <JobDrawer />
      </I18nProvider>,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Cancel job" }),
    );
    await screen.findByRole("alert");
    expect(screen.getByText("already completed")).not.toBeVisible();
  });

  it("[UI-P2-JOB-LIST-ERROR] exposes an initial synchronization failure", async () => {
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "job_list") throw new Error("database unavailable");
      return running;
    });

    render(
      <I18nProvider>
        <JobDrawer />
      </I18nProvider>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could Not Synchronize Background Jobs");
    expect(screen.getByText("database unavailable")).not.toBeVisible();
  });

  it("[UI-P2-JOB-LISTEN-ERROR] exposes event subscription failure", async () => {
    bridge.listenError = new Error("event channel unavailable");

    render(
      <I18nProvider>
        <JobDrawer />
      </I18nProvider>,
    );

    await screen.findByRole("alert");
    expect(screen.getByText("event channel unavailable")).not.toBeVisible();
  });

  it("[UI-P2-JOB-REFRESH-ON-OPEN] reconciles jobs whenever the center opens", async () => {
    render(
      <I18nProvider>
        <JobDrawer />
      </I18nProvider>,
    );
    await screen.findByRole("region", { name: "Background jobs" });

    await userEvent.click(screen.getByRole("button", { name: "Job center" }));

    expect(
      bridge.invoke.mock.calls.filter(([command]) => command === "job_list"),
    ).toHaveLength(2);
  });

  it("[UI-P2-JOB-WARNING] keeps a nonfatal cleanup problem visible on success", async () => {
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "job_list") {
        return [
          {
            ...completed,
            warnings: [
              {
                code: "PREVIOUS_ARCHIVE_NOT_REMOVED",
                technicalDetail:
                  "Previous archive remains after cleanup failed",
                recoveryPath: "/output/.archive.backup-1",
              },
            ],
          },
        ];
      }
      return completed;
    });

    render(
      <I18nProvider>
        <JobDrawer />
      </I18nProvider>,
    );

    expect(
      await screen.findByText(
        "The new archive was saved, but the previous archive backup could not be removed.",
      ),
    ).toBeVisible();
    expect(screen.getByText("/output/.archive.backup-1")).toBeVisible();
    expect(
      screen.getByText("Previous archive remains after cleanup failed"),
    ).not.toBeVisible();
  });
});
