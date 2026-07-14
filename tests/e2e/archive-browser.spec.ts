import { $, browser, expect } from "@wdio/globals";

describe("Tauri archive browser", () => {
  it("unlocks an encrypted archive and previews decrypted content through the desktop runtime", async () => {
    // E2E-TAURI-CLI-OPEN, E2E-TAURI-ENCRYPTED-PASSWORD,
    // E2E-TAURI-REAL-SEARCH, E2E-TAURI-REAL-PREVIEW,
    // E2E-TAURI-ENCRYPTED-PREVIEW, E2E-TAURI-SESSION-CLOSE
    const browserView = $('[data-testid="archive-browser"]');
    const passwordInput = $('input[type="password"]');
    await passwordInput.waitForExist({ timeout: 30_000 });
    await expect(browserView).not.toBeDisplayed();
    await passwordInput.click();
    await passwordInput.setValue("secret");
    const submit = $('button[type="submit"]');
    await submit.waitForEnabled();
    await submit.click();

    await browserView.waitForDisplayed({ timeout: 30_000 });
    await expect(browserView).toBeDisplayed();

    const tree = $('[data-testid="archive-tree"]');
    await expect(tree).toHaveText(expect.stringContaining("docs"));

    const search = $('[data-testid="archive-search"]');
    await search.setValue("readme.txt");
    await browser.execute(() => {
      document
        .querySelector<HTMLFormElement>('form[role="search"]')
        ?.requestSubmit();
    });

    const readme = $('[data-entry-path="docs/readme.txt"]');
    await readme.waitForDisplayed();
    await readme.click();

    const preview = $('[data-testid="archive-preview"]');
    await preview.waitForDisplayed();
    await expect(preview).toHaveText(
      expect.stringContaining(
        "PNA desktop E2E fixture: real Rust preview content.",
      ),
    );

    await $('[data-testid="archive-home"]').click();
    await expect($('[data-testid="home-view"]')).toBeDisplayed();
  });
});
