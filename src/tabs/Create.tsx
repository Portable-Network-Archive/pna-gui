import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { appWindow } from "@tauri-apps/api/window";

const EVENT_ON_FILE_PICKED = "on_file_picked";

export default function Create() {
  const [files, setFiles] = useState<string[]>([]);
  const [name, setName] = useState("archive.pna");
  const [processing, setProcessing] = useState(false);

  const addFiles = (paths: string[]) => {
    setFiles((current) => {
      return [...current, ...paths];
    });
  };

  const openFilePicker = () => {
    if (processing) {
      return;
    }
    invoke("open_files_picker", { event: EVENT_ON_FILE_PICKED });
  };

  const create = () => {
    setProcessing(true);
    // Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
    invoke("create", { name, files })
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
    const unlisten = appWindow.listen<string>("create_processing", (e) => {
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

  return (
    <div className="container">
      <div className="row">
        <div className="container">
          {files.map((it) => (
            <div key={it} className="row">
              <span>{it}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="row">
        <h1>
          <span onClick={() => openFilePicker()}>
            <b>Drop here to add to PNA file.</b>
          </span>
        </h1>
      </div>
      <div className="row">
        <button onClick={() => create()}>Create</button>
      </div>
    </div>
  );
}
