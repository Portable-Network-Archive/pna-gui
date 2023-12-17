import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { appWindow } from "@tauri-apps/api/window";

export default function Create() {
  const [files, setFiles] = useState<string[]>([]);
  const [name, setName] = useState("archive.pna");
  const [processing, setProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (paths:string[]) => {
    setFiles((current) => {
      return [...current, ...paths];
    })
  }

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

  return (
    <div className="container">
      <div className="row">
        <div className="container">
          {files.map(it =>
            <div key={it} className="row">
              <span>{it}</span>
            </div>
            )}
        </div>
      </div>
      <div className="row">
          <h1>
            <label htmlFor="files">
              <b>Drop here to add to PNA file.</b>
            </label>
            <input
              ref={inputRef}
              id="files"
              className="hidden"
              type="file"
              onChange={e => {
              const files = e.target.files;
              files && addFiles(Array.from(files).map(it => it.webkitRelativePath))
            }}
            />
          </h1>
        </div>
      <div className="row">
        <button onClick={() => create()}>Create</button>
      </div>
    </div>
  );
}
