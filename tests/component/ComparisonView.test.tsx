import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  jobHandler: undefined as
    | ((event: {
        payload: import("../../src/features/jobs/api").JobSnapshot;
      }) => void)
    | undefined,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: bridge.open }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: async (
      event: string,
      handler: (event: {
        payload: import("../../src/features/jobs/api").JobSnapshot;
      }) => void,
    ) => {
      if (event === "job-update") bridge.jobHandler = handler;
      return () => undefined;
    },
  }),
}));

import ComparisonView from "../../src/features/comparison/ComparisonView";
import { I18nProvider } from "../../src/features/i18n";

describe("comparison view", () => {
  beforeEach(() => {
    bridge.invoke.mockReset();
    bridge.open.mockReset();
    bridge.jobHandler = undefined;
  });

  it("[UI-COMPARE-EXPLICIT-A-B] starts an explicit archive-to-folder comparison without inferring a previous version", async () => {
    bridge.open
      .mockResolvedValueOnce("/data/current")
      .mockResolvedValueOnce(null);
    bridge.invoke.mockResolvedValue({ id: "job-12" });

    render(
      <I18nProvider>
        <ComparisonView
          initialLeft={{
            kind: "archive",
            path: "/data/baseline.pna",
            password: null,
          }}
          onBack={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("A — Baseline")).toBeVisible();
    expect(screen.getByText("/data/baseline.pna")).toBeVisible();
    fireEvent.click(screen.getByLabelText("Folder"));
    fireEvent.click(screen.getByRole("button", { name: "Choose B" }));
    await screen.findByText("/data/current");
    fireEvent.click(screen.getByRole("button", { name: "Compare A and B" }));

    await waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith("job_start_compare", {
        request: {
          left: {
            kind: "archive",
            path: "/data/baseline.pna",
            password: null,
          },
          right: {
            kind: "folder",
            path: "/data/current",
            password: null,
          },
        },
      }),
    );
    expect(screen.getByText("Comparison started")).toBeVisible();
    expect(screen.queryByText(/previous/i)).not.toBeInTheDocument();
  });

  it("[UI-COMPARE-INLINE-COMPLETION] replaces the started notice with an explicit result action", async () => {
    // UI-COMPARE-PASSWORD-OPTIONAL-COPY
    const result = {
      left: {
        kind: "archive" as const,
        path: "/data/a.pna",
        size: 10,
        modifiedAt: 1,
        sha256: "left",
      },
      right: {
        kind: "archive" as const,
        path: "/data/b.pna",
        size: 10,
        modifiedAt: 1,
        sha256: "right",
      },
      completedAt: 2,
      summary: {
        total: 1,
        same: 1,
        added: 0,
        removed: 0,
        contentChanged: 0,
        metadataChanged: 0,
        comparisonUnavailable: 0,
      },
    };
    bridge.open.mockResolvedValue("/data/b.pna");
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "job_list") return [];
      return {
        id: "job-12",
        kind: "compare",
        status: "queued",
        phase: "preparing",
        completedUnits: 0,
      };
    });
    const onViewResult = vi.fn();
    render(
      <I18nProvider>
        <ComparisonView
          initialLeft={{
            kind: "archive",
            path: "/data/a.pna",
            password: null,
          }}
          onBack={vi.fn()}
          onViewResult={onViewResult}
        />
      </I18nProvider>,
    );
    expect(
      screen.getByText("Optional — only needed for encrypted archives."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Choose B" }));
    await screen.findByText("/data/b.pna");
    fireEvent.click(screen.getByRole("button", { name: "Compare A and B" }));
    await screen.findByText("Comparison started");
    await waitFor(() => expect(bridge.jobHandler).toBeDefined());

    act(() =>
      bridge.jobHandler?.({
        payload: {
          id: "job-12",
          kind: "compare",
          status: "succeeded",
          phase: "completed",
          completedUnits: 1,
          totalUnits: 1,
          comparisonReport: result,
        },
      }),
    );

    expect(await screen.findByText("Comparison complete")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "View comparison results" }),
    );
    expect(onViewResult).toHaveBeenCalledWith("job-12", result);
  });

  it("[UI-COMPARE-RESULT-FILTER-DETAIL] shows full paths, factual filters, and side-by-side values", async () => {
    // UI-COMPARE-SEARCH-CLEAR
    bridge.invoke.mockResolvedValue({
      items: [
        {
          path: "docs/guide.txt",
          kind: "content_changed",
          left: {
            kind: "file",
            size: 10,
            modifiedAt: 100,
            permission: "0644",
            compression: "ZStandard",
            encryption: "No",
            contentSha256: "left-hash",
          },
          right: {
            kind: "file",
            size: 12,
            modifiedAt: 200,
            permission: "0644",
            compression: "ZStandard",
            encryption: "No",
            contentSha256: "right-hash",
          },
          metadataDifferences: [
            { field: "permission", left: "0644", right: "0600" },
          ],
          detail: null,
        },
      ],
      nextCursor: null,
      totalCount: 1,
    });

    render(
      <I18nProvider>
        <ComparisonView
          jobId="job-12"
          result={{
            left: {
              kind: "archive",
              path: "/data/a.pna",
              size: 100,
              modifiedAt: 1,
              sha256: "a-source-hash",
            },
            right: {
              kind: "archive",
              path: "/data/b.pna",
              size: 120,
              modifiedAt: 2,
              sha256: "b-source-hash",
            },
            completedAt: 3,
            summary: {
              total: 1,
              same: 0,
              added: 0,
              removed: 0,
              contentChanged: 1,
              metadataChanged: 0,
              comparisonUnavailable: 0,
            },
          }}
          onBack={vi.fn()}
        />
      </I18nProvider>,
    );

    const row = await screen.findByRole("row", { name: /docs\/guide\.txt/i });
    expect(within(row).getByText("Content changed")).toBeVisible();
    fireEvent.click(row);
    const inspector = screen.getByRole("complementary", {
      name: "Difference details",
    });
    expect(within(inspector).getByText("/data/a.pna")).toBeVisible();
    expect(within(inspector).getByText("/data/b.pna")).toBeVisible();
    expect(within(inspector).getByText("left-hash")).toBeVisible();
    expect(within(inspector).getByText("right-hash")).toBeVisible();
    const metadata = within(inspector)
      .getByRole("heading", { name: "Metadata differences" })
      .closest("section")!;
    expect(within(metadata).getByText("0644")).toBeVisible();
    expect(within(metadata).getByText("0600")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Content changed 1" }),
    ).toBeVisible();

    fireEvent.change(screen.getByLabelText("Search paths"), {
      target: { value: "guide" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search comparison" }));
    await waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith("comparison_page", {
        request: expect.objectContaining({ query: "guide" }),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByLabelText("Search paths")).toHaveValue("");
    await waitFor(() =>
      expect(bridge.invoke).toHaveBeenLastCalledWith("comparison_page", {
        request: expect.objectContaining({ query: "" }),
      }),
    );
  });

  it("[UI-COMPARE-PAGE-RACE] ignores a stale page response after the result filter changes", async () => {
    let resolveInitial!: (value: unknown) => void;
    let resolveFiltered!: (value: unknown) => void;
    bridge.invoke
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveInitial = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFiltered = resolve;
        }),
      );

    render(
      <I18nProvider>
        <ComparisonView
          jobId="job-race"
          result={{
            left: {
              kind: "archive",
              path: "/data/a.pna",
              size: 100,
              modifiedAt: 1,
              sha256: "a-source-hash",
            },
            right: {
              kind: "archive",
              path: "/data/b.pna",
              size: 120,
              modifiedAt: 2,
              sha256: "b-source-hash",
            },
            completedAt: 3,
            summary: {
              total: 2,
              same: 1,
              added: 0,
              removed: 0,
              contentChanged: 1,
              metadataChanged: 0,
              comparisonUnavailable: 0,
            },
          }}
          onBack={vi.fn()}
        />
      </I18nProvider>,
    );

    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Content changed 1" }));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolveFiltered({
        items: [
          {
            path: "current.txt",
            kind: "content_changed",
            left: null,
            right: null,
            metadataDifferences: [],
            detail: null,
          },
        ],
        nextCursor: null,
        totalCount: 1,
      });
    });
    expect(await screen.findByText("current.txt")).toBeVisible();

    await act(async () => {
      resolveInitial({
        items: [
          {
            path: "stale.txt",
            kind: "same",
            left: null,
            right: null,
            metadataDifferences: [],
            detail: null,
          },
        ],
        nextCursor: null,
        totalCount: 1,
      });
    });
    expect(screen.getByText("current.txt")).toBeVisible();
    expect(screen.queryByText("stale.txt")).not.toBeInTheDocument();
  });

  it("[UI-COMPARE-ENCRYPTED-PASSWORDS] sends explicit per-source passwords only with the comparison request", async () => {
    bridge.open.mockResolvedValue("/data/encrypted-b.pna");
    bridge.invoke.mockResolvedValue({ id: "job-encrypted" });

    render(
      <I18nProvider>
        <ComparisonView
          initialLeft={{
            kind: "archive",
            path: "/data/encrypted-a.pna",
            password: null,
          }}
          onBack={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.change(screen.getByLabelText("A — Baseline Password"), {
      target: { value: "left-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Choose B" }));
    await screen.findByText("/data/encrypted-b.pna");
    fireEvent.change(screen.getByLabelText("B — Comparison Password"), {
      target: { value: "right-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Compare A and B" }));

    await waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith("job_start_compare", {
        request: {
          left: {
            kind: "archive",
            path: "/data/encrypted-a.pna",
            password: "left-secret",
          },
          right: {
            kind: "archive",
            path: "/data/encrypted-b.pna",
            password: "right-secret",
          },
        },
      }),
    );
  });

  it("[UI-COMPARE-PICKER-ERROR-RECOVERY] keeps picker failure evidence adjacent and clears it after retry", async () => {
    bridge.open
      .mockRejectedValueOnce(new Error("native picker unavailable"))
      .mockResolvedValueOnce("/data/recovered.pna");

    render(
      <I18nProvider>
        <ComparisonView
          initialLeft={{
            kind: "archive",
            path: "/data/a.pna",
            password: null,
          }}
          onBack={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose B" }));
    expect(
      await screen.findByText("The source could not be selected."),
    ).toBeVisible();
    expect(screen.getByText("native picker unavailable")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Choose B" }));
    expect(await screen.findByText("/data/recovered.pna")).toBeVisible();
    expect(
      screen.queryByText("The source could not be selected."),
    ).not.toBeInTheDocument();
  });

  it("[UI-COMPARE-PICKER-SINGLE-FLIGHT] opens only one native picker during repeated activation", async () => {
    let resolvePicker!: (value: string | null) => void;
    bridge.open.mockReturnValue(
      new Promise((resolve) => {
        resolvePicker = resolve;
      }),
    );

    render(
      <I18nProvider>
        <ComparisonView
          initialLeft={{
            kind: "archive",
            path: "/data/a.pna",
            password: null,
          }}
          onBack={vi.fn()}
        />
      </I18nProvider>,
    );

    const chooseB = screen.getByRole("button", { name: "Choose B" });
    fireEvent.click(chooseB);
    fireEvent.click(chooseB);
    expect(bridge.open).toHaveBeenCalledTimes(1);
    resolvePicker("/data/b.pna");
    expect(await screen.findByText("/data/b.pna")).toBeVisible();
  });

  it("[UI-COMPARE-SAME-SOURCE] prevents comparing a source with itself", async () => {
    bridge.open.mockResolvedValue("/data/a.pna");

    render(
      <I18nProvider>
        <ComparisonView
          initialLeft={{
            kind: "archive",
            path: "/data/a.pna",
            password: null,
          }}
          onBack={vi.fn()}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose B" }));
    await screen.findAllByText("/data/a.pna");

    expect(screen.getByText("Choose two different sources.")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Compare A and B" }),
    ).toBeDisabled();
  });

  it("[UI-COMPARE-SOURCE-KIND-RESET] clears an incompatible B path when its source type changes", async () => {
    bridge.open.mockResolvedValue("/data/b.pna");

    render(
      <I18nProvider>
        <ComparisonView
          initialLeft={{
            kind: "archive",
            path: "/data/a.pna",
            password: null,
          }}
          onBack={vi.fn()}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose B" }));
    expect(await screen.findByText("/data/b.pna")).toBeVisible();
    fireEvent.click(screen.getByLabelText("Folder"));

    expect(screen.queryByText("/data/b.pna")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Compare A and B" }),
    ).toBeDisabled();
  });
});
