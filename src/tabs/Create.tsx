"use client";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
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
  Text,
  Spinner,
  Checkbox,
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
  const [solidMode, setSolidMode] = useState(false);
  const [saveDir, setSaveDir] = useState<string | undefined>(undefined);

  const addFiles = async (paths: string[]) => {
    let files: string[] = [];
    for (const path of paths) {
      files.push(...(await readAllIfDir(path)));
    }
    setFiles((current) => [...current, ...files]);
  };

  const openFilePicker = async () => {
    if (processing) return;
    const files = await open({ multiple: true });
    if (files === null) return;
    await addFiles([files].flat());
  };

  const openDirPicker = async () => {
    if (processing) return;
    const dirs = await open({ directory: true });
    if (dirs === null) return;
    const dir = [dirs].flat().pop();
    if (dir === undefined) return;
    setSaveDir(dir);
  };

  const create = async () => {
    if (encryption !== "none" && password.length === 0) {
      window.alert("password is needed");
      return;
    }
    setProcessing(true);
    invoke("create", {
      archiveFinishEvent: EVENT_ON_FINISH,
      entryStartEvent: EVENT_ON_ENTRY_START,
      name: "archive.pna",
      files,
      saveDir: saveDir || (await api?.path.desktopDir()),
      option: {
        solid: solidMode,
        compression,
        encryption,
        password: password.length === 0 ? null : password,
      },
    })
      .then(() => setProcessing(false))
      .catch((err) => {
        window.alert(err);
        setProcessing(false);
      });
  };

  useEffect(() => {
    import("@tauri-apps/api/webviewWindow").then((it) => {
      setAppWindow(it.getCurrentWebviewWindow());
    });
    import("@tauri-apps/api").then((it) => setApi(it));
  }, []);

  useEffect(() => {
    const unlisten = appWindow?.onDragDropEvent((e) => {
      if (e.payload.type !== "drop") return;
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
    <div className={styles.root}>
      <div className={styles.saveBar}>
        <span className={styles.saveBarLabel}>Save to</span>
        <span className={styles.saveBarPath}>{saveDir}</span>
        <button className={styles.saveBarButton} onClick={openDirPicker}>
          <FileIcon />
        </button>
      </div>

      <div className={styles.fileArea}>
        {files.length === 0 ? (
          <div className={styles.fileAreaEmpty} onClick={openFilePicker}>
            <CubeIcon
              width={32}
              height={32}
              style={{ color: "var(--gray-a6)" }}
            />
            <span className={styles.fileAreaHint}>Drop files here</span>
            <span className={styles.fileAreaSubHint}>or click to browse</span>
          </div>
        ) : (
          <>
            <div className={styles.dropPrompt} onClick={openFilePicker}>
              <span className={styles.dropPromptText}>
                Drop more files or click to add
              </span>
            </div>
            <div className={styles.fileList}>
              {files.map((it) => (
                <div key={it} className={styles.fileItem}>
                  <span className={styles.fileItemIcon}>
                    {processing && it === name ? (
                      <ProcessingIcon />
                    ) : (
                      <FileIcon width={12} height={12} />
                    )}
                  </span>
                  <span
                    className={`${styles.fileItemName} ${
                      processing && it === name ? styles.fileItemProcessing : ""
                    }`}
                  >
                    {it}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className={styles.actionBar}>
        <Dialog.Root open={openSettings}>
          <Dialog.Trigger>
            <IconButton
              variant="soft"
              color="gray"
              size="2"
              onClick={() => setOpenSettings(true)}
              disabled={processing}
            >
              <GearIcon />
            </IconButton>
          </Dialog.Trigger>
          <Dialog.Content maxWidth="380px">
            <Dialog.Title>Archive Options</Dialog.Title>
            <Flex direction="column" gap="3" mt="2">
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">
                  Compression
                </Text>
                <Select.Root
                  defaultValue={compression}
                  onValueChange={(e) => setCompression(e as Compression)}
                >
                  <Select.Trigger />
                  <Select.Content>
                    {COMPRESSION.map((it) => (
                      <Select.Item key={it} value={it}>
                        {it}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </Flex>
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">
                  Encryption
                </Text>
                <Select.Root
                  defaultValue={encryption}
                  onValueChange={(e) => setEncryption(e as Encryption)}
                >
                  <Select.Trigger />
                  <Select.Content>
                    {ENCRYPTION.map((it) => (
                      <Select.Item key={it} value={it}>
                        {it}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </Flex>
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">
                  Password
                </Text>
                <TextField.Root
                  type="password"
                  size="2"
                  disabled={encryption === "none"}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Flex>
              <Text as="label" size="2">
                <Flex gap="2" align="center">
                  <Checkbox
                    defaultChecked={solidMode}
                    onCheckedChange={(state) => {
                      if (state === "indeterminate") return;
                      setSolidMode(state);
                    }}
                  />
                  Solid mode
                </Flex>
              </Text>
            </Flex>
            <Flex mt="4" justify="end">
              <Dialog.Close>
                <Button onClick={() => setOpenSettings(false)}>Done</Button>
              </Dialog.Close>
            </Flex>
          </Dialog.Content>
        </Dialog.Root>
        <Button
          size="2"
          onClick={create}
          disabled={files.length === 0 || processing}
        >
          <Spinner loading={processing}>
            <CubeIcon />
          </Spinner>
          Create Archive
        </Button>
      </div>

      {processing && <Uncontrolable />}
    </div>
  );
}
