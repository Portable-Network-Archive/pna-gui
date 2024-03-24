"use client";
import { useEffect, useState } from "react";
import { Extract, Create } from "./tabs";
import { WebviewWindow } from "@tauri-apps/api/window";
import styles from "./App.module.css";

type Mode = "extract" | "create";

function App() {
  const [appWindow, setAppWindow] = useState<WebviewWindow>();
  const [mode, setMode] = useState<Mode>("extract");
  useEffect(() => {
    const w = import("@tauri-apps/api/window");
    w.then((it) => {
      setAppWindow(it.appWindow);
    });
  }, []);
  useEffect(() => {
    const unlisten = appWindow?.listen<Mode>("switch_tab", (e) => {
      setMode(e.payload);
      console.log(e.payload);
    });
    return () => {
      unlisten?.then((it) => it());
    };
  }, [appWindow]);

  return (
    <div className={styles.Container}>
      <div className={styles.LeftMenuRoot}>
        <div className={styles.MenuContainer}>
          <span
            className={`${styles.Item} ${
              mode === "extract" ? styles.Active : styles.Inactive
            }`}
            onClick={() => setMode("extract")}
          >
            Extract
          </span>
          <span
            className={`${styles.Item} ${
              mode === "create" ? styles.Active : styles.Inactive
            }`}
            onClick={() => setMode("create")}
          >
            Create
          </span>
        </div>
        <div></div>
      </div>
      {mode === "extract" && <Extract />}
      {mode === "create" && <Create />}
    </div>
  );
}

export default App;
