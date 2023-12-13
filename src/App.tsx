import { useEffect, useState } from "react";
import { Extract, Create } from "./tabs";
import { appWindow } from "@tauri-apps/api/window";
import "./App.css";

type Mode = "extract" | "create";

function App() {
  const [mode, setMode] = useState<Mode>("extract");
  useEffect(() => {
    const unlisten = appWindow.listen<void>("open_extract", () => {
    });
    return () => {
      unlisten.then((it) => it());
    };  
  }, []);

  return (
    <div className="container">
      <div className="row tab">
        <span
          className={"item " + (mode === "extract" ? "" : "inactive")}
          onClick={() => setMode("extract")}
        >
          Extract
        </span>
        <span
          className={"item " + (mode === "create" ? "" : "inactive")}
          onClick={() => setMode("create")}
        >
          Create
        </span>
      </div>
      {mode === "extract" && <Extract />}
      {mode === "create" && <Create />}
    </div>
  );
}

export default App;
