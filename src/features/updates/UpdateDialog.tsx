"use client";

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Button, Dialog, Flex, Spinner } from "@radix-ui/themes";
import { useI18n } from "../i18n";

type UpdateStatus =
  | { kind: "checking" | "current" | "installed" }
  | { kind: "available" | "installing"; version: string }
  | { kind: "error"; detail: string; version?: string };

export default function UpdateDialog() {
  const { t } = useI18n();
  const [status, setStatus] = useState<UpdateStatus>();
  const busyRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebviewWindow()
      .listen("tauri://update", async () => {
        if (disposed || busyRef.current) return;
        busyRef.current = true;
        setStatus({ kind: "checking" });
        try {
          const update = await invoke<{ version: string } | null>(
            "update_check",
          );
          if (!disposed)
            setStatus(
              update
                ? { kind: "available", version: update.version }
                : { kind: "current" },
            );
        } catch (error) {
          if (!disposed) setStatus({ kind: "error", detail: String(error) });
        } finally {
          busyRef.current = false;
        }
      })
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      })
      .catch((error) => {
        if (!disposed) setStatus({ kind: "error", detail: String(error) });
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const install = async (version: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setStatus({ kind: "installing", version });
    try {
      await invoke("update_install", { version });
      setStatus({ kind: "installed" });
    } catch (error) {
      setStatus({ kind: "error", detail: String(error), version });
    } finally {
      busyRef.current = false;
    }
  };

  const busy = status?.kind === "checking" || status?.kind === "installing";
  const version = status && "version" in status ? status.version : undefined;
  const message =
    status?.kind === "checking"
      ? t("updateChecking")
      : status?.kind === "available"
        ? t("updateAvailable").replace("{version}", status.version)
        : status?.kind === "installing"
          ? t("updateInstalling")
          : status?.kind === "installed"
            ? t("updateInstalled")
            : status?.kind === "current"
              ? t("updateCurrent")
              : t("updateFailed");

  return (
    <Dialog.Root
      open={Boolean(status)}
      onOpenChange={(open) => {
        if (!open && !busyRef.current) setStatus(undefined);
      }}
    >
      <Dialog.Content maxWidth="440px">
        <Dialog.Title>{t("updateTitle")}</Dialog.Title>
        <Dialog.Description>{message}</Dialog.Description>
        {busy && (
          <Flex gap="2" mt="3" role="status">
            <Spinner />
            {message}
          </Flex>
        )}
        {status?.kind === "error" && (
          <details>
            <summary>{t("verificationTechnicalDetail")}</summary>
            <p>{status.detail}</p>
          </details>
        )}
        <Flex mt="4" justify="end" gap="3">
          <Button
            variant="soft"
            color="gray"
            disabled={busy}
            onClick={() => setStatus(undefined)}
          >
            {t("close")}
          </Button>
          {version && !busy && (
            <Button onClick={() => void install(version)}>
              {status?.kind === "error" ? t("retry") : t("updateInstall")}
            </Button>
          )}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
