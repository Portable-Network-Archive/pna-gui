"use client";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { WebviewWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/api/dialog";
import { readAllIfDir } from "../utils/fs";
import { CubeIcon, FileIcon, GearIcon } from "@radix-ui/react-icons";
import ProcessingIcon from "../components/ProcessingIcon";
import styles from "./Create.module.css";
import Uncontrolable from "../components/Uncontrolable";
import {
  Button,
  Flex,
  IconButton,
  Select,
  TextField,
  Dialog,
  Tooltip,
  ScrollArea,
  Table,
  Text,
  Grid,
} from "@radix-ui/themes";

const EVENT_ON_FINISH = "on_finish";
const EVENT_ON_ENTRY_START = "on_entry_start";

const COMPRESSION = ["none", "zlib", "zstd", "xz"] as const;
type Compression = (typeof COMPRESSION)[number];

const ENCRYPTION = ["none", "aes", "camellia"] as const;
type Encryption = (typeof ENCRYPTION)[number];

export default function Create() {
  const [appWindow, setAppWindow] = useState<WebviewWindow>();
  const [api, setApi] = useState<typeof import("@tauri-apps/api")>();
  const [openSettings, setOpenSettings] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [processing, setProcessing] = useState(false);
  const [compression, setCompression] = useState<Compression>("zstd");
  const [encryption, setEncryption] = useState<Encryption>("none");
  const [password, setPassword] = useState<string>("");
  const [saveDir, setSaveDir] = useState<string | undefined>(undefined);

  const addFiles = async (paths: string[]) => {
    let files: string[] = [];
    for (const path of paths) {
      files.push(...(await readAllIfDir(path)));
    }
    setFiles((current) => {
      return [...current, ...files];
    });
  };

  const openFilePicker = async () => {
    if (processing) {
      return;
    }
    const files = await open({ multiple: true });
    if (files === null) {
      return;
    }
    await addFiles([files].flat());
  };

  const openDirPicker = async () => {
    if (processing) {
      return;
    }
    const dirs = await open({ directory: true });
    if (dirs === null) {
      return;
    }
    // NOTE: take first element
    const dir = [dirs].flat().pop();
    if (dir === undefined) {
      return;
    }
    setSaveDir(dir);
  };

  const create = async () => {
    if (encryption !== "none" && password.length === 0) {
      window.alert("password is needed");
      return;
    }
    setProcessing(true);
    // Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
    invoke("create", {
      archiveFinishEvent: EVENT_ON_FINISH,
      entryStartEvent: EVENT_ON_ENTRY_START,
      name: "archive.pna",
      files,
      saveDir: saveDir || (await api?.path.desktopDir()),
      option: {
        compression,
        encryption,
        password: password.length === 0 ? null : password,
      },
    })
      .then(() => {
        setProcessing(false);
      })
      .catch((err) => {
        window.alert(err);
        setProcessing(false);
      });
  };

  useEffect(() => {
    const w = import("@tauri-apps/api/window");
    w.then((it) => {
      setAppWindow(it.appWindow);
    });
    const a = import("@tauri-apps/api");
    a.then((it) => {
      setApi(it);
    });
  }, []);

  useEffect(() => {
    const unlisten = appWindow?.onFileDropEvent((e) => {
      if (e.payload.type !== "drop") {
        return;
      }
      addFiles(e.payload.paths);
    });
    return () => {
      unlisten?.then((it) => it());
    };
  }, [appWindow]);

  useEffect(() => {
    const unlisten = appWindow?.listen<string>(EVENT_ON_ENTRY_START, (e) => {
      setName(e.payload);
    });
    return () => {
      unlisten?.then((it) => it());
    };
  }, [appWindow]);

  useEffect(() => {
    const unlisten = appWindow?.listen<string>(EVENT_ON_FINISH, () => {
      setFiles([]);
    });
    return () => {
      unlisten?.then((it) => it());
    };
  }, [appWindow]);

  useEffect(() => {
    api?.path.desktopDir().then(setSaveDir);
  }, [api]);

  return (
    <Flex direction="column" height="100%" width="100%" justify="between">
      <Flex direction="column">
        <Flex direction="row" width="100%">
          <TextField.Root
            defaultValue={saveDir}
            disabled={true}
            style={{ width: "100%" }}
          >
            <TextField.Slot>
              <Tooltip content="Save to">
                <FileIcon onClick={openDirPicker} />
              </Tooltip>
            </TextField.Slot>
          </TextField.Root>
        </Flex>
        <Flex direction="row" justify="center" align="center">
          <Text onClick={openFilePicker}>
            <b>Drop here to add to Archive</b>
          </Text>
        </Flex>
      </Flex>
      <ScrollArea style={{ border: "1px solid var(--accent-3)" }}>
        <Flex direction="row" height="100%" width="100%">
          <Table.Root
            className={`${styles.FileList}`}
            style={{ width: "100%" }}
          >
            <Table.Body>
              {files.map((it) => (
                <Table.Row key={it}>
                  <Table.Cell>
                    {processing && it == name && (
                      <span className={styles.Icon}>
                        <ProcessingIcon />
                      </span>
                    )}
                    <span>{it}</span>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Flex>
      </ScrollArea>
      <Flex direction="row" justify="end" width="100%">
        <div>
          <Button onClick={create} disabled={files.length === 0}>
            <CubeIcon />
            Create
          </Button>
          <Dialog.Root open={openSettings}>
            <Dialog.Trigger>
              <IconButton onClick={() => setOpenSettings(true)}>
                <GearIcon />
              </IconButton>
            </Dialog.Trigger>
            <Dialog.Content>
              <Dialog.Title>Archive options</Dialog.Title>
              <Flex direction="column" gap="2">
                <label htmlFor="compression">Compression</label>
                <Select.Root
                  defaultValue={compression}
                  onValueChange={(e) => setCompression(e as Compression)}
                >
                  <Select.Trigger />
                  <Select.Content id="compression">
                    {COMPRESSION.map((it) => (
                      <Select.Item key={it} value={it}>
                        {it}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
                <label htmlFor="encryption">Encryption</label>
                <Select.Root
                  defaultValue={encryption}
                  onValueChange={(e) => setEncryption(e as Encryption)}
                >
                  <Select.Trigger />
                  <Select.Content id="encryption">
                    {ENCRYPTION.map((it) => (
                      <Select.Item key={it} value={it}>
                        {it}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
                <label htmlFor="password">Password</label>
                <TextField.Root
                  id="password"
                  type="password"
                  disabled={encryption === "none"}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Flex>
              <Flex mt="4" justify="end">
                <Dialog.Close>
                  <Button onClick={() => setOpenSettings(false)}>Apply</Button>
                </Dialog.Close>
              </Flex>
            </Dialog.Content>
          </Dialog.Root>
        </div>
        {processing && <Uncontrolable></Uncontrolable>}
      </Flex>
    </Flex>
  );
}
