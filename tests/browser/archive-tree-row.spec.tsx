import { expect, test } from "@playwright/experimental-ct-react";
import { ArchiveTreeRow } from "../../src/features/archive/ArchiveTreeRow";

test("[UI-VISUAL-TREE] keeps the folder icon bounded and the tree label visible", async ({
  mount,
}) => {
  const longName = "a-very-long-directory-name-that-must-remain-readable";
  const component = await mount(
    <div style={{ width: 190 }}>
      <ArchiveTreeRow
        active={false}
        expanded={false}
        name={longName}
        collapseLabel="Collapse"
        expandLabel="Expand"
        onNavigate={() => undefined}
        onToggle={() => undefined}
      />
    </div>,
  );

  const nameButton = component.getByRole("button", {
    name: longName,
    exact: true,
  });
  const label = nameButton.locator("span");
  const icon = nameButton.locator("svg");

  await expect(nameButton).toBeVisible();
  await expect(label).toHaveText(longName);
  await expect(label).toBeVisible();
  await expect(icon).toBeVisible();
  expect(
    await icon.evaluate((node) => node.getBoundingClientRect().width),
  ).toBe(16);
  expect(
    await icon.evaluate((node) => node.getBoundingClientRect().height),
  ).toBe(16);
  expect(
    await label.evaluate((node) => node.getBoundingClientRect().width),
  ).toBeGreaterThan(0);
});

test("[UI-VISUAL-TREE-EXPANDED] exposes the expanded tree state without hiding its name", async ({
  mount,
}) => {
  const component = await mount(
    <ArchiveTreeRow
      active
      expanded
      name="src"
      collapseLabel="Collapse"
      expandLabel="Expand"
      onNavigate={() => undefined}
      onToggle={() => undefined}
    />,
  );

  await expect(
    component.getByRole("button", { name: "src: Collapse" }),
  ).toBeVisible();
  await expect(
    component.getByRole("button", { name: "src", exact: true }),
  ).toBeVisible();
});
