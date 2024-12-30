import { readDir, DirEntry } from "@tauri-apps/plugin-fs";

const flatEntries = async (entry: DirEntry): Promise<string[]> => {
  return new Promise(async (resolve, reject) => {
    try {
      resolve(
        entry.isDirectory ? await readAllIfDir(entry.name) : [entry.name],
      );
    } catch (e) {
      reject(e);
    }
  });
};

const readAllIfDir = async (path: string) => {
  try {
    const files: string[] = [];
    for (const e of await readDir(path)) {
      files.push(...(await flatEntries(e)));
    }
    return files;
  } catch {
    return [path];
  }
};

export { readAllIfDir };
