import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DragDropEvent } from "@tauri-apps/api/webviewWindow";
import { Theme } from "@radix-ui/themes";
import App from "../../src/App";
import type {
  ArchiveEntry,
  ArchiveRecent,
  ArchiveSummary,
  OpenArchiveResult,
} from "../../src/features/archive/types";
import type { JobSnapshot } from "../../src/features/jobs/api";

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  getMatches: vi.fn(),
  openDialog: vi.fn(),
  saveDialog: vi.fn(),
  dragHandler: undefined as ((event: DragDropEvent) => void) | undefined,
  dragHandlers: [] as Array<(event: DragDropEvent) => void>,
  menuHandler: undefined as
    | ((event: { payload: "extract" | "create" }) => void)
    | undefined,
  jobHandlers: [] as Array<(event: { payload: JobSnapshot }) => void>,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));
vi.mock("@tauri-apps/plugin-cli", () => ({ getMatches: bridge.getMatches }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: bridge.openDialog,
  save: bridge.saveDialog,
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    onDragDropEvent: async (handler: (event: DragDropEvent) => void) => {
      bridge.dragHandler = handler;
      bridge.dragHandlers.push(handler);
      return () => {
        bridge.dragHandlers = bridge.dragHandlers.filter(
          (registered) => registered !== handler,
        );
      };
    },
    listen: async <T,>(
      event: string,
      handler: (event: { payload: T }) => void,
    ) => {
      if (event === "switch_tab")
        bridge.menuHandler = handler as typeof bridge.menuHandler;
      if (event === "job-update") {
        const jobHandler = handler as (event: { payload: JobSnapshot }) => void;
        bridge.jobHandlers.push(jobHandler);
        return () => {
          bridge.jobHandlers = bridge.jobHandlers.filter(
            (registered) => registered !== jobHandler,
          );
        };
      }
      return () => undefined;
    },
  }),
}));

const recent: ArchiveRecent = {
  path: "/tmp/demo.pna",
  displayName: "demo.pna",
  entryCount: 2,
  storedBytes: 2048,
  lastOpenedAt: 1_700_000_000,
};

const summary: ArchiveSummary = {
  handle: "archive-1",
  path: recent.path,
  displayName: recent.displayName,
  entryCount: 2,
  originalBytes: 4096,
  storedBytes: 2048,
  compressionMethods: ["Zstandard"],
  encryptionMethods: ["None"],
  solid: false,
  fileModifiedAt: 1_700_000_000,
};

const directory: ArchiveEntry = {
  id: "entry-src",
  parentId: null,
  path: "src",
  name: "src",
  kind: "directory",
  originalBytes: null,
  storedBytes: null,
  compression: null,
  encryption: null,
  modifiedAt: null,
  hasChildren: true,
};

function setLanguages(...languages: string[]) {
  Object.defineProperty(navigator, "languages", {
    configurable: true,
    value: languages,
  });
  Object.defineProperty(navigator, "language", {
    configurable: true,
    value: languages[0] ?? "en-US",
  });
}

function installInvokeHandler(options?: {
  recentItems?: ArchiveRecent[];
  openError?: unknown;
  openResults?: Record<string, OpenArchiveResult>;
  searchItems?: ArchiveEntry[];
  bootstrapDelayMs?: number;
}) {
  bridge.invoke.mockImplementation(
    async (command: string, args?: Record<string, unknown>) => {
      switch (command) {
        case "app_bootstrap":
          if (options?.bootstrapDelayMs) {
            await new Promise((resolve) =>
              setTimeout(resolve, options.bootstrapDelayMs),
            );
          }
          return {
            productName: "Portable Network Archive",
            recent: options?.recentItems ?? [],
          };
        case "recent_remove":
          return [];
        case "archive_open":
          if (options?.openError) throw options.openError;
          if (
            typeof args?.path === "string" &&
            options?.openResults?.[args.path]
          )
            return options.openResults[args.path];
          return { handle: summary.handle, summary };
        case "archive_close":
          return undefined;
        case "archive_children":
          return {
            items: args?.parentEntryId ? [] : [directory],
            nextCursor: null,
            totalCount: args?.parentEntryId ? 0 : 1,
          };
        case "archive_search":
          return {
            items: options?.searchItems ?? [],
            nextCursor: null,
            totalCount: options?.searchItems?.length ?? 0,
          };
        case "archive_entry_details":
          return {
            entry: directory,
            createdAt: null,
            accessedAt: null,
            permission: null,
            owner: null,
            group: null,
            xattrCount: 0,
          };
        case "job_start_extract":
          return { id: "job-restore", kind: "extract", status: "queued" };
        case "job_start_append":
          return { id: "job-append", kind: "append", status: "queued" };
        case "job_start_delete_entries":
          return { id: "job-delete", kind: "delete", status: "queued" };
        case "job_start_rename_entry":
          return { id: "job-rename", kind: "rename", status: "queued" };
        case "job_start_split":
          return { id: "job-split", kind: "split", status: "queued" };
        case "job_start_concat":
          return { id: "job-concat", kind: "concat", status: "queued" };
        case "job_start_sort":
          return { id: "job-sort", kind: "sort", status: "queued" };
        case "job_start_strip_metadata":
          return { id: "job-strip", kind: "strip", status: "queued" };
        case "job_start_migrate":
          return { id: "job-migrate", kind: "migrate", status: "queued" };
        case "job_start_verify":
          return { id: "job-verify", kind: "verify", status: "queued" };
        case "job_list":
          return [];
        default:
          throw new Error(`Unexpected command: ${command}`);
      }
    },
  );
}

