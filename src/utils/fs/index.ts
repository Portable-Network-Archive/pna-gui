import { FileEntry, readDir } from "@tauri-apps/api/fs";

const flatEntries = (entry: FileEntry): string[] =>
  (entry.children && entry.children.map((it) => flatEntries(it)).flat()) || [
    entry.path,
  ];

const readAllIfDir = async (path: string) => {
  try {
    const files: string[] = [];
    for (const e of await readDir(path, { recursive: true })) {
      files.push(...flatEntries(e));
    }
    return files;
  } catch {
    return [path];
  }
};

export { flatEntries, readAllIfDir };
