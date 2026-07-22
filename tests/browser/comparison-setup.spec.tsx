import { expect, test } from "@playwright/experimental-ct-react";
import ComparisonView from "../../src/features/comparison/ComparisonView";
import { I18nProvider } from "../../src/features/i18n";

test("[UI-VISUAL-COMPARE-SETUP] keeps explicit A/B identities and the read-only contract visible", async ({
  mount,
  page,
}) => {
  await mount(
    <I18nProvider>
      <ComparisonView
        initialLeft={{
          kind: "archive",
          path: "/Users/example/Backups/a-long-project-name/baseline-2026-07-19.pna",
          password: null,
        }}
        onBack={() => undefined}
      />
    </I18nProvider>,
  );

  await expect(
    page.getByRole("heading", { name: "Compare archives" }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "A — Baseline" })).toContainText(
    "baseline-2026-07-19.pna",
  );
  await expect(
    page.getByRole("group", { name: "B — Comparison" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Both sources are read only. Comparison never changes an archive or folder.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Compare A and B" }),
  ).toBeDisabled();
});

test("[UI-VISUAL-COMPARE-MINIMUM] keeps source cards inside the minimum window width", async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 820, height: 600 });
  await mount(
    <I18nProvider>
      <ComparisonView
        initialLeft={{
          kind: "archive",
          path: "/Users/example/Backups/a-long-project-name/baseline-2026-07-19.pna",
          password: null,
        }}
        onBack={() => undefined}
      />
    </I18nProvider>,
  );

  const baseline = page.getByRole("group", { name: "A — Baseline" });
  const target = page.getByRole("group", { name: "B — Comparison" });
  await expect(baseline).toBeVisible();
  await expect(target).toBeVisible();
  const baselineBox = await baseline.boundingBox();
  const targetBox = await target.boundingBox();
  expect(baselineBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  expect(baselineBox!.x).toBeGreaterThanOrEqual(0);
  expect(targetBox!.x + targetBox!.width).toBeLessThanOrEqual(820);
  expect(targetBox!.y).toBeGreaterThan(baselineBox!.y);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(820);
});

test("[UI-VISUAL-COMPARE-DETAIL-MINIMUM] keeps the final comparison fields reachable at 820 by 600", async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 820, height: 600 });
  await page.evaluate(() => {
    const internals = {
      invoke: async (command: string) => {
        if (command !== "comparison_page") return null;
        return {
          items: [
            {
              path: "documents/a-very-long-folder/report.txt",
              kind: "content_changed",
              left: {
                kind: "file",
                size: 10,
                contentSha256: "left-hash-0123456789abcdef",
                permission: "0644",
              },
              right: {
                kind: "file",
                size: 12,
                contentSha256: "right-hash-fedcba9876543210",
                permission: "0600",
              },
              metadataDifferences: [
                { field: "permission", left: "0644", right: "0600" },
              ],
            },
          ],
          nextCursor: null,
          totalCount: 1,
        };
      },
    };
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: internals,
    });
  });
  await mount(
    <I18nProvider>
      <ComparisonView
        jobId="job-minimum"
        result={{
          left: {
            kind: "archive",
            path: "/data/a.pna",
            size: 10,
            modifiedAt: 1,
            sha256: "left",
          },
          right: {
            kind: "archive",
            path: "/data/b.pna",
            size: 12,
            modifiedAt: 2,
            sha256: "right",
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
        onBack={() => undefined}
      />
    </I18nProvider>,
  );
  await page
    .getByRole("row", { name: /documents\/a-very-long-folder\/report\.txt/ })
    .click();
  const inspector = page.getByRole("complementary", {
    name: "Difference details",
  });
  await inspector
    .getByText("right-hash-fedcba9876543210")
    .scrollIntoViewIfNeeded();
  await expect(
    inspector.getByText("right-hash-fedcba9876543210"),
  ).toBeVisible();
  await inspector
    .getByRole("heading", { name: "Metadata differences" })
    .scrollIntoViewIfNeeded();
  await expect(
    inspector.getByRole("heading", { name: "Metadata differences" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(820);
});
