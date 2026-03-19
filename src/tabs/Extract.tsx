"use client";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import { getMatches } from "@tauri-apps/plugin-cli";
import Uncontrolable from "../components/Uncontrolable";
import { Text, Dialog, Button, TextField, Spinner, Flex } from "@radix-ui/themes";
import Image from "next/image";
import styles from "./Extract.module.css";

const EVENT_ON_START_PROCESS_ENTRY = "extract_processing";

export default function Extract() {
  const [appWindow, setAppWindow] = useState<WebviewWindow>();
  const [archivePath, setArchivePath] = useState<string>();
  const [password, setPassword] = useState<string>();
  const [name, setName] = useState("");
  const [processing, setProcessing] = useState(false);
  const [openPasswordDialog, setOpenPasswordDialog] = useState(false);

  const extract = (path: string, password?: string) => {
    setProcessing(true);
    invoke("extract", { path, password, event: EVENT_ON_START_PROCESS_ENTRY })
      .then(() => {
        setArchivePath(undefined);
        setPassword(undefined);
        setProcessing(false);
      })
      .catch((err) => {
        const message = err.toString() as string;
        if (message.includes("encrypted")) {
          setOpenPasswordDialog(true);
          return;
        }
        setArchivePath(undefined);
        setPassword(undefined);
        setProcessing(false);
        window.alert(err);
      });
  };

  const openFilePicker = async () => {
    if (processing) return;
    const files = await open({
      filters: [{ name: "pna", extensions: ["pna"] }],
    });
    if (files === null) return;
    const file = [files].flat().pop();
    setArchivePath(file);
  };

  useEffect(() => {
    import("@tauri-apps/api/webviewWindow").then((it) => {
      setAppWindow(it.getCurrentWebviewWindow());
    });
    getMatches().then((matches) => {
      const source = matches.args["source"];
      const value = source.value;
      console.info(source);
      switch (true) {
        case typeof value === "string":
          console.info(value);
          setArchivePath(value);
          break;
        case value instanceof Array:
          for (const path of value) {
            console.info(value);
            setArchivePath(path);
          }
          break;
        default:
          console.warn("missing catch case", typeof value);
      }
    });
  }, []);

  useEffect(() => {
    const unlisten = appWindow?.onDragDropEvent((e) => {
      if (e.payload.type !== "drop") return;
      for (const path of e.payload.paths) {
        setArchivePath(path);
      }
    });
    return () => {
      unlisten?.then((it) => it());
    };
  }, [appWindow]);

  useEffect(() => {
    const unlisten = appWindow?.listen<string>(
      EVENT_ON_START_PROCESS_ENTRY,
      (e) => setName(e.payload),
    );
    return () => {
      unlisten?.then((it) => it());
    };
  }, [appWindow]);

  useEffect(() => {
    if (archivePath === undefined) return;
    extract(archivePath, password);
  }, [archivePath, password]);

  return (
    <div className={styles.root}>
      <div className={styles.dropZone} onClick={openFilePicker}>
        {processing ? (
          <div className={styles.processingInfo}>
            <Spinner size="3" />
            <Text size="2" weight="medium" style={{ color: "var(--gray-11)" }}>
              Extracting...
            </Text>
            <span className={styles.processingName}>{name}</span>
          </div>
        ) : (
          <>
            <span className={styles.icon}>
              <Image src="/pna.svg" alt="PNA" width={72} height={72} />
            </span>
            <span className={styles.hint}>Drop .pna file here</span>
            <span className={styles.subHint}>or click to browse</span>
          </>
        )}
      </div>

      <Dialog.Root open={openPasswordDialog}>
        <Dialog.Content maxWidth="400px">
          <Dialog.Title>Password Required</Dialog.Title>
          <Dialog.Description size="2" color="gray">
            This archive is encrypted. Enter the password to extract.
          </Dialog.Description>
          <Flex direction="column" mt="4">
            <label htmlFor="password">
              <Text as="div" size="2" mb="1" weight="medium">
                Password
              </Text>
              <TextField.Root id="password" type="password" size="2" />
            </label>
          </Flex>
          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close
              onClick={() => {
                setProcessing(false);
                setOpenPasswordDialog(false);
              }}
            >
              <Button variant="soft" color="gray">
                Cancel
              </Button>
            </Dialog.Close>
            <Dialog.Close
              onClick={() => {
                setPassword(
                  (document.getElementById("password") as HTMLInputElement)
                    .value,
                );
                setOpenPasswordDialog(false);
              }}
            >
              <Button>Extract</Button>
            </Dialog.Close>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {processing && <Uncontrolable />}
    </div>
  );
}
