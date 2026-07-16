import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../src/features/i18n";
import VerificationDialog from "../../src/features/verification/VerificationDialog";
import VerificationResultsDialog from "../../src/features/verification/VerificationResultsDialog";
import type { VerificationReport } from "../../src/features/jobs/api";

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));

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
  });

  it("[UI-VERIFY-RESULT-EVIDENCE] shows factual counts and every check without a safety score", async () => {
    bridge.invoke.mockResolvedValueOnce(false);
    const report: VerificationReport = {
      archivePath: "/archives/project.pna",
      sourceSize: 8192,
      sourceModifiedAt: 1784160000,
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

  it("[UI-VERIFY-RESULT-FRESHNESS-UNKNOWN] says when freshness could not be confirmed instead of implying an unchanged source", async () => {
    bridge.invoke.mockRejectedValueOnce(new Error("permission denied"));
    const report: VerificationReport = {
      archivePath: "/archives/project.pna",
      sourceSize: 8192,
      sourceModifiedAt: 1784160000,
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
    expect(screen.getByText("permission denied")).toBeVisible();
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