async function renderHome(recentItems: ArchiveRecent[] = []) {
  installInvokeHandler({ recentItems });
  renderApp();
  await screen.findByRole("heading", { name: "Recent archives" });
  // The heading renders before the async bootstrap fetch resolves, so wait
  // for the fetched list itself before callers query it synchronously.
  if (recentItems.length > 0) {
    await screen.findByText(recentItems[0].displayName);
  }
}

function renderApp() {
  return render(
    <Theme appearance="light" accentColor="blue" grayColor="slate">
      <App />
    </Theme>,
  );
}

async function openRecentArchive() {
  await renderHome([recent]);
  await userEvent.click(
    await screen.findByRole("button", {
      name: /^demo\.pna \/tmp\/demo\.pna$/,
    }),
  );
  await screen.findByRole("button", { name: "Open another archive" });
}

describe("application shell", () => {
  beforeEach(() => {
    setLanguages("en-US");
    bridge.invoke.mockReset();
    bridge.getMatches
      .mockReset()
      .mockResolvedValue({ args: { source: { value: null } } });
    bridge.openDialog.mockReset().mockResolvedValue(null);
    bridge.saveDialog.mockReset().mockResolvedValue(null);
    bridge.dragHandler = undefined;
    bridge.dragHandlers = [];
    bridge.menuHandler = undefined;
    bridge.jobHandlers = [];
    document.documentElement.lang = "en";
  });

  it("[UI-VERIFY-BROWSER-ENTRY] starts factual verification from the archive toolbar", async () => {
    await openRecentArchive();
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    const dialog = screen.getByRole("dialog", { name: "Verify archive" });
    expect(dialog).toHaveTextContent("demo.pna");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Start verification" }),
    );
    expect(bridge.invoke).toHaveBeenCalledWith("job_start_verify", {
      request: {
        archivePath: recent.path,
        password: null,
        mode: "quick",
      },
    });
  });

  it("[UI-VERIFY-NONINTERRUPTIVE-COMPLETE] retains a completed result without stealing focus", async () => {
    await openRecentArchive();
    const completedVerification: JobSnapshot = {
      id: "job-verify-1",
      kind: "verify",
      status: "succeeded",
      phase: "completed",
      currentItem: null,
      completedUnits: 2,
      totalUnits: 2,
      outputPath: null,
      error: null,
      errorCode: null,
      warnings: [],
      verificationReport: {
        archivePath: recent.path,
        sourceSize: 2048,
        sourceModifiedAt: 1_700_000_000,
        sourceSha256:
          "f1a5a48b3b1f91208b982163be46f3a865f157989a4a195c6806144c4f8f23ac",
        completedAt: 1_700_000_010,
        mode: "quick",
        conclusion: "passed",
        encrypted: false,
        solid: false,
        entriesChecked: 2,
        filesChecked: 0,
        bytesChecked: 0,
        failedChecks: 0,
        notCheckedChecks: 1,
        checksOmitted: 0,
        checks: [],
      },
    };

    act(() =>
      bridge.jobHandlers.forEach((handler) =>
        handler({ payload: completedVerification }),
      ),
    );

    expect(
      screen.queryByRole("dialog", { name: "Verification results" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "View results" }),
    ).toBeVisible();
  });

  it("[UI-HOME-EMPTY] renders the empty English home state", async () => {
    await renderHome();
    expect(screen.getByText("No recent archives")).toBeVisible();
    const navigation = screen.getByLabelText("Navigation");
    expect(within(navigation).getByText("Recent")).toBeVisible();
    expect(within(navigation).getByText("0")).toBeVisible();
    expect(
      screen.getByText("Select an archive in the list to see its information."),
    ).toBeVisible();
  });

  it("[UI-LOC-LIVE] follows a runtime environment language change", async () => {
    await renderHome();
    setLanguages("ja-JP");
    act(() => window.dispatchEvent(new Event("languagechange")));
    expect(
      await screen.findByRole("heading", { name: "最近のアーカイブ" }),
    ).toBeVisible();
    expect(document.documentElement.lang).toBe("ja");
  });

  it("[UI-HOME-RECENT] selects, inspects, and removes a recent archive", async () => {
    await renderHome([recent]);
    const row = screen.getByRole("row", { name: /demo\.pna/ });
    await userEvent.click(row);
    const inspector = screen.getByLabelText("Selected archive");
    expect(within(inspector).getByText("demo.pna")).toBeVisible();
    await userEvent.click(
      within(inspector).getByRole("button", { name: "Remove from Recents" }),
    );
    expect(bridge.invoke).toHaveBeenCalledWith("recent_remove", {
      path: recent.path,
    });
  });

  it("[UI-RECENT-REMOVE-SINGLE-FLIGHT] issues one removal while the first request is pending", async () => {
    await renderHome([recent]);
    const originalInvoke = bridge.invoke.getMockImplementation()!;
    let resolveRemoval!: (items: ArchiveRecent[]) => void;
    bridge.invoke.mockImplementation(
      (command: string, args?: Record<string, unknown>) => {
        if (command === "recent_remove") {
          return new Promise((resolve) => {
            resolveRemoval = resolve;
          });
        }
        return originalInvoke(command, args);
      },
    );
    await userEvent.click(screen.getByRole("row", { name: /demo\.pna/ }));
    const remove = within(screen.getByLabelText("Selected archive")).getByRole(
      "button",
      { name: "Remove from Recents" },
    );

    await userEvent.dblClick(remove);

    expect(
      bridge.invoke.mock.calls.filter(
        ([command]) => command === "recent_remove",
      ),
    ).toHaveLength(1);
    await act(async () => resolveRemoval([]));
  });

  it("[UI-PICKER-OPEN-ERROR] presents a native picker failure without exposing raw text by default", async () => {
    await renderHome([recent]);
    bridge.openDialog.mockRejectedValueOnce(
      new Error("archive picker unavailable"),
    );

    await userEvent.click(
      screen.getAllByRole("button", { name: /Open archive/ })[0],
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The operation could not be completed.");
    expect(
      within(alert).getByText("archive picker unavailable"),
    ).not.toBeVisible();
    await userEvent.click(within(alert).getByText("Technical details"));
    expect(within(alert).getByText("archive picker unavailable")).toBeVisible();
  });

  it("[UI-CLI-ARGUMENT-ERROR] reports startup argument bridge failure without exposing raw text by default", async () => {
    bridge.getMatches.mockRejectedValueOnce(
      new Error("command line bridge unavailable"),
    );

    await renderHome();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The operation could not be completed.");
    expect(
      within(alert).getByText("command line bridge unavailable"),
    ).not.toBeVisible();
    await userEvent.click(within(alert).getByText("Technical details"));
    expect(
      within(alert).getByText("command line bridge unavailable"),
    ).toBeVisible();
  });

  it("[UI-UX-HOME-ROW-KEYBOARD] opens a recent archive from its single primary keyboard stop", async () => {
    await renderHome([recent]);
    const row = screen.getByRole("row", { name: /demo\.pna/ });
    expect(within(row).getAllByRole("button")).toHaveLength(1);
    within(row)
      .getByRole("button", { name: /demo\.pna/ })
      .focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByTestId("archive-browser")).toBeVisible();
  });

  it("[UI-BROWSER-TREE] renders a bounded folder icon, visible tree label, and null metadata", async () => {
    await openRecentArchive();
    const tree = screen.getByLabelText("Archive tree");
    const folderButton = await within(tree).findByRole("button", {
      name: "src",
    });
    const icon = folderButton.querySelector("svg");
    expect(folderButton).toHaveTextContent("src");
    expect(icon).toHaveAttribute("width", "16");
    expect(icon).toHaveAttribute("height", "16");

    const row = await screen.findByRole("row", { name: /src Folder/ });
    expect(row).not.toHaveTextContent("NaN");
    expect(row).not.toHaveTextContent("1970");
    expect(within(row).getAllByText("—")).toHaveLength(5);
  });

  it("[UI-SESSION-CLOSE-ERROR] returns home and preserves a close failure as collapsed technical evidence", async () => {
    await openRecentArchive();
    const originalInvoke = bridge.invoke.getMockImplementation()!;
    bridge.invoke.mockImplementation(
      (command: string, args?: Record<string, unknown>) => {
        if (command === "archive_close")
          return Promise.reject(new Error("archive handle close failed"));
        return originalInvoke(command, args);
      },
    );

    await userEvent.click(screen.getByTestId("archive-home"));

    expect(
      await screen.findByRole("heading", { name: "Recent archives" }),
    ).toBeVisible();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("The operation could not be completed.");
    expect(
      within(alert).getByText("archive handle close failed"),
    ).not.toBeVisible();
    await userEvent.click(within(alert).getByText("Technical details"));
    expect(
      within(alert).getByText("archive handle close failed"),
    ).toBeVisible();
  });

  it("[UI-UPDATE-APPEND-FLOW] adds selected files to the open archive as a background job", async () => {
    await openRecentArchive();
    bridge.openDialog.mockResolvedValueOnce(["/tmp/new.txt"]);

    await userEvent.click(screen.getByRole("button", { name: "Add files" }));
    expect(
      await screen.findByRole("dialog", { name: "Add to archive" }),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Choose files" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Add to Archive" }),
    );

    expect(bridge.invoke).toHaveBeenCalledWith("job_start_append", {
      request: {
        archivePath: recent.path,
        sources: ["/tmp/new.txt"],
        options: {
          solid: false,
          compression: "zstd",
          encryption: "none",
          password: null,
          preservePermissions: true,
          reproducible: false,
        },
      },
    });
  });

  it("[UI-PICKER-APPEND-ERROR] reports a file picker failure inside the append dialog", async () => {
    await openRecentArchive();
    bridge.openDialog.mockRejectedValueOnce(
      new Error("file picker unavailable"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Add files" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Add to archive",
    });

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Choose files" }),
    );

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "The operation could not be completed.",
    );
    expect(
      within(dialog).getByText("file picker unavailable"),
    ).not.toBeVisible();
  });

  it("[UI-UPDATE-APPEND-ERROR-RECOVERY] retains selected sources when job submission fails", async () => {
    await openRecentArchive();
    bridge.openDialog.mockResolvedValueOnce(["/tmp/new.txt"]);
    await userEvent.click(screen.getByRole("button", { name: "Add files" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Add to archive",
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Choose files" }),
    );
    bridge.invoke.mockRejectedValueOnce(new Error("job queue is unavailable"));

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Add to Archive" }),
    );

    expect(
      screen.getByRole("dialog", { name: "Add to archive" }),
    ).toBeVisible();
    expect(within(dialog).getByText("/tmp/new.txt")).toBeVisible();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "The operation could not be completed.",
    );
  });

  it("[UI-UPDATE-RENAME-FLOW] names the selected entry and keeps invalid input in place", async () => {
    await openRecentArchive();
    await userEvent.click(
      await screen.findByRole("row", { name: /src Folder/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "New name" });
    await userEvent.clear(input);
    await userEvent.type(input, "manual");
    await userEvent.click(screen.getByRole("button", { name: "Rename Item" }));
    expect(bridge.invoke).toHaveBeenCalledWith("job_start_rename_entry", {
      request: {
        archivePath: recent.path,
        sourcePath: "src",
        destinationPath: "manual",
        password: null,
      },
    });
  });

  it("[UI-UPDATE-RENAME-ENCRYPTED] requires, forwards, and clears the encrypted solid archive password", async () => {
    const encryptedSummary: ArchiveSummary = {
      ...summary,
      solid: true,
      encryptionMethods: ["AES"],
    };
    installInvokeHandler({
      recentItems: [recent],
      openResults: {
        [recent.path]: {
          handle: encryptedSummary.handle,
          summary: encryptedSummary,
        },
      },
    });
    renderApp();
    await userEvent.click(
      await screen.findByRole("button", {
        name: /^demo\.pna \/tmp\/demo\.pna$/,
      }),
    );
    await userEvent.click(
      await screen.findByRole("row", { name: /src Folder/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    let dialog = screen.getByRole("dialog", { name: "Rename archive item" });
    const rename = within(dialog).getByRole("button", { name: "Rename Item" });
    expect(rename).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Password"), "secret");
    await userEvent.click(rename);
    expect(bridge.invoke).toHaveBeenCalledWith("job_start_rename_entry", {
      request: {
        archivePath: recent.path,
        sourcePath: "src",
        destinationPath: "src",
        password: "secret",
      },
    });

    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    dialog = screen.getByRole("dialog", { name: "Rename archive item" });
    expect(within(dialog).getByLabelText("Password")).toHaveValue("");
    expect(
      within(dialog).getByRole("button", { name: "Rename Item" }),
    ).toBeDisabled();
  });

  it("[UI-UX-RENAME-VALIDATION] distinguishes an empty name from a path separator", async () => {
    await openRecentArchive();
    await userEvent.click(
      await screen.findByRole("row", { name: /src Folder/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const dialog = screen.getByRole("dialog", {
      name: "Rename archive item",
    });
    const input = within(dialog).getByRole("textbox", { name: "New name" });

    await userEvent.clear(input);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter a name.");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Enter a name.",
    );

    await userEvent.type(input, "nested/name");
    expect(input).toHaveAccessibleDescription("A name cannot contain / or \\.");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "A name cannot contain / or \\.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Rename Item" }),
    ).toBeDisabled();
  });

  it("[UI-UPDATE-DELETE-CONFIRMATION] confirms the exact selected archive path", async () => {
    await openRecentArchive();
    await userEvent.click(
      await screen.findByRole("row", { name: /src Folder/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog", {
      name: "Delete from archive?",
    });
    expect(within(dialog).getByText("src")).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete from Archive" }),
    );
    expect(bridge.invoke).toHaveBeenCalledWith("job_start_delete_entries", {
      request: {
        archivePath: recent.path,
        entries: ["src"],
        password: null,
      },
    });
  });

  it("[UI-UPDATE-DELETE-ERROR-RECOVERY] keeps the destructive scope visible when job submission fails", async () => {
    await openRecentArchive();
    await userEvent.click(
      await screen.findByRole("row", { name: /src Folder/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    bridge.invoke.mockRejectedValueOnce(
      new Error("job storage is unavailable"),
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "Delete from archive?",
    });

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete from Archive" }),
    );

    expect(
      screen.getByRole("alertdialog", { name: "Delete from archive?" }),
    ).toBeVisible();
    expect(within(dialog).getByText("src")).toBeVisible();
    expect(
      await screen.findByText("The operation could not be completed."),
    ).toBeVisible();
  });

  it("[UI-VOLUME-SPLIT-FLOW] explains and starts split output with an explicit destination", async () => {
    await openRecentArchive();
    bridge.openDialog.mockResolvedValueOnce("/tmp/parts");
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Archive tools" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Archive tools" });
    await userEvent.selectOptions(
      within(dialog).getByLabelText("Operation"),
      "split",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Choose output folder" }),
    );
    await userEvent.clear(
      within(dialog).getByLabelText("Maximum part size (MB)"),
    );
    await userEvent.type(
      within(dialog).getByLabelText("Maximum part size (MB)"),
      "16",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Start" }),
    );
    expect(bridge.invoke).toHaveBeenCalledWith("job_start_split", {
      request: {
        archivePath: recent.path,
        outputDirectory: "/tmp/parts",
        maxPartBytes: 16 * 1024 * 1024,
      },
    });
  });

  it("[UI-UX-SPLIT-SIZE-VALIDATION] explains an invalid part size beside the field", async () => {
    await openRecentArchive();
    bridge.openDialog.mockResolvedValueOnce("/tmp/parts");
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Archive tools" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Archive tools" });
    const size = within(dialog).getByLabelText("Maximum part size (MB)");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Choose output folder" }),
    );
    await userEvent.clear(size);
    await userEvent.type(size, "0");

    expect(size).toHaveAttribute("aria-invalid", "true");
    expect(size).toHaveAccessibleDescription(
      "Enter a part size of at least 0.001 MB.",
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Enter a part size of at least 0.001 MB.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Start" }),
    ).toBeDisabled();
  });

  it("[UI-VOLUME-CONCAT-FLOW] requires one discoverable part and an output before starting", async () => {
    await openRecentArchive();
    bridge.openDialog.mockResolvedValueOnce("/tmp/demo.part2.pna");
    bridge.saveDialog.mockResolvedValueOnce("/tmp/demo-combined.pna");
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Archive tools" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Archive tools" });
    await userEvent.selectOptions(
      within(dialog).getByLabelText("Operation"),
      "concat",
    );
    expect(
      within(dialog).getByText(/Choose any one part.*discovered and validated/),
    ).toBeVisible();
    const start = within(dialog).getByRole("button", { name: "Start" });
    expect(start).toBeDisabled();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Choose any part" }),
    );
    expect(start).toBeDisabled();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Choose output file" }),
    );
    expect(start).toBeEnabled();
    await userEvent.click(start);
    expect(bridge.invoke).toHaveBeenCalledWith("job_start_concat", {
      request: {
        parts: ["/tmp/demo.part2.pna"],
        outputPath: "/tmp/demo-combined.pna",
      },
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Archive tools" }),
      ).not.toBeInTheDocument();
    });
  });

  it("[UI-NORMALIZE-IMPACT-SUMMARY] explains the non-destructive impact of every normalization operation", async () => {
    await openRecentArchive();
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Archive tools" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Archive tools" });
    const operation = within(dialog).getByLabelText("Operation");

    await userEvent.selectOptions(operation, "sort");
    expect(
      within(dialog).getByText(
        "Writes a separate copy with entries reordered by name. File data, encryption, and supported metadata are preserved.",
      ),
    ).toBeVisible();

    await userEvent.selectOptions(operation, "strip");
    expect(
      within(dialog).getByText(
        "Writes a separate copy using only the preservation options selected below. File data and integrity digests are retained.",
      ),
    ).toBeVisible();

    await userEvent.selectOptions(operation, "migrate");
    expect(
      within(dialog).getByText(
        "Writes a separate copy with metadata represented by the current PNA library. File data and the source archive are unchanged.",
      ),
    ).toBeVisible();
  });

  it("[UI-PICKER-TOOLS-ERROR] reports an output picker failure inside archive tools", async () => {
    await openRecentArchive();
    bridge.saveDialog.mockRejectedValueOnce(
      new Error("save picker unavailable"),
    );
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Archive tools" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Archive tools" });
    await userEvent.selectOptions(
      within(dialog).getByLabelText("Operation"),
      "sort",
    );

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Choose output file" }),
    );

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "The operation could not be completed.",
    );
  });

  it("[UI-NORMALIZE-PAYLOADS] sends every selected normalization option to its typed job command", async () => {
    await openRecentArchive();
    bridge.saveDialog
      .mockResolvedValueOnce("/tmp/sorted.pna")
      .mockResolvedValueOnce("/tmp/stripped.pna")
      .mockResolvedValueOnce("/tmp/migrated.pna");

    const openTools = async () => {
      await userEvent.click(screen.getByRole("button", { name: "More" }));
      await userEvent.click(
        screen.getByRole("menuitem", { name: "Archive tools" }),
      );
      return screen.getByRole("dialog", { name: "Archive tools" });
    };

    let dialog = await openTools();
    await userEvent.selectOptions(
      within(dialog).getByLabelText("Operation"),
      "sort",
    );
    await userEvent.click(within(dialog).getByLabelText("Descending order"));
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Choose output file" }),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Start" }),
    );
    expect(bridge.invoke).toHaveBeenCalledWith("job_start_sort", {
      request: {
        archivePath: recent.path,
        outputPath: "/tmp/sorted.pna",
        password: null,
        descending: true,
      },
    });

    dialog = await openTools();
    await userEvent.selectOptions(
      within(dialog).getByLabelText("Operation"),
      "strip",
    );
    await userEvent.click(within(dialog).getByLabelText("Keep timestamps"));
    await userEvent.click(
      within(dialog).getByLabelText("Keep ownership and permissions"),
    );
    await userEvent.click(
      within(dialog).getByLabelText("Keep extended attributes"),
    );
    await userEvent.click(within(dialog).getByLabelText("Keep private chunks"));
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Choose output file" }),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Start" }),
    );
    expect(bridge.invoke).toHaveBeenCalledWith("job_start_strip_metadata", {
      request: {
        archivePath: recent.path,
        outputPath: "/tmp/stripped.pna",
        password: null,
        keepTimestamps: true,
        keepPermissions: true,
        keepXattrs: true,
        keepPrivateChunks: true,
      },
    });

    dialog = await openTools();
    await userEvent.selectOptions(
      within(dialog).getByLabelText("Operation"),
      "migrate",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Choose output file" }),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Start" }),
    );
    expect(bridge.invoke).toHaveBeenCalledWith("job_start_migrate", {
      request: {
        archivePath: recent.path,
        outputPath: "/tmp/migrated.pna",
        password: null,
      },
    });
  });

  it("[UI-NORMALIZE-ENCRYPTED-PASSWORD] forwards and clears the password for every encrypted normalization job", async () => {
    const encryptedSummary: ArchiveSummary = {
      ...summary,
      solid: true,
      encryptionMethods: ["AES"],
    };
    installInvokeHandler({
      recentItems: [recent],
      openResults: {
        [recent.path]: {
          handle: encryptedSummary.handle,
          summary: encryptedSummary,
        },
      },
    });
    bridge.saveDialog
      .mockResolvedValueOnce("/tmp/sorted.pna")
      .mockResolvedValueOnce("/tmp/stripped.pna")
      .mockResolvedValueOnce("/tmp/migrated.pna");
    renderApp();
    await userEvent.click(
      await screen.findByRole("button", {
        name: /^demo\.pna \/tmp\/demo\.pna$/,
      }),
    );

    for (const [operation, command, outputPath] of [
      ["sort", "job_start_sort", "/tmp/sorted.pna"],
      ["strip", "job_start_strip_metadata", "/tmp/stripped.pna"],
      ["migrate", "job_start_migrate", "/tmp/migrated.pna"],
    ] as const) {
      await userEvent.click(screen.getByRole("button", { name: "More" }));
      await userEvent.click(
        screen.getByRole("menuitem", { name: "Archive tools" }),
      );
      const dialog = screen.getByRole("dialog", { name: "Archive tools" });
      await userEvent.selectOptions(
        within(dialog).getByLabelText("Operation"),
        operation,
      );
      const password = within(dialog).getByLabelText("Password");
      expect(password).toHaveValue("");
      const start = within(dialog).getByRole("button", { name: "Start" });
      expect(start).toBeDisabled();
      await userEvent.type(password, "secret");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Choose output file" }),
      );
      await userEvent.click(start);
      expect(bridge.invoke).toHaveBeenCalledWith(
        command,
        expect.objectContaining({
          request: expect.objectContaining({
            archivePath: recent.path,
            outputPath,
            password: "secret",
          }),
        }),
      );
    }
  });

  it("[UI-NORMALIZE-ERROR-RECOVERY] keeps the selected output and operation when submission fails", async () => {
    await openRecentArchive();
    bridge.saveDialog.mockResolvedValueOnce("/tmp/demo-sorted.pna");
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Archive tools" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Archive tools" });
    await userEvent.selectOptions(
      within(dialog).getByLabelText("Operation"),
      "sort",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Choose output file" }),
    );
    bridge.invoke.mockRejectedValueOnce(new Error("output is read-only"));

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Start" }),
    );

    expect(screen.getByRole("dialog", { name: "Archive tools" })).toBeVisible();
    expect(within(dialog).getByText("/tmp/demo-sorted.pna")).toBeVisible();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "The operation could not be completed.",
    );
    expect(within(dialog).getByLabelText("Operation")).toHaveValue("sort");
  });

  it("[UI-SEARCH-EMPTY] submits a trimmed query and shows the no-results state", async () => {
    await openRecentArchive();
    const search = screen.getByRole("textbox", { name: "Search archive" });
    await userEvent.type(search, "  missing  {Enter}");
    expect(bridge.invoke).toHaveBeenCalledWith("archive_search", {
      handle: summary.handle,
      query: "missing",
      cursor: undefined,
      limit: 200,
    });
    expect(await screen.findByText("No matching items")).toBeVisible();
    expect(screen.getByText("Search results for “missing”")).toBeVisible();
  });

  it("[UI-UX-ARCHIVE-CONTEXT-RESET] opens another archive at its root with no inherited search", async () => {
    const otherSummary: ArchiveSummary = {
      ...summary,
      handle: "archive-2",
      path: "/tmp/other.pna",
      displayName: "other.pna",
    };
    installInvokeHandler({
      recentItems: [recent],
      openResults: {
        [recent.path]: { handle: summary.handle, summary },
        [otherSummary.path]: {
          handle: otherSummary.handle,
          summary: otherSummary,
        },
      },
    });
    bridge.openDialog.mockResolvedValueOnce(otherSummary.path);
    renderApp();
    await screen.findByRole("heading", { name: "Recent archives" });
    await userEvent.click(
      await screen.findByRole("button", {
        name: /^demo\.pna \/tmp\/demo\.pna$/,
      }),
    );
    const search = await screen.findByRole("textbox", {
      name: "Search archive",
    });
    await userEvent.type(search, "missing{Enter}");
    expect(
      await screen.findByText("Search results for “missing”"),
    ).toBeVisible();

    await userEvent.click(
      screen.getByRole("button", { name: "Open another archive" }),
    );

    expect((await screen.findAllByText("other.pna")).length).toBeGreaterThan(0);
    expect(screen.getByRole("textbox", { name: "Search archive" })).toHaveValue(
      "",
    );
    expect(
      screen.queryByText("Search results for “missing”"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Current folder" }),
    ).toHaveTextContent("other.pna");
    expect(
      screen.getByRole("navigation", { name: "Current folder" }),
    ).not.toHaveTextContent("missing");
  });

  it("[UI-UX-SEARCH-SUBMIT-AFFORDANCE] offers a visible search action in addition to Enter", async () => {
    await openRecentArchive();
    const search = screen.getByRole("textbox", { name: "Search archive" });
    await userEvent.type(search, "missing");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(bridge.invoke).toHaveBeenCalledWith("archive_search", {
      handle: summary.handle,
      query: "missing",
      cursor: undefined,
      limit: 200,
    });
  });

  it("[UI-UX-SEARCH-LOCATION] distinguishes same-name search results by relative path", async () => {
    const duplicateA: ArchiveEntry = {
      ...directory,
      id: "entry-a",
      path: "input/Folder A/same-name.txt",
      name: "same-name.txt",
      kind: "file",
      hasChildren: false,
    };
    const duplicateB: ArchiveEntry = {
      ...duplicateA,
      id: "entry-b",
      path: "input/Folder B/same-name.txt",
    };
    installInvokeHandler({
      recentItems: [recent],
      searchItems: [duplicateA, duplicateB],
    });
    renderApp();
    await screen.findByRole("heading", { name: "Recent archives" });
    await userEvent.click(
      await screen.findByRole("button", {
        name: /^demo\.pna \/tmp\/demo\.pna$/,
      }),
    );
    const search = await screen.findByRole("textbox", {
      name: "Search archive",
    });
    await userEvent.type(search, "same-name{Enter}");

    expect(
      await screen.findByText("input/Folder A/same-name.txt"),
    ).toBeVisible();
    expect(screen.getByText("input/Folder B/same-name.txt")).toBeVisible();
  });

  it("[UI-OPEN-PASSWORD] requires a nonempty password without persisting it", async () => {
    installInvokeHandler({
      recentItems: [recent],
      bootstrapDelayMs: 25,
      openError: {
        code: "PASSWORD_REQUIRED",
        message: "backend message",
        retryable: true,
      },
    });
    renderApp();
    await screen.findByRole("heading", { name: "Recent archives" });
    await userEvent.click(
      await screen.findByRole("button", {
        name: /^demo\.pna \/tmp\/demo\.pna$/,
      }),
    );
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Open" });
    expect(submit).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Password"), "secret");
    expect(submit).toBeEnabled();
  });

  it("[UI-UX-OPEN-ERROR-RECOVERY] names the failed archive, offers recovery, and dismisses with Escape", async () => {
    installInvokeHandler({
      recentItems: [recent],
      bootstrapDelayMs: 25,
      openError: {
        code: "ARCHIVE_CORRUPT",
        message: "backend message",
        retryable: true,
      },
    });
    renderApp();
    await screen.findByRole("heading", { name: "Recent archives" });
    await userEvent.click(
      await screen.findByRole("button", {
        name: /^demo\.pna \/tmp\/demo\.pna$/,
      }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("/tmp/demo.pna");
    expect(
      within(alert).getByRole("button", { name: "Choose another archive" }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("[UI-DROP-ARCHIVE] exposes drag feedback and opens the first PNA path", async () => {
    await renderHome();
    act(() =>
      bridge.dragHandler?.({
        payload: { type: "enter", paths: [], position: { x: 0, y: 0 } },
      } as DragDropEvent),
    );
    expect(screen.getByText("Drop a .pna archive to open it")).toBeVisible();
    act(() =>
      bridge.dragHandler?.({
        payload: {
          type: "drop",
          paths: ["/tmp/readme.txt", "/tmp/DEMO.PNA"],
          position: { x: 0, y: 0 },
        },
      } as DragDropEvent),
    );
    expect(
      await screen.findByRole("button", { name: "Open another archive" }),
    ).toBeVisible();
    expect(bridge.invoke).toHaveBeenCalledWith("archive_open", {
      path: "/tmp/DEMO.PNA",
      password: undefined,
    });
  });

  it("[UI-CREATE-EMPTY] opens the localized create state with creation disabled", async () => {
    await renderHome();
    await userEvent.click(
      screen.getByRole("button", { name: /Create new archive/ }),
    );
    expect(screen.getByText("Drop files here")).toBeVisible();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("[UI-CREATE-DROP-ISOLATION] keeps dropped archives in the create flow", async () => {
    await renderHome();
    await userEvent.click(
      screen.getByRole("button", { name: /Create new archive/ }),
    );
    const drop = {
      payload: {
        type: "drop",
        paths: ["/tmp/source.pna"],
        position: { x: 0, y: 0 },
      },
    } as DragDropEvent;

    act(() => bridge.dragHandlers.forEach((handler) => handler(drop)));

    expect(await screen.findByText("/tmp/source.pna")).toBeVisible();
    expect(bridge.invoke).not.toHaveBeenCalledWith("archive_open", {
      path: "/tmp/source.pna",
      password: undefined,
    });
  });

  it("[UI-P2-EXTRACT-JOB] starts extraction only after a destination is selected", async () => {
    await openRecentArchive();
    await userEvent.click(screen.getByRole("button", { name: "Extract" }));
    const dialog = screen.getByRole("dialog");
    const start = within(dialog).getByRole("button", {
      name: "Extract All Items",
    });
    expect(start).toBeDisabled();
    expect(
      within(dialog).getByText(
        "A folder named demo will be created inside the selected destination.",
      ),
    ).toBeVisible();
    bridge.openDialog.mockResolvedValue("/tmp/restore");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Choose destination" }),
    );
    expect(start).toBeEnabled();
    await userEvent.click(start);
    expect(bridge.invoke).toHaveBeenCalledWith("job_start_extract", {
      request: {
        archivePath: "/tmp/demo.pna",
        destination: "/tmp/restore",
        entries: [],
        password: null,
        conflict: "rename",
        restorePermissions: true,
        keepCompletedOnCancel: true,
      },
    });
  });

  it("[UI-PICKER-EXTRACT-ERROR] reports a destination picker failure inside extraction", async () => {
    await openRecentArchive();
    bridge.openDialog.mockRejectedValueOnce(
      new Error("destination picker unavailable"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Extract" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Extract archive",
    });

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Choose destination" }),
    );

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "The operation could not be completed.",
    );
  });

  it("[UI-UX-EXTRACT-SELECTED-DEFAULT] defaults to the selected item and names the extraction scope", async () => {
    await openRecentArchive();
    const selectedRow = await screen.findByRole("row", { name: /src Folder/ });
    await userEvent.click(selectedRow);
    await screen.findByRole("heading", { name: "Selected item" });

    await userEvent.click(screen.getByRole("button", { name: "Extract" }));
    const dialog = screen.getByRole("dialog", { name: "Extract archive" });
    expect(
      within(dialog).getByRole("checkbox", {
        name: "Extract only the selected item",
      }),
    ).toBeChecked();
    expect(
      within(dialog).getByRole("button", { name: "Extract Selected Item" }),
    ).toBeDisabled();

    bridge.openDialog.mockResolvedValue("/tmp/restore");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Choose destination" }),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Extract Selected Item" }),
    );

    expect(bridge.invoke).toHaveBeenCalledWith("job_start_extract", {
      request: expect.objectContaining({ entries: ["src"] }),
    });
  });

  it("[UI-P2-OPEN-SINGLE-FLIGHT] ignores duplicate open actions while indexing", async () => {
    await renderHome([recent]);
    bridge.invoke.mockImplementation(async (command: string) => {
      if (command === "archive_open") return new Promise(() => undefined);
      if (command === "job_list") return [];
      throw new Error(`Unexpected command: ${command}`);
    });
    const open = screen.getByRole("button", {
      name: /^demo\.pna \/tmp\/demo\.pna$/,
    });
    await userEvent.click(open);
    await userEvent.click(open);
    expect(
      bridge.invoke.mock.calls.filter(
        ([command]) => command === "archive_open",
      ),
    ).toHaveLength(1);
  });

  it("[UI-OPEN-CLI] opens a PNA path supplied by the registered command-line argument", async () => {
    installInvokeHandler();
    bridge.getMatches.mockResolvedValue({
      args: { source: { value: "/tmp/from-cli.pna" } },
    });
    renderApp();
    expect(
      await screen.findByRole("button", { name: "Open another archive" }),
    ).toBeVisible();
    expect(bridge.invoke).toHaveBeenCalledWith("archive_open", {
      path: "/tmp/from-cli.pna",
      password: undefined,
    });
    await waitFor(() => {
      expect(bridge.getMatches).toHaveBeenCalledTimes(1);
      expect(
        bridge.invoke.mock.calls.filter(
          ([command]) => command === "archive_open",
        ),
      ).toHaveLength(1);
    });
  });

  it("[UI-UPDATE-REOPEN-SAFE] opens an encrypted replacement before closing the old session", async () => {
    const encryptedSummary: ArchiveSummary = {
      ...summary,
      encryptionMethods: ["AES"],
    };
    let authenticated = false;
    bridge.invoke.mockImplementation(
      async (command: string, args?: Record<string, unknown>) => {
        if (command === "app_bootstrap")
          return { productName: "Portable Network Archive", recent: [recent] };
        if (command === "job_list") return [];
        if (command === "archive_children")
          return { items: [directory], nextCursor: null, totalCount: 1 };
        if (command === "archive_open") {
          if (args?.password !== "secret") {
            throw {
              code: "PASSWORD_REQUIRED",
              message: "password required",
              retryable: true,
            };
          }
          const handle = authenticated ? "archive-refreshed" : "archive-old";
          authenticated = true;
          return {
            handle,
            summary: { ...encryptedSummary, handle },
          };
        }
        if (command === "archive_close") return undefined;
        throw new Error(`Unexpected command: ${command}`);
      },
    );
    renderApp();
    await userEvent.click(
      await screen.findByRole("button", {
        name: /^demo\.pna \/tmp\/demo\.pna$/,
      }),
    );
    const password = await screen.findByLabelText("Password");
    await userEvent.type(password, "secret");
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByRole("button", { name: "Open another archive" });
    await waitFor(() => expect(bridge.jobHandlers.length).toBeGreaterThan(0));

    act(() => {
      const event = {
        payload: {
          id: "job-append",
          kind: "append",
          status: "succeeded",
          phase: "done",
          currentItem: null,
          completedUnits: 1,
          totalUnits: 1,
          outputPath: recent.path,
          error: null,
          warnings: [],
        } satisfies JobSnapshot,
      };
      bridge.jobHandlers.forEach((handler) => handler(event));
    });

    await waitFor(() => {
      expect(bridge.invoke).toHaveBeenCalledWith("archive_open", {
        path: recent.path,
        password: "secret",
      });
      expect(bridge.invoke).toHaveBeenCalledWith("archive_close", {
        handle: "archive-old",
      });
    });
    const openCall = bridge.invoke.mock.calls.findLastIndex(
      ([command]) => command === "archive_open",
    );
    const closeCall = bridge.invoke.mock.calls.findLastIndex(
      ([command, args]) =>
        command === "archive_close" && args?.handle === "archive-old",
    );
    expect(openCall).toBeLessThan(closeCall);
    expect(
      screen.queryByRole("dialog", { name: "Password required" }),
    ).not.toBeInTheDocument();
  });

  it("[UI-MENU-CREATE] routes the native create menu and [UI-MENU-OPEN] routes the native open menu", async () => {
    await renderHome();
    act(() => bridge.menuHandler?.({ payload: "extract" }));
    expect(bridge.openDialog).toHaveBeenCalled();
    act(() => bridge.menuHandler?.({ payload: "create" }));
    expect(await screen.findByText("Drop files here")).toBeVisible();
  });

  it("[UI-SHORTCUT-CREATE] handles the platform create shortcut and [UI-SHORTCUT-OPEN] handles the open shortcut", async () => {
    await renderHome();
    await userEvent.keyboard("{Control>}n{/Control}");
    expect(await screen.findByText("Drop files here")).toBeVisible();
    await userEvent.keyboard("{Control>}o{/Control}");
    expect(bridge.openDialog).toHaveBeenCalled();
  });
});
