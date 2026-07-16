import { $, browser, expect } from "@wdio/globals";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

async function invokeTauri<T>(command: string, args?: Record<string, unknown>) {
  return browser.execute(
    async (name, payload) => {
      const internals = (
        window as typeof window & {
          __TAURI_INTERNALS__: {
            invoke: <R>(
              command: string,
              args?: Record<string, unknown>,
            ) => Promise<R>;
          };
        }
      ).__TAURI_INTERNALS__;
      return internals.invoke<T>(name, payload);
    },
    command,
    args,
  );
}

async function waitForJob(jobId: string) {
  await browser.waitUntil(
    async () => {
      const jobs =
        await invokeTauri<Array<{ id: string; status: string }>>("job_list");
      const status = jobs.find((job) => job.id === jobId)?.status;
      return (
        status === "succeeded" || status === "failed" || status === "cancelled"
      );
    },
    { timeout: 30_000, timeoutMsg: `job ${jobId} did not finish` },
  );
  const jobs =
    await invokeTauri<Array<{ id: string; status: string; error?: string }>>(
      "job_list",
    );
  return jobs.find((job) => job.id === jobId)!;
}

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

  it("creates and selectively extracts exact content through the real job IPC", async () => {
    // E2E-P2-TAURI-CREATE-JOB, E2E-P2-TAURI-EXTRACT-JOB, E2E-P2-TAURI-EXTRACT-DESTINATION,
    // E2E-UX-JOB-RESULT-OPEN, E2E-UX-JOB-DISMISS
    const runtime = resolve(import.meta.dirname, "../../.e2e/runtime");
    rmSync(runtime, { recursive: true, force: true });
    mkdirSync(runtime, { recursive: true });
    const source = resolve(runtime, "gui-created.txt");
    const archive = resolve(runtime, "gui-created.pna");
    const destination = resolve(runtime, "selected-destination");
    writeFileSync(source, "created and restored through Tauri jobs\n");

    const create = await invokeTauri<{ id: string }>("job_start_create", {
      request: {
        sources: [source],
        outputPath: archive,
        overwrite: false,
        options: {
          solid: false,
          compression: "zstd",
          encryption: "aes",
          password: "secret",
          preservePermissions: true,
          reproducible: false,
        },
      },
    });
    expect((await waitForJob(create.id)).status).toBe("succeeded");
    expect(existsSync(archive)).toBe(true);

    const openCreated = $('[data-testid="open-created-archive"]');
    await openCreated.waitForDisplayed();
    await openCreated.click();
    const createdPassword = $('input[name="archive-password"]');
    await createdPassword.waitForDisplayed();
    await createdPassword.setValue("secret");
    await $('[data-testid="archive-password-submit"]').click();
    await $('[data-testid="archive-browser"]').waitForDisplayed({
      timeout: 30_000,
    });
    const dismissCreate = $(`[data-testid="dismiss-job-${create.id}"]`);
    await dismissCreate.waitForDisplayed();
    await dismissCreate.click();
    await dismissCreate.waitForExist({ reverse: true });

    const extract = await invokeTauri<{ id: string }>("job_start_extract", {
      request: {
        archivePath: archive,
        destination,
        entries: ["gui-created.txt"],
        password: "secret",
        conflict: "ask",
        restorePermissions: true,
        keepCompletedOnCancel: true,
      },
    });
    expect((await waitForJob(extract.id)).status).toBe("succeeded");
    const restored = resolve(destination, "gui-created/gui-created.txt");
    expect(readFileSync(restored, "utf8")).toBe(
      "created and restored through Tauri jobs\n",
    );
    expect(existsSync(resolve(runtime, "gui-created", "gui-created.txt"))).toBe(
      false,
    );
  });
});
