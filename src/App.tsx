"use client";
import { useEffect, useState } from "react";
import { Extract, Create } from "./tabs";
import { WebviewWindow } from "@tauri-apps/api/window";
import styles from "./App.module.css";
import { Text, Flex } from "@radix-ui/themes";

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
    <Flex direction="row" width="100%" height="100%">
      <Flex direction="column">
        <div className={styles.LeftMenuRoot}>
          <div className={styles.MenuContainer}>
            <span
              className={`${styles.Item} ${
                mode === "extract" ? styles.Active : styles.Inactive
              }`}
              onClick={() => setMode("extract")}
            >
              <Text>Extract</Text>
            </span>
            <span
              className={`${styles.Item} ${
                mode === "create" ? styles.Active : styles.Inactive
              }`}
              onClick={() => setMode("create")}
            >
              <Text>Create</Text>
            </span>
          </div>
          <div></div>
        </div>
      </Flex>
      <Flex width="100%" height="100%" p="2">
        {mode === "extract" && <Extract />}
        {mode === "create" && <Create />}
      </Flex>
    </Flex>
  );
}

export default App;
