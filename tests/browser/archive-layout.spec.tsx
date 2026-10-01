import { test, expect } from "@playwright/experimental-ct-react";
import { Theme } from "@radix-ui/themes";
import App from "../../src/App";

test("keeps archive controls and selected rows reachable in minimum and zoomed layouts", async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 820, height: 600 });
  await page.evaluate(
    ({ lang }) => {
      Object.defineProperty(navigator, "languages", {
        configurable: true,
        value: [lang],
      });
      Object.defineProperty(navigator, "language", {
        configurable: true,
        value: lang,
      });
      const entries = [
        {
          id: "docs",
          parentId: null,
          path: "documents",
          name: "documents",
          kind: "directory",
          originalBytes: null,
          storedBytes: null,
          compression: null,
          encryption: null,
          modifiedAt: null,
          hasChildren: true,
        },
        {
          id: "report",
          parentId: null,
          path: "monthly-report-with-a-long-descriptive-file-name.txt",
          name: "monthly-report-with-a-long-descriptive-file-name.txt",
          kind: "file",
          originalBytes: 10000,
          storedBytes: 5000,
          compression: "Zstandard",
          encryption: "AES",
          modifiedAt: 1700000000,
          hasChildren: false,
        },
      ];
      const path =
        "/Users/example/Projects/project-with-a-long-name/distribution-archive.pna";
      const summary = {
        handle: "archive",
        path,
        displayName: "distribution-archive.pna",
        entryCount: 2,
        originalBytes: 10000,
        storedBytes: 5000,
        compressionMethods: ["Zstandard"],
        encryptionMethods: ["AES"],
        solid: false,
        fileModifiedAt: 1700000000,
      };
      let id = 0;
      const internals = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback: () => ++id,
        unregisterCallback: () => {},
        invoke: async (
          command: string,
          args: {
            password?: string;
            filter?: unknown;
            parentEntryId?: string;
            entryId?: string;
          },
        ) => {
          if (command === "app_bootstrap")
            return {
              productName: "Portable Network Archive",
              recent: [
                {
                  path,
                  displayName: summary.displayName,
                  entryCount: 2,
                  storedBytes: 5000,
                  lastOpenedAt: 1700000000,
                },
              ],
            };
          if (command === "plugin:cli|cli_matches")
            return { args: {}, subcommand: null };
          if (command === "plugin:event|listen") return ++id;
          if (command === "archive_open") {
            if (!args.password)
              throw {
                code: "PASSWORD_REQUIRED",
                message: "Password required",
                retryable: true,
              };
            return { handle: "archive", summary };
          }
          if (command === "archive_children")
            return {
              items: args.filter
                ? entries.filter((e) => e.kind === "directory")
                : args.parentEntryId
                  ? []
                  : entries,
              nextCursor: null,
              totalCount: 2,
            };
          if (command === "archive_entry_details")
            return {
              entry: entries.find((e) => e.id === args.entryId),
              createdAt: null,
              accessedAt: null,
              permission: "0644",
              owner: null,
              group: null,
              xattrCount: 0,
            };
          if (command === "archive_preview")
            return {
              kind: "text",
              text: "Quarterly report\nRevenue and expenses\nLong text content to inspect.",
              truncated: false,
            };
          if (command === "job_list")
            return [
              {
                id: "job-1",
                kind: "create",
                status: "running",
                phase: "writing",
                completedUnits: 0,
                totalUnits: 2,
                completedBytes: 73400320,
                totalBytes: 104857600,
                currentItem:
                  "/Users/example/Projects/project-with-a-long-name/a-large-video-file.mp4",
                createdAt: 1700000000,
                updatedAt: 1700000001,
                warnings: [],
              },
            ];
          return null;
        },
      };
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        configurable: true,
        value: internals,
      });
      Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
        configurable: true,
        value: { unregisterListener: () => {} },
      });
    },
    { lang: "en-US" },
  );
  await mount(
    <Theme appearance="light" accentColor="blue" grayColor="slate">
      <App />
    </Theme>,
  );

  await page.getByRole("button", { name: /^distribution-archive.pna/ }).click();
  await page.getByRole("dialog").locator("input[type=password]").fill("secret");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Open", exact: true })
    .click();
  await page.getByTestId("archive-browser").waitFor();
  const insideViewport = async (locator: ReturnType<typeof page.getByRole>) => {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    const viewport = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  };
  for (const [width, height] of [
    [820, 600],
    [640, 380],
  ]) {
    await page.setViewportSize({ width, height });
    const row = page.getByRole("row").filter({ hasText: "documents" }).last();
    await row.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await expect(row).toHaveAttribute("aria-selected", "true");
    await insideViewport(row.getByText("documents", { exact: true }));
    for (const control of [
      page.getByRole("button", { name: "Search", exact: true }),
      page.getByRole("button", { name: "Details", exact: true }),
      page.getByRole("button", { name: "Cancel job", exact: true }),
    ])
      await insideViewport(control);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.getByRole("button", { name: "Details", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Inspector" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Extract", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Extract archive" });
    await expect(dialog.locator("input[type=password]")).toHaveValue("secret");
    const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
    await cancel.scrollIntoViewIfNeeded();
    await insideViewport(cancel);
    await cancel.click();
  }
});
