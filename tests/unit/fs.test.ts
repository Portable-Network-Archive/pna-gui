import { describe, expect, it, vi } from "vitest";
import { expandPath } from "../../src/utils/fs";

const joinPath = async (...parts: string[]) => parts.join("/");

describe("create source expansion", () => {
  it("[UI-CREATE-DIR-RECURSIVE] preserves full paths while recursively expanding folders", async () => {
    const readDirectory = vi.fn(async (path: string) => {
      if (path === "/root") {
        return [
          { name: "a.txt", isDirectory: false },
          { name: "nested", isDirectory: true },
        ];
      }
      if (path === "/root/nested") {
        return [{ name: "b.txt", isDirectory: false }];
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    await expect(expandPath("/root", readDirectory, joinPath)).resolves.toEqual(
      ["/root/a.txt", "/root/nested/b.txt"],
    );
  });

  it("[UI-CREATE-FILE-FALLBACK] treats a path that cannot be listed as a file", async () => {
    const readDirectory = vi
      .fn()
      .mockRejectedValue(new Error("not a directory"));
    await expect(
      expandPath("/root/file.txt", readDirectory, joinPath),
    ).resolves.toEqual(["/root/file.txt"]);
  });
});
