import { expect, test } from "@playwright/experimental-ct-react";
import { I18nProvider } from "../../src/features/i18n";
import VerificationResultsDialog from "../../src/features/verification/VerificationResultsDialog";

test("[UI-VISUAL-VERIFY-RESULTS] keeps factual evidence readable at desktop dialog sizes", async ({
  mount,
  page,
}) => {
  await mount(
    <I18nProvider>
      <VerificationResultsDialog
        open
        jobId="job-browser-report"
        onOpenChange={() => undefined}
        report={{
          archivePath:
            "/Users/example/Backups/a-long-project-name/archive-2026-07-16.pna",
          sourceSize: 5368713216,
          sourceModifiedAt: 1784160000,
          sourceSha256:
            "f1a5a48b3b1f91208b982163be46f3a865f157989a4a195c6806144c4f8f23ac",
          completedAt: 1784160300,
          mode: "complete",
          conclusion: "incomplete",
          encrypted: true,
          solid: false,
          entriesChecked: 1200,
          filesChecked: 1188,
          bytesChecked: 5368709120,
          failedChecks: 0,
          notCheckedChecks: 1,
          checksOmitted: 418,
          checks: Array.from({ length: 18 }, (_, index) => ({
            code: index === 17 ? "file_contents" : "entry_structure",
            status: index === 17 ? "not_checked" : "passed",
            entryPath: `documents/quarter-${index + 1}/report.txt`,
            detail:
              index === 17
                ? "Encrypted uncompressed content has no plaintext integrity metadata."
                : null,
          })),
        }}
      />
    </I18nProvider>,
  );

  const dialog = page.getByRole("dialog", { name: "Verification results" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("Some content could not be checked"),
  ).toBeVisible();
  await expect(dialog.getByRole("list").getByText("Not checked")).toBeVisible();
  await expect(
    dialog.getByText(
      "Encrypted uncompressed content has no plaintext integrity metadata.",
    ),
  ).not.toBeVisible();
  await dialog.getByRole("list").getByText("Technical details").click();
  await expect(
    dialog.getByText(
      "Encrypted uncompressed content has no plaintext integrity metadata.",
    ),
  ).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(680);
  expect(box?.height).toBeLessThanOrEqual(720);
  // UI-VISUAL-REPORT-ACTIONS
  await expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Save report" }),
  ).toBeVisible();
});
