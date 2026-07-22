import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../src/features/i18n";
import Create from "../../src/tabs/Create";

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: bridge.open,
  save: bridge.save,
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    onDragDropEvent: async () => () => undefined,
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
  await userEvent.click(screen.getByText("Drop files here"));
  await screen.findByText(path);
}

async function goToConfirmation() {
  await addSource();
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
}

describe("archive creation wizard", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      value: ["en-US"],
    });
    bridge.invoke.mockReset().mockResolvedValue({ id: "job-1" });
    bridge.open.mockReset().mockResolvedValue(null);
    bridge.save.mockReset().mockResolvedValue(null);
  });

  it("[UI-CREATE-PICKER-CANCEL] keeps source selection empty when the picker is cancelled", async () => {
    renderCreate();
    await userEvent.click(screen.getByText("Drop files here"));
    expect(screen.getByText("No files or folders selected.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("[UI-PICKER-CREATE-SOURCE-ERROR] keeps a source picker failure as collapsed technical evidence", async () => {
    bridge.open.mockRejectedValueOnce(new Error("source picker unavailable"));
    renderCreate();

    await userEvent.click(screen.getByText("Drop files here"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The operation could not be completed.");
    expect(
      within(alert).getByText("source picker unavailable"),
    ).not.toBeVisible();
    await userEvent.click(within(alert).getByText("Technical details"));
    expect(within(alert).getByText("source picker unavailable")).toBeVisible();
  });

  it("[UI-PICKER-CREATE-SOURCE-RECOVERY] clears a previous picker failure after a successful retry", async () => {
    bridge.open
      .mockRejectedValueOnce(new Error("source picker unavailable"))
      .mockResolvedValueOnce(["/recovered.txt"]);
    renderCreate();

    await userEvent.click(screen.getByText("Drop files here"));
    expect(await screen.findByRole("alert")).toBeVisible();
    await userEvent.click(screen.getByText("Drop files here"));

    expect(await screen.findByText("/recovered.txt")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("[UI-UX-CREATE-DROPZONE-KEYBOARD] exposes the file drop target as a keyboard button", async () => {
    renderCreate();
    const dropTarget = screen.getByRole("button", {
      name: "Drop files here or click to browse",
    });
    dropTarget.focus();
    await userEvent.keyboard("{Enter}");
    expect(bridge.open).toHaveBeenCalledTimes(1);
  });

  it("[UI-CREATE-FILES] lists selected sources and [UI-CREATE-REMOVE] removes them", async () => {
    renderCreate();
    await addSource();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    await userEvent.click(
      screen.getByRole("button", { name: "Remove file: /input.txt" }),
    );
    expect(screen.queryByText("/input.txt")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("[UI-UX-CREATE-PRESET-GUIDANCE] explains the outcome and tradeoff of every preset", async () => {
    renderCreate();
    await addSource();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getByText("Balanced compression and individual-file access."),
    ).toBeVisible();
    expect(
      screen.getByText("Smallest practical size; takes longer to process."),
    ).toBeVisible();
    expect(
      screen.getByText("Repeatable output for unchanged source files."),
    ).toBeVisible();
  });

  it("[UI-CREATE-SAVE-CANCEL] does not start a job when save selection is cancelled", async () => {
    renderCreate();
    await goToConfirmation();
    await userEvent.click(
      screen.getByRole("button", { name: "Start creating" }),
    );
    expect(bridge.invoke).not.toHaveBeenCalled();
  });

  it("[UI-PICKER-CREATE-SAVE-ERROR] keeps a save picker failure as collapsed technical evidence", async () => {
    bridge.save.mockRejectedValueOnce(new Error("save picker unavailable"));
    renderCreate();
    await goToConfirmation();

    await userEvent.click(
      screen.getByRole("button", { name: "Start creating" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The operation could not be completed.");
    expect(
      within(alert).getByText("save picker unavailable"),
    ).not.toBeVisible();
    await userEvent.click(within(alert).getByText("Technical details"));
    expect(within(alert).getByText("save picker unavailable")).toBeVisible();
    expect(bridge.invoke).not.toHaveBeenCalled();
  });

  it("[UI-CREATE-SAVE-SINGLE-FLIGHT] opens one save picker for a rapid double activation", async () => {
    let resolveSave!: (path: null) => void;
    bridge.save.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    renderCreate();
    await goToConfirmation();
    const submit = screen.getByRole("button", { name: "Start creating" });

    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(bridge.save).toHaveBeenCalledTimes(1);
    resolveSave(null);
  });

  it("[UI-CREATE-DEFAULT-INVOKE] normalizes the extension and queues the default options", async () => {
    renderCreate();
    await goToConfirmation();
    bridge.save.mockResolvedValue("/output/archive");
    await userEvent.click(
      screen.getByRole("button", { name: "Start creating" }),
    );
    expect(bridge.invoke).toHaveBeenCalledWith("job_start_create", {
      request: {
        sources: ["/input.txt"],
        outputPath: "/output/archive.pna",
        overwrite: false,
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

  it("[UI-CREATE-PASSWORD-REQUIRED] blocks encrypted creation until matching passwords are provided", async () => {
    renderCreate();
    await addSource();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Encryption" }),
      "aes",
    );
    expect(
      screen.getByText(
        "Enter a password before creating an encrypted archive.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Password"), "secret");
    await userEvent.type(screen.getByLabelText("Confirm password"), "secret");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getByRole("button", { name: "Start creating" }),
    ).toBeEnabled();
  });

  it("[UI-CREATE-PROCESSING] disables submission while queuing and [UI-CREATE-SUCCESS-RESET] resets after enqueue", async () => {
    // UI-UX-CREATE-NOTICE-TERMINAL
    let resolveJob: ((value: { id: string }) => void) | undefined;
    bridge.invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveJob = resolve;
        }),
    );
    renderCreate();
    await goToConfirmation();
    bridge.save.mockResolvedValue("/output/archive.pna");
    await userEvent.click(
      screen.getByRole("button", { name: "Start creating" }),
    );
    expect(screen.getByRole("button", { name: "Starting…" })).toBeDisabled();
    resolveJob?.({ id: "job-1" });
    expect(await screen.findByText("Creation Started")).toBeVisible();
    expect(
      screen.getByText(/\/output\/archive\.pna was added to the Job Center/),
    ).toBeVisible();
    expect(screen.getByText("No files or folders selected.")).toBeVisible();
  });

  it("[UI-CREATE-FAILURE] reports a queueing failure and leaves confirmation available", async () => {
    bridge.invoke.mockRejectedValue("creation failed");
    renderCreate();
    await goToConfirmation();
    bridge.save.mockResolvedValue("/output/archive.pna");
    await userEvent.click(
      screen.getByRole("button", { name: "Start creating" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The operation could not be completed.",
    );
    expect(screen.getByText("creation failed")).not.toBeVisible();
    expect(
      screen.getByRole("button", { name: "Start creating" }),
    ).toBeEnabled();
  });

  it("[UI-P2-CREATE-WIZARD-JOB] applies a purpose preset and starts a background create job", async () => {
    renderCreate();
    await addSource();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getByText("Choose how the archive should be created."),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: /^Backup\b/ }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    bridge.save.mockResolvedValue("/output/backup.pna");
    await userEvent.click(
      screen.getByRole("button", { name: "Start creating" }),
    );
    expect(bridge.invoke).toHaveBeenCalledWith("job_start_create", {
      request: expect.objectContaining({
        sources: ["/input.txt"],
        outputPath: "/output/backup.pna",
      }),
    });
  });

  it("[UI-P2-CREATE-CUSTOM-SETTINGS] does not label edited settings as an unchanged preset", async () => {
    renderCreate();
    await addSource();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Compression" }),
      "xz",
    );
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    const preset = screen.getByText("Preset").parentElement!;
    expect(preset).toHaveTextContent("Custom");
    expect(preset).not.toHaveTextContent("Standard");
  });

  it("[UI-UX-CREATE-REPEAT] starts a second archive without leaving the creation flow", async () => {
    renderCreate();
    await goToConfirmation();
    bridge.save.mockResolvedValueOnce("/output/first.pna");
    await userEvent.click(
      screen.getByRole("button", { name: "Start creating" }),
    );
    await screen.findByText("Creation Started");

    await addSource("/second.txt");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    bridge.save.mockResolvedValueOnce("/output/second.pna");
    await userEvent.click(
      screen.getByRole("button", { name: "Start creating" }),
    );

    expect(bridge.invoke).toHaveBeenCalledTimes(2);
    expect(bridge.invoke).toHaveBeenLastCalledWith("job_start_create", {
      request: expect.objectContaining({
        sources: ["/second.txt"],
        outputPath: "/output/second.pna",
      }),
    });
  });
});
