import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { appWindow } from "@tauri-apps/api/window";

const EVENT_ON_FILE_PICKED = "on_file_picked";
const EVENT_ON_START_PROCESS_ENTRY = "extract_processing";

export default function Extract() {
  const [name, setName] = useState("");
  const [processing, setProcessing] = useState(false);

  const extract = (path: string) => {
    setProcessing(true);
    // Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
    invoke("extract", { path, event: EVENT_ON_START_PROCESS_ENTRY })
      .then(() => {
        setProcessing(false);
      })
      .catch((err) => {
        window.alert(err);
        setProcessing(false);
      });
  };

  const openFilePicker = () => {
    if (processing) {
      return;
    }
    invoke("open_file_picker", { event: EVENT_ON_FILE_PICKED });
  };

  useEffect(() => {
    const unlisten = appWindow.onFileDropEvent((e) => {
      if (e.payload.type !== "drop") {
        return;
      }
      for (const path of e.payload.paths) {
        extract(path);
      }
    });
    return () => {
      unlisten.then((it) => it());
    };
  }, []);

  useEffect(() => {
    const unlisten = appWindow.listen<string>(
      EVENT_ON_START_PROCESS_ENTRY,
      (e) => {
        setName(e.payload);
      },
    );
    return () => {
      unlisten.then((it) => it());
    };
  }, []);

  useEffect(() => {
    const unlisten = appWindow.listen<string>(EVENT_ON_FILE_PICKED, (e) => {
      extract(e.payload);
    });
    return () => {
      unlisten.then((it) => it());
    };
  }, []);

  return (
    <div className="container">
      <div className="row">
        <span onClick={() => openFilePicker()}>
          <img src="/pna.svg" className="logo vite" alt="PNA logo" />
        </span>
      </div>
      {processing && <div className="row">Extracting {name} ...</div>}

      {!processing && (
        <div className="row">
          <h1>
            <span className="clickable" onClick={() => openFilePicker()}>
              <b>Drop here to extract Archive</b>
            </span>
          </h1>
        </div>
      )}
    </div>
  );
}
