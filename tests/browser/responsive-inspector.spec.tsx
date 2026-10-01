import { expect, test } from "@playwright/experimental-ct-react";
import { Theme } from "@radix-ui/themes";
import ResponsiveInspector from "../../src/components/ResponsiveInspector";
import { I18nProvider } from "../../src/features/i18n";
import styles from "../../src/App.module.css";

test("keeps details accessible through narrow layouts and restores focus after closing or widening", async ({
  mount,
  page,
}) => {
  await mount(
    <Theme>
      <I18nProvider>
        <ResponsiveInspector label="Inspector" className={styles.inspector}>
          <h2>Selected item</h2>
          <strong>report.txt</strong>
          <dl>
            <dt>Original size</dt>
            <dd>12 KB</dd>
            {Array.from({ length: 16 }, (_, index) => (
              <div key={index}>
                <dt>Property {index}</dt>
                <dd>Value {index}</dd>
              </div>
            ))}
          </dl>
          <pre>Report content</pre>
        </ResponsiveInspector>
      </I18nProvider>
    </Theme>,
  );
  const inline = page.getByRole("complementary", { name: "Inspector" });
  await expect(inline.getByText("report.txt")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Details", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 900, height: 450 });
  const trigger = page.getByRole("button", { name: "Details", exact: true });
  await expect(trigger).toBeVisible();
  await expect(inline).toHaveCount(0);
  await trigger.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog", { name: "Inspector" });
  await expect(panel.getByText("report.txt")).toBeVisible();
  await expect(panel.getByText("12 KB")).toBeVisible();
  await expect(panel.getByText("Report content")).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Close details" }),
  ).toBeFocused();
  await panel.getByText("Value 15").scrollIntoViewIfNeeded();
  await expect(panel.getByText("Value 15")).toBeVisible();
  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(450);

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(panel).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(panel).toHaveCount(0);
  await expect(inline.getByText("report.txt")).toBeVisible();
  await expect(inline).toBeFocused();
});
