import { join } from "@tauri-apps/api/path";
import { readDir, type DirEntry } from "@tauri-apps/plugin-fs";

type ReadDirectory = (path: string) => Promise<DirEntry[]>;
type JoinPath = (...paths: string[]) => Promise<string>;

const expandPath = async (
  path: string,
  readDirectory: ReadDirectory,
  joinPath: JoinPath,
): Promise<string[]> => {
  try {
    const files: string[] = [];
    for (const entry of await readDirectory(path)) {
      const fullPath = await joinPath(path, entry.name);
      files.push(
        ...(entry.isDirectory
          ? await expandPath(fullPath, readDirectory, joinPath)
          : [fullPath]),
      );
    }
    return files;
  } catch {
    return [path];
  }
};

const readAllIfDir = (path: string) => expandPath(path, readDir, join);

export { expandPath, readAllIfDir };
