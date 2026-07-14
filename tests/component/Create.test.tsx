import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../src/features/i18n";
import Create from "../../src/tabs/Create";

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
  readAllIfDir: vi.fn(),
  listeners: new Map<string, (event: { payload: string }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: bridge.open,
  save: bridge.save,
}));
vi.mock("../../src/utils/fs", () => ({ readAllIfDir: bridge.readAllIfDir }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {},
  getCurrentWebviewWindow: () => ({
    onDragDropEvent: async () => () => undefined,
    listen: async (
      event: string,
      handler: (event: { payload: string }) => void,
    ) => {
      bridge.listeners.set(event, handler);
      return () => bridge.listeners.delete(event);
    },
  }),
}));

function renderCreate() {
  return render(
    <I18nProvider>
      <Create />
    </I18nProvider>,
  );
}

async function addSource(path = "/input.txt") {
  bridge.open.mockResolvedValue([path]);
  bridge.readAllIfDir.mockResolvedValue([path]);
  await userEvent.click(screen.getByText("Drop files here"));
  await screen.findByText(path);
}

describe("archive creation UI", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      value: ["en-US"],
    });
    bridge.invoke.mockReset().mockResolvedValue(undefined);
    bridge.open.mockReset().mockResolvedValue(null);
    bridge.save.mockReset().mockResolvedValue(null);
    bridge.readAllIfDir.mockReset();
    bridge.listeners.clear();
    vi.spyOn(window, "alert").mockImplementation(() => undefined);
  });

  it("[UI-CREATE-PICKER-CANCEL] leaves the empty state unchanged when selection is cancelled", async () => {
    renderCreate();
    await userEvent.click(screen.getByText("Drop files here"));
    expect(bridge.readAllIfDir).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Create new archive" }),
    ).toBeDisabled();
  });

  it("[UI-CREATE-FILES] adds sources and [UI-CREATE-REMOVE] removes them", async () => {
    renderCreate();
    await addSource();
    expect(
      screen.getByRole("button", { name: "Create new archive" }),
    ).toBeEnabled();
    await userEvent.click(
      screen.getByRole("button", { name: "Remove file: /input.txt" }),
    );
    expect(screen.queryByText("/input.txt")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create new archive" }),
    ).toBeDisabled();
  });

  it("[UI-CREATE-SAVE-CANCEL] does not invoke the backend when save selection is cancelled", async () => {
    renderCreate();
    await addSource();
    await userEvent.click(
      screen.getByRole("button", { name: "Create new archive" }),
    );
    expect(bridge.invoke).not.toHaveBeenCalled();
  });

  it("[UI-CREATE-DEFAULT-INVOKE] normalizes the extension and sends default options", async () => {
    renderCreate();
    await addSource();
    bridge.save.mockResolvedValue("/output/archive");
    await userEvent.click(
      screen.getByRole("button", { name: "Create new archive" }),
    );
    expect(bridge.invoke).toHaveBeenCalledWith("create", {
      archiveFinishEvent: "on_finish",
      entryStartEvent: "on_entry_start",
      name: "archive.pna",
      files: ["/input.txt"],
      saveDir: "/output",
      option: {
        solid: false,
        compression: "zstd",
        encryption: "none",
        password: null,
      },
    });
  });

  it("[UI-CREATE-PASSWORD-REQUIRED] blocks encrypted creation without a password", async () => {
    renderCreate();
    await addSource();
    await userEvent.click(
      screen.getByRole("button", { name: "Archive options" }),
    );
    const dialog = screen.getByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("combobox", { name: "Encryption" }),
    );
    await userEvent.click(screen.getByRole("option", { name: "aes" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Create new archive" }),
    );
    expect(window.alert).toHaveBeenCalledWith(
      "Enter a password before creating an encrypted archive.",
    );
    expect(bridge.save).not.toHaveBeenCalled();
  });

  it("[UI-CREATE-PROCESSING] disables controls and [UI-CREATE-SUCCESS-RESET] clears completed sources", async () => {
    let finish: (() => void) | undefined;
    bridge.invoke.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    renderCreate();
    await addSource();
    bridge.save.mockResolvedValue("/output/archive.pna");
    await userEvent.click(
      screen.getByRole("button", { name: "Create new archive" }),
    );
    expect(
      screen.getByRole("button", { name: "Create new archive" }),
    ).toBeDisabled();
    await act(async () => {
      bridge.listeners.get("on_finish")?.({ payload: "" });
      finish?.();
      await Promise.resolve();
    });
    expect(await screen.findByText("Drop files here")).toBeVisible();
  });

  it("[UI-CREATE-FAILURE] reports a backend failure and restores controls", async () => {
    bridge.invoke.mockRejectedValue("creation failed");
    renderCreate();
    await addSource();
    bridge.save.mockResolvedValue("/output/archive.pna");
    await userEvent.click(
      screen.getByRole("button", { name: "Create new archive" }),
    );
    expect(window.alert).toHaveBeenCalledWith("creation failed");
    expect(
      await screen.findByRole("button", { name: "Create new archive" }),
    ).toBeEnabled();
  });
});
