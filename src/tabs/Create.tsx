import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { appWindow } from "@tauri-apps/api/window";
import { desktopDir } from "@tauri-apps/api/path";
import { readAllIfDir } from "../utils/fs";

const EVENT_ON_FILE_PICKED = "on_file_picked";
const EVENT_ON_SAVE_DIR_PICKED = "on_save_dir_picked";
const EVENT_ON_FINISH = "on_finish";
const EVENT_ON_ENTRY_START = "on_entry_start";

const VALUE_OTHER = "other";
const VALUE_DESKTOP = "desktop";

export default function Create() {
  const [files, setFiles] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [processing, setProcessing] = useState(false);
  const [saveDir, setSaveDir] = useState<string | null>(null);
  const saveDirRef = useRef<HTMLSelectElement>(null);

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
      openDirPicker();
    } else {
      setSaveDir(null);
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
      setSaveDir(e.payload);
      const current = saveDirRef.current;
      if (current === null) {
        return;
      }
      for (let index = 0; index < current.options.length; index++) {
        current.options[index].selected =
          current.options[index].value === e.payload;
      }
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

  return (
    <div className="container">
      <div className="row">
        <h1>
          <span className="clickable" onClick={() => openFilePicker()}>
            <b>Drop here to add to Archive</b>
          </span>
        </h1>
      </div>
      <div className="row">
        <ul className="file_list">
          {files.map((it) => (
            <li key={it} className="file_item">
              <span>{it}</span>
              {processing && it == name && <span>processing</span>}
            </li>
          ))}
        </ul>
      </div>
      <div className="row">
        <span>
          <label htmlFor="save">Save to</label>
          <select ref={saveDirRef} id="save" onChange={onSelectSaveDir}>
            {saveDir && (
              <option value={saveDir} selected>
                {saveDir}
              </option>
            )}
            {saveDir && <hr></hr>}
            <option value={VALUE_DESKTOP}>Desktop</option>
            <hr></hr>
            <option value={VALUE_OTHER}>Other</option>
          </select>
        </span>
        <button onClick={create}>Create</button>
      </div>
    </div>
  );
}
