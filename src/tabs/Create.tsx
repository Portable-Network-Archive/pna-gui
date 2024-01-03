import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { appWindow } from "@tauri-apps/api/window";
import { desktopDir } from "@tauri-apps/api/path";
import { readAllIfDir } from "../utils/fs";
import { CubeIcon, FileIcon, Cross2Icon } from "@radix-ui/react-icons";
import ProcessingIcon from "../components/ProcessingIcon";
import Button from "../components/Button";
import * as Dialog from "../components/Dialog";
import * as FileList from "../components/FileList";
import styles from "./Create.module.css";

const EVENT_ON_FILE_PICKED = "on_file_picked";
const EVENT_ON_SAVE_DIR_PICKED = "on_save_dir_picked";
const EVENT_ON_FINISH = "on_finish";
const EVENT_ON_ENTRY_START = "on_entry_start";

const VALUE_OTHER = "other";
const VALUE_DESKTOP = "desktop";

const SPECIAL_SAVE_PLACE = [
  {
    display: "Desktop",
    value: VALUE_DESKTOP,
  },
  {
    display: "Other",
    value: VALUE_OTHER,
  },
];

const COMPRESSION = ["none", "zlib", "zstd", "xz"] as const;
type Compression = (typeof COMPRESSION)[number];

export default function Create() {
  const [files, setFiles] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [processing, setProcessing] = useState(false);
  const [compression, setCompression] = useState<Compression>("zstd");
  const [saveSelectOptions, setSaveSelectOptions] = useState(
    SPECIAL_SAVE_PLACE.map((it) => {
      return { selected: false, ...it };
    }),
  );
  const [saveDir, _setSaveDir] = useState<string | null>(null);
  const saveDirRef = useRef<HTMLSelectElement>(null);

  const setSaveDir = async (value: string) => {
    if (value === VALUE_DESKTOP) {
      _setSaveDir(await desktopDir());
    } else {
      _setSaveDir(value);
    }
  };

  const addFiles = async (paths: string[]) => {
    let files: string[] = [];
    for (const path of paths) {
      files.push(...(await readAllIfDir(path)));
    }
    setFiles((current) => {
      return [...current, ...files];
    });
  };

  const openFilePicker = () => {
    if (processing) {
      return;
    }
    invoke("open_files_picker", { event: EVENT_ON_FILE_PICKED });
  };

  const openDirPicker = () => {
    if (processing) {
      return;
    }
    invoke("open_dir_picker", { event: EVENT_ON_SAVE_DIR_PICKED });
  };

  const onSelectSaveDir = () => {
    const selected = saveDirRef.current?.selectedOptions;
    if (selected === undefined || selected.length === 0) {
      return;
    }
    if (selected.item(0)?.value === VALUE_OTHER) {
      setSaveSelectOptions((old) =>
        old.map((it) => {
          return { ...it, selected: false };
        }),
      );
      openDirPicker();
    }
  };

  const create = async () => {
    setProcessing(true);
    // Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
    invoke("create", {
      archiveFinishEvent: EVENT_ON_FINISH,
      entryStartEvent: EVENT_ON_ENTRY_START,
      name: "archive.pna",
      files,
      saveDir: saveDir || (await desktopDir()),
      option: {
        compression,
      },
    })
      .then(() => {
        setProcessing(false);
      })
      .catch((err) => {
        window.alert(err);
        setProcessing(false);
      });
  };

  useEffect(() => {
    const unlisten = appWindow.onFileDropEvent((e) => {
      if (e.payload.type !== "drop") {
        return;
      }
      addFiles(e.payload.paths);
    });
    return () => {
      unlisten.then((it) => it());
    };
  }, []);

  useEffect(() => {
    const unlisten = appWindow.listen<string>(EVENT_ON_ENTRY_START, (e) => {
      setName(e.payload);
    });
    return () => {
      unlisten.then((it) => it());
    };
  }, []);

  useEffect(() => {
    const unlisten = appWindow.listen<string[]>(EVENT_ON_FILE_PICKED, (e) => {
      addFiles(e.payload);
    });
    return () => {
      unlisten.then((it) => it());
    };
  }, []);

  useEffect(() => {
    const unlisten = appWindow.listen<string>(EVENT_ON_SAVE_DIR_PICKED, (e) => {
      const current = saveDirRef.current;
      if (current === null) {
        return;
      }
      setSaveSelectOptions([
        { value: e.payload, display: e.payload, selected: true },
        ...SPECIAL_SAVE_PLACE.map((it) => {
          return { selected: false, ...it };
        }),
      ]);
    });
    return () => {
      unlisten.then((it) => it());
    };
  }, []);

  useEffect(() => {
    const unlisten = appWindow.listen<string>(EVENT_ON_FINISH, () => {
      setFiles([]);
    });
    return () => {
      unlisten.then((it) => it());
    };
  }, []);

  useEffect(() => {
    desktopDir().then(setSaveDir);
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.rowFull}>
        <div className={styles.FilePathBar}>
          <Dialog.Root>
            <Dialog.Trigger asChild>
              <FileIcon className={styles.Icon} />
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay />
              <Dialog.Content>
                <Dialog.Title>Save Path</Dialog.Title>
                <Dialog.Description>Change to save path.</Dialog.Description>
                <fieldset className={`${styles.Fieldset}`}>
                  <label className={`${styles.Label}`} htmlFor="save">
                    Save to
                  </label>
                  <select ref={saveDirRef} id="save" onChange={onSelectSaveDir}>
                    {saveSelectOptions.map((it) => (
                      <option
                        key={it.value}
                        value={it.value}
                        selected={it.selected}
                      >
                        {it.display}
                      </option>
                    ))}
                  </select>
                </fieldset>
                <div className={`${styles.SaveButtonContainer}`}>
                  <Dialog.Close
                    asChild
                    onClick={async () => {
                      const current = saveDirRef.current;
                      if (current === null) {
                        return;
                      }
                      setSaveDir(current.value);
                    }}
                  >
                    <Button>Save changes</Button>
                  </Dialog.Close>
                </div>
                <Dialog.Close asChild>
                  <button className={`${styles.IconButton}`} aria-label="Close">
                    <Cross2Icon />
                  </button>
                </Dialog.Close>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <span className={styles.FilePath}>{saveDir}</span>
        </div>
      </div>
      <div className={styles.titleRow}>
        <h1>
          <span className="clickable" onClick={() => openFilePicker()}>
            <b>Drop here to add to Archive</b>
          </span>
        </h1>
      </div>
      <div className={styles.fileListRow}>
        <FileList.Root className={styles.FileList}>
          {files.map((it) => (
            <FileList.Item key={it} className={styles.FileListItem}>
              {processing && it == name && (
                <span className={styles.Icon}>
                  <ProcessingIcon />
                </span>
              )}
              <span>{it}</span>
            </FileList.Item>
          ))}
        </FileList.Root>
      </div>
      <div className={styles.rowFull}>
        <details>
          <summary>Detail options</summary>
          <span>
            <label htmlFor="compression">Compression</label>
            <select
              id="compression"
              value={compression}
              onChange={(e) => setCompression(e.target.value as Compression)}
            >
              {COMPRESSION.map((it) => (
                <option key={it} value={it}>
                  {it}
                </option>
              ))}
            </select>
          </span>
        </details>
      </div>
      <div className={styles.rowFull}>
        <Button icon={<CubeIcon />} onClick={create}>
          <span>Create</span>
        </Button>
      </div>
    </div>
  );
}
