"use client";
import { useEffect, useState } from "react";
import { Extract, Create } from "./tabs";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import styles from "./App.module.css";

type Mode = "extract" | "create";

function App() {
  const [appWindow, setAppWindow] = useState<WebviewWindow>();
  const [mode, setMode] = useState<Mode>("extract");

  useEffect(() => {
    import("@tauri-apps/api/webviewWindow").then((it) => {
      setAppWindow(it.getCurrentWebviewWindow());
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
    <div className={styles.root}>
      <nav className={styles.tabBar}>
        <div className={styles.tabGroup}>
          <button
            className={`${styles.tab} ${mode === "extract" ? styles.active : ""}`}
            onClick={() => setMode("extract")}
          >
            Extract
          </button>
          <button
            className={`${styles.tab} ${mode === "create" ? styles.active : ""}`}
            onClick={() => setMode("create")}
          >
            Create
          </button>
        </div>
      </nav>
      <main className={styles.content}>
        {mode === "extract" && <Extract />}
        {mode === "create" && <Create />}
      </main>
    </div>
  );
}

export default App;
