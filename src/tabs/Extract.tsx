import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { appWindow } from "@tauri-apps/api/window";
import { Cross2Icon } from "@radix-ui/react-icons";
import Button from "../components/Button";
import * as Dialog from "../components/Dialog";
import styles from "./Extract.module.css";

const EVENT_ON_FILE_PICKED = "on_file_picked";
const EVENT_ON_START_PROCESS_ENTRY = "extract_processing";

export default function Extract() {
  const [archivePath, setArchivePath] = useState<string>();
  const [password, setPassword] = useState<string>();
  const [name, setName] = useState("");
  const [processing, setProcessing] = useState(false);
  const [openPasswordDialog, setOpenPasswordDialog] = useState(false);

  const extract = (path: string, password?: string) => {
    setProcessing(true);
    // Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
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

  const openFilePicker = () => {
    if (processing) {
      return;
    }
    invoke("open_pna_file_picker", { event: EVENT_ON_FILE_PICKED });
  };

  useEffect(() => {
    const unlisten = appWindow.onFileDropEvent((e) => {
      if (e.payload.type !== "drop") {
        return;
      }
      for (const path of e.payload.paths) {
        setArchivePath(path);
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
      setArchivePath(e.payload);
    });
    return () => {
      unlisten.then((it) => it());
    };
  }, []);

  useEffect(() => {
    const path = archivePath;
    if (path === undefined) {
      return;
    }
    extract(path, password);
  }, [archivePath, password]);

  return (
    <div className="container">
      <div className="row">
        <Dialog.Root open={openPasswordDialog}>
          <Dialog.Trigger asChild></Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay />
            <Dialog.Content>
              <Dialog.Title>Input password</Dialog.Title>
              <Dialog.Description>
                The archive is encrypted need a password to extract
              </Dialog.Description>
              <fieldset className={`${styles.Fieldset}`}>
                <label className={`${styles.Label}`} htmlFor="password">
                  Password
                </label>
                <input id="password" type="password"></input>
              </fieldset>
              <div className={`${styles.ButtonContainer}`}>
                <Dialog.Close
                  asChild
                  onClick={async () => {
                    setPassword(
                      (document.getElementById("password") as HTMLInputElement)
                        .value,
                    );
                    setOpenPasswordDialog(false);
                  }}
                >
                  <Button>Extract</Button>
                </Dialog.Close>
              </div>
              <Dialog.Close
                asChild
                onClick={async () => {
                  setOpenPasswordDialog(false);
                }}
              >
                <button className={`${styles.IconButton}`} aria-label="Close">
                  <Cross2Icon />
                </button>
              </Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
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
