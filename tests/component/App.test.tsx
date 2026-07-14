import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DragDropEvent } from "@tauri-apps/api/webviewWindow";
import App from "../../src/App";
import type {
  ArchiveEntry,
  ArchiveRecent,
  ArchiveSummary,
} from "../../src/features/archive/types";

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  getMatches: vi.fn(),
  openDialog: vi.fn(),
  dragHandler: undefined as ((event: DragDropEvent) => void) | undefined,
  menuHandler: undefined as
    | ((event: { payload: "extract" | "create" }) => void)
    | undefined,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));
vi.mock("@tauri-apps/plugin-cli", () => ({ getMatches: bridge.getMatches }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: bridge.openDialog,
  save: vi.fn(),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    onDragDropEvent: async (handler: (event: DragDropEvent) => void) => {
      bridge.dragHandler = handler;
      return () => undefined;
    },
    listen: async (
      _event: string,
      handler: (event: { payload: "extract" | "create" }) => void,
    ) => {
      bridge.menuHandler = handler;
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
  searchItems?: ArchiveEntry[];
}) {
  bridge.invoke.mockImplementation(
    async (command: string, args?: Record<string, unknown>) => {
      switch (command) {
        case "app_bootstrap":
          return {
            productName: "Portable Network Archive",
            recent: options?.recentItems ?? [],
          };
        case "recent_remove":
          return [];
        case "archive_open":
          if (options?.openError) throw options.openError;
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
        default:
          throw new Error(`Unexpected command: ${command}`);
      }
    },
  );
}

async function renderHome(recentItems: ArchiveRecent[] = []) {
  installInvokeHandler({ recentItems });
  render(<App />);
  await screen.findByRole("heading", { name: "Recent archives" });
}

async function openRecentArchive() {
  await renderHome([recent]);
  await userEvent.click(
    screen.getByRole("button", { name: /^demo\.pna \/tmp\/demo\.pna$/ }),
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
    bridge.dragHandler = undefined;
    bridge.menuHandler = undefined;
    document.documentElement.lang = "en";
  });

  it("[UI-HOME-EMPTY] renders the empty English home state", async () => {
    await renderHome();
    expect(screen.getByText("No recent archives")).toBeVisible();
    expect(screen.getByRole("button", { name: /Recent 0/ })).toBeVisible();
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
      within(row).getByRole("button", { name: /Remove from Recents/ }),
    );
    expect(bridge.invoke).toHaveBeenCalledWith("recent_remove", {
      path: recent.path,
    });
  });

  it("[UI-BROWSER-TREE] renders a bounded folder icon, visible tree label, and null metadata", async () => {
    await openRecentArchive();
    const tree = screen.getByLabelText("Archive tree");
    const folderButton = within(tree).getByRole("button", { name: "src" });
    const icon = folderButton.querySelector("svg");
    expect(folderButton).toHaveTextContent("src");
    expect(icon).toHaveAttribute("width", "16");
    expect(icon).toHaveAttribute("height", "16");

    const row = screen.getByRole("row", { name: /src Folder/ });
    expect(row).not.toHaveTextContent("NaN");
    expect(row).not.toHaveTextContent("1970");
    expect(within(row).getAllByText("—")).toHaveLength(5);
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

  it("[UI-OPEN-PASSWORD] requires a nonempty password without persisting it", async () => {
    installInvokeHandler({
      recentItems: [recent],
      openError: {
        code: "PASSWORD_REQUIRED",
        message: "backend message",
        retryable: true,
      },
    });
    render(<App />);
    await screen.findByRole("heading", { name: "Recent archives" });
    await userEvent.click(
      screen.getByRole("button", { name: /^demo\.pna \/tmp\/demo\.pna$/ }),
    );
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Open" });
    expect(submit).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Password"), "secret");
    expect(submit).toBeEnabled();
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
    expect(
      screen.getByRole("button", { name: "Create new archive" }),
    ).toBeDisabled();
  });

  it("[UI-OPEN-CLI] opens a PNA path supplied by the registered command-line argument", async () => {
    installInvokeHandler();
    bridge.getMatches.mockResolvedValue({
      args: { source: { value: "/tmp/from-cli.pna" } },
    });
    render(<App />);
    expect(
      await screen.findByRole("button", { name: "Open another archive" }),
    ).toBeVisible();
    expect(bridge.invoke).toHaveBeenCalledWith("archive_open", {
      path: "/tmp/from-cli.pna",
      password: undefined,
    });
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
