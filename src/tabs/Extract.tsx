"use client";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { WebviewWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/api/dialog";
import Uncontrolable from "../components/Uncontrolable";
import { Flex, Text, Dialog, Button, TextField } from "@radix-ui/themes";
import Image from "next/image";

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

  const openFilePicker = async () => {
    if (processing) {
      return;
    }
    const files = await open({
      filters: [
        {
          name: "pna",
          extensions: ["pna"],
        },
      ],
    });
    if (files === null) {
      return;
    }
    // NOTE: take first element
    const file = [files].flat().pop();
    setArchivePath(file);
  };
  useEffect(() => {
    const w = import("@tauri-apps/api/window");
    w.then((it) => {
      setAppWindow(it.appWindow);
    });
  }, []);

  useEffect(() => {
    const unlisten = appWindow?.onFileDropEvent((e) => {
      if (e.payload.type !== "drop") {
        return;
      }
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
      (e) => {
        setName(e.payload);
      },
    );
    return () => {
      unlisten?.then((it) => it());
    };
  }, [appWindow]);

  useEffect(() => {
    const path = archivePath;
    if (path === undefined) {
      return;
    }
    extract(path, password);
  }, [archivePath, password]);

  return (
    <Flex
      direction="column"
      style={{ height: "100vh" }}
      justify="center"
      width="100%"
    >
      <Flex direction="row">
        <Dialog.Root open={openPasswordDialog}>
          <Dialog.Content>
            <Dialog.Title>Input password</Dialog.Title>
            <Dialog.Description>
              This archive is encrypted need a password to extract
            </Dialog.Description>
            <Flex direction="column">
              <label htmlFor="password">
                <Text as="div" size="2" mb="1" weight="bold">
                  Password
                </Text>
                <TextField.Root id="password" type="password" />
              </label>
            </Flex>
            <Flex gap="3" mt="4" justify="end">
              <Dialog.Close
                onClick={async () => {
                  setProcessing(false);
                  setOpenPasswordDialog(false);
                }}
              >
                <Button variant="soft" color="gray">
                  Cancel
                </Button>
              </Dialog.Close>
              <Dialog.Close
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
            </Flex>
          </Dialog.Content>
        </Dialog.Root>
      </Flex>
      <Flex width="100%" align="center" justify="center">
        <span onClick={openFilePicker}>
          <Image src="/pna.svg" alt="PNA" width="100" height="100" />
        </span>
      </Flex>
      <Flex width="100%" align="center" justify="center">
        {processing && <Text>Extracting {name} ...</Text>}
        {!processing && (
          <Text className="clickable" onClick={openFilePicker}>
            <b>Drop here to extract Archive</b>
          </Text>
        )}
      </Flex>
      {processing && <Uncontrolable />}
    </Flex>
  );
}
