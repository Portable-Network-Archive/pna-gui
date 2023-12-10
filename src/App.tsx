import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { appWindow } from "@tauri-apps/api/window";
import "./App.css";

function App() {
  const [name, setName] = useState("");
  const [processing, setProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const extract = (path: string) => {
    setProcessing(true);
    // Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
    invoke("extract", { path })
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
      for (const path of e.payload.paths) {
        extract(path);
      }
    });
    return () => {
      unlisten.then((it) => it());
    };
  }, []);

  useEffect(() => {
    const unlisten = appWindow.listen<string>("extract_processing", (e) => {
      setName(e.payload);
    });
    return () => {
      unlisten.then((it) => it());
    };
  }, []);

  return (
    <div className="container">
      <div className="row">
        <span>
          <img src="/pna.svg" className="logo vite" alt="PNA logo" />
        </span>
      </div>

      {processing && <div className="row">Extracting {name} ...</div>}

      {!processing && (
        <div className="row">
          <h1>
            <label htmlFor="extract_file">
              <b>Drop here to extract PNA file.</b>
            </label>
            <input
              ref={inputRef}
              id="extract_file"
              className="hidden"
              type="file"
              accept=".pna"
            />
          </h1>
        </div>
      )}
    </div>
  );
}

export default App;
