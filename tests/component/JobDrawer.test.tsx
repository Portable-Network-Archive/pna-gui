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
    expect(await screen.findByText("disk full")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Retry job" }));
    expect(bridge.invoke).toHaveBeenCalledWith("job_retry", { jobId: "job-1" });
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
      within(bar).getByRole("button", { name: "Show in Folder" }),
    );
    expect(bridge.invoke).toHaveBeenCalledWith("job_reveal_output", {
      jobId: "job-1",
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Open Created Archive" }),
    );
    expect(onOpenArchive).toHaveBeenCalledWith("/output/archive.pna");
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
      await screen.findByRole("button", { name: "Show in Folder" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could Not Complete the Job Action",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("folder unavailable");
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
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "already completed",
    );
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
    expect(alert).toHaveTextContent("database unavailable");
  });

  it("[UI-P2-JOB-LISTEN-ERROR] exposes event subscription failure", async () => {
    bridge.listenError = new Error("event channel unavailable");

    render(
      <I18nProvider>
        <JobDrawer />
      </I18nProvider>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("event channel unavailable");
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
            warnings: ["Previous archive remains at /output/.archive.backup-1"],
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
        "Previous archive remains at /output/.archive.backup-1",
      ),
    ).toBeVisible();
  });
});
