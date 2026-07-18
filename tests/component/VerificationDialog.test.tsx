import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../src/features/i18n";
import VerificationDialog from "../../src/features/verification/VerificationDialog";
import VerificationResultsDialog from "../../src/features/verification/VerificationResultsDialog";
import type { VerificationReport } from "../../src/features/jobs/api";

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: bridge.open }));

function exportableReport(): VerificationReport {
  return {
    archivePath: "/archives/project.pna",
    sourceSize: 8192,
    sourceModifiedAt: 1784160000,
    sourceSha256:
      "f1a5a48b3b1f91208b982163be46f3a865f157989a4a195c6806144c4f8f23ac",
    completedAt: 1784160300,
    mode: "complete",
    conclusion: "passed",
    encrypted: false,
    solid: false,
    entriesChecked: 1,
    filesChecked: 1,
    bytesChecked: 4096,
    failedChecks: 0,
    notCheckedChecks: 0,
    checksOmitted: 0,
    checks: [],
  };
}

describe("archive verification dialog", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      value: ["en-US"],
    });
    bridge.invoke
      .mockReset()
      .mockImplementation((command: string) =>
        Promise.resolve(
          command === "verification_source_matches"
            ? true
            : { id: "job-verify", kind: "verify", status: "queued" },
        ),
      );
    bridge.open.mockReset().mockResolvedValue(null);
  });

  it("[UI-VERIFY-RESULT-EVIDENCE] shows factual counts and every check without a safety score", async () => {
    bridge.invoke.mockResolvedValueOnce(false);
    const report: VerificationReport = {
      archivePath: "/archives/project.pna",
      sourceSize: 8192,
      sourceModifiedAt: 1784160000,
      sourceSha256:
        "f1a5a48b3b1f91208b982163be46f3a865f157989a4a195c6806144c4f8f23ac",
      completedAt: 1784160300,
      mode: "complete",
      conclusion: "incomplete",
      encrypted: true,
      solid: false,
      entriesChecked: 3,
      filesChecked: 2,
      bytesChecked: 4096,
      failedChecks: 0,
      notCheckedChecks: 1,
      checksOmitted: 12,
      checks: [
        {
          code: "archive_header",
          status: "passed",
          entryPath: null,
          detail: null,
        },
        {
          code: "file_contents",
          status: "not_checked",
          entryPath: "legacy.bin",
          detail:
            "Encrypted uncompressed content has no plaintext integrity metadata.",
        },
      ],
    };
    render(
      <I18nProvider>
        <VerificationResultsDialog
          open
          jobId="job-verify-report"
          report={report}
          onOpenChange={() => undefined}
        />
      </I18nProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: "Verification results" });
    expect(dialog).toHaveTextContent("Some content could not be checked");
    expect(dialog).toHaveTextContent("3");
    expect(dialog).toHaveTextContent("2");
    expect(dialog).toHaveTextContent("4 KB");
    expect(dialog).toHaveTextContent("Archive header");
    expect(dialog).toHaveTextContent("legacy.bin");
    expect(dialog).toHaveTextContent("Not checked");
    expect(dialog).toHaveTextContent("12 additional checks are not shown");
    expect(
      await screen.findByText(
        "This archive has changed since this result was recorded.",
      ),
    ).toBeVisible();
    expect(dialog).not.toHaveTextContent(/risk|score|safe|danger/iu);
  });

  it("[UI-VERIFY-MODE-CONTRACT] explains the selected scope and queues complete verification", async () => {
    const onOpenChange = vi.fn();
    render(
      <I18nProvider>
        <VerificationDialog
          open
          archivePath="/archives/project.pna"
          archiveName="project.pna"
          encrypted={false}
          onOpenChange={onOpenChange}
        />
      </I18nProvider>,
    );

    expect(
      screen.getByText(
        "Checks the PNA structure and chunk CRCs without reading file contents.",
      ),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("radio", { name: "Content verification" }),
    );
    expect(
      screen.getByText(
        "Reads every verifiable file through decryption and decompression without writing files; content that cannot be verified is reported as not checked. File attributes and restore destinations are not tested.",
      ),
    ).toBeVisible();
    await userEvent.keyboard("{Enter}");

    expect(bridge.invoke).toHaveBeenCalledWith("job_start_verify", {
      request: {
        archivePath: "/archives/project.pna",
        password: null,
        mode: "complete",
      },
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("[UI-VERIFY-START-ERROR-RECOVERY] keeps the dialog open with the failure when the job cannot start", async () => {
    bridge.invoke.mockRejectedValueOnce(new Error("archive is locked"));
    const onOpenChange = vi.fn();
    render(
      <I18nProvider>
        <VerificationDialog
          open
          archivePath="/archives/project.pna"
          archiveName="project.pna"
          encrypted={false}
          onOpenChange={onOpenChange}
        />
      </I18nProvider>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Start verification" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "archive is locked",
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Start verification" }),
    ).toBeEnabled();
  });

  it("[UI-VERIFY-SINGLE-SUBMISSION] starts one verification when the form is submitted twice before React rerenders", () => {
    let resolveStart: (() => void) | undefined;
    bridge.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStart = () =>
            resolve({ id: "job-verify", kind: "verify", status: "queued" });
        }),
    );
    render(
      <I18nProvider>
        <VerificationDialog
          open
          archivePath="/archives/project.pna"
          archiveName="project.pna"
          encrypted={false}
          onOpenChange={() => undefined}
        />
      </I18nProvider>,
    );

    const form = screen
      .getByRole("button", { name: "Start verification" })
      .closest("form");
    expect(form).not.toBeNull();
    act(() => {
      form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(bridge.invoke).toHaveBeenCalledTimes(1);
    resolveStart?.();
  });

  it("[UI-VERIFY-RESULT-FRESHNESS-UNKNOWN] says when freshness could not be confirmed instead of implying an unchanged source", async () => {
    bridge.invoke.mockRejectedValueOnce(new Error("permission denied"));
    const report: VerificationReport = {
      archivePath: "/archives/project.pna",
      sourceSize: 8192,
      sourceModifiedAt: 1784160000,
      sourceSha256:
        "f1a5a48b3b1f91208b982163be46f3a865f157989a4a195c6806144c4f8f23ac",
      completedAt: 1784160300,
      mode: "quick",
      conclusion: "passed",
      encrypted: false,
      solid: false,
      entriesChecked: 1,
      filesChecked: 0,
      bytesChecked: 0,
      failedChecks: 0,
      notCheckedChecks: 1,
      checksOmitted: 0,
      checks: [],
    };
    render(
      <I18nProvider>
        <VerificationResultsDialog
          open
          jobId="job-verify-report"
          report={report}
          onOpenChange={() => undefined}
        />
      </I18nProvider>,
    );

    expect(
      await screen.findByText(
        "Could not confirm whether the archive has changed since this result was recorded.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(
        "This archive has changed since this result was recorded.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByText("permission denied")).not.toBeVisible();
  });

  it("[UI-REPORT-EXPORT-DISCOVERY] saves the selected format and keeps the exact output discoverable", async () => {
    const directory = "/Users/example/Documents";
    const destination = `${directory}/project-verification.json`;
    bridge.open.mockResolvedValueOnce(directory);
    bridge.invoke
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({ path: destination })
      .mockResolvedValueOnce(undefined);
    const report = exportableReport();
    render(
      <I18nProvider>
        <VerificationResultsDialog
          open
          jobId="job-verify-report"
          report={report}
          onOpenChange={() => undefined}
        />
      </I18nProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Save report" }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: "JSON — Automation" }),
    );

    expect(bridge.open).toHaveBeenCalledWith(
      expect.objectContaining({
        directory: true,
        multiple: false,
      }),
    );
    expect(bridge.invoke).toHaveBeenCalledWith("report_export_verification", {
      request: {
        jobId: "job-verify-report",
        format: "json",
        directory,
        locale: "en",
      },
    });
    expect(await screen.findByRole("status")).toHaveTextContent(destination);
    await userEvent.click(
      screen.getByRole("button", { name: "Open containing folder" }),
    );
    expect(bridge.invoke).toHaveBeenCalledWith("report_reveal_export", {
      path: destination,
    });
    expect(
      screen.getByRole("dialog", { name: "Verification results" }),
    ).toBeVisible();
  });

  it("[UI-REPORT-FORMAT-GUIDANCE] presents HTML for reading before JSON for automation", async () => {
    render(
      <I18nProvider>
        <VerificationResultsDialog
          open
          jobId="job-verify-report"
          report={exportableReport()}
          onOpenChange={() => undefined}
        />
      </I18nProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Save report" }));

    const items = screen.getAllByRole("menuitem");
    const htmlIndex = items.findIndex(
      (item) => item.textContent === "HTML — Read and share",
    );
    const jsonIndex = items.findIndex(
      (item) => item.textContent === "JSON — Automation",
    );
    expect(htmlIndex).toBeGreaterThanOrEqual(0);
    expect(jsonIndex).toBeGreaterThanOrEqual(0);
    expect(htmlIndex).toBeLessThan(jsonIndex);
  });

  it("[UI-REPORT-FRESHNESS-GATE] does not export while source freshness is still being checked", () => {
    bridge.invoke.mockImplementation((command: string) =>
      command === "verification_source_matches"
        ? new Promise(() => undefined)
        : Promise.resolve(undefined),
    );
    render(
      <I18nProvider>
        <VerificationResultsDialog
          open
          jobId="job-verify-report"
          report={exportableReport()}
          onOpenChange={() => undefined}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole("button", { name: "Save report" })).toBeDisabled();
  });

  it("[UI-REPORT-EXPORT-ERROR-RECOVERY] explains a save conflict without closing or losing the result", async () => {
    bridge.open.mockResolvedValueOnce("/Users/example/Documents");
    bridge.invoke.mockImplementation((command: string) => {
      if (command === "verification_source_matches")
        return Promise.resolve(true);
      if (command === "report_export_verification")
        return Promise.reject({
          code: "conflict",
          message: "file exists",
        });
      return Promise.resolve(undefined);
    });
    render(
      <I18nProvider>
        <VerificationResultsDialog
          open
          jobId="job-verify-report"
          report={exportableReport()}
          onOpenChange={() => undefined}
        />
      </I18nProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Save report" }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: "JSON — Automation" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The report folder changed while saving.",
    );
    await userEvent.click(
      screen.getByText("Technical details", { selector: "summary" }),
    );
    expect(
      screen.getByText("file exists", { selector: "small" }),
    ).toBeVisible();
    expect(
      screen.getByRole("dialog", { name: "Verification results" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Save report" })).toBeEnabled();
  });

  it("[UI-REPORT-EXPORT-CANCEL-KEEPS-ERROR] keeps a previous export error visible when the save dialog is cancelled", async () => {
    bridge.open.mockResolvedValueOnce("/Users/example/Documents");
    bridge.invoke.mockImplementation((command: string) => {
      if (command === "verification_source_matches")
        return Promise.resolve(true);
      if (command === "report_export_verification")
        return Promise.reject({
          code: "conflict",
          message: "file exists",
        });
      return Promise.resolve(undefined);
    });
    render(
      <I18nProvider>
        <VerificationResultsDialog
          open
          jobId="job-verify-report"
          report={exportableReport()}
          onOpenChange={() => undefined}
        />
      </I18nProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Save report" }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: "JSON — Automation" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The report folder changed while saving.",
    );

    bridge.open.mockResolvedValueOnce(null);
    await userEvent.click(screen.getByRole("button", { name: "Save report" }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: "JSON — Automation" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The report folder changed while saving.",
    );
  });

  it("[UI-REPORT-EXPORT-CANCEL] leaves the result unchanged when the native save dialog is cancelled", async () => {
    bridge.open.mockResolvedValueOnce(null);
    render(
      <I18nProvider>
        <VerificationResultsDialog
          open
          jobId="job-verify-report"
          report={exportableReport()}
          onOpenChange={() => undefined}
        />
      </I18nProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Save report" }));
    await userEvent.click(
      screen.getByRole("menuitem", { name: "HTML — Read and share" }),
    );

    expect(bridge.invoke).not.toHaveBeenCalledWith(
      "report_export_verification",
      expect.anything(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Verification results" }),
    ).toBeVisible();
  });

  it("[UI-VERIFY-ENCRYPTED-PASSWORD] requires a password only when encrypted content will be read", async () => {
    render(
      <I18nProvider>
        <VerificationDialog
          open
          archivePath="/archives/encrypted.pna"
          archiveName="encrypted.pna"
          encrypted
          onOpenChange={() => undefined}
        />
      </I18nProvider>,
    );

    const start = screen.getByRole("button", { name: "Start verification" });
    expect(start).toBeEnabled();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("radio", { name: "Content verification" }),
    );
    expect(start).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Password"), "secret");
    expect(start).toBeEnabled();
    await userEvent.click(start);
    expect(bridge.invoke).toHaveBeenCalledWith("job_start_verify", {
      request: {
        archivePath: "/archives/encrypted.pna",
        password: "secret",
        mode: "complete",
      },
    });
  });
});
