"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Flex, Spinner } from "@radix-ui/themes";
import { useI18n } from "../i18n";
import { jobApi, type VerificationMode } from "../jobs/api";
import styles from "./VerificationDialog.module.css";

interface VerificationDialogProps {
  open: boolean;
  archivePath: string;
  archiveName: string;
  encrypted: boolean;
  sessionPassword?: string;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}

export default function VerificationDialog({
  open,
  archivePath,
  archiveName,
  encrypted,
  sessionPassword,
  onOpenChange,
  onCloseAutoFocus,
}: VerificationDialogProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<VerificationMode>("quick");
  const [password, setPassword] = useState(sessionPassword ?? "");
  const [submitting, setSubmitting] = useState(false);
  const submissionInFlight = useRef(false);
  const [error, setError] = useState<{ summary: string; detail?: string }>();
  const passwordRequired = mode === "complete" && encrypted;
  const normalizedPath = archivePath.replaceAll("\\", "/");
  const lastSlashIndex = normalizedPath.lastIndexOf("/");
  const parentPath =
    lastSlashIndex === -1
      ? "/"
      : normalizedPath.slice(0, lastSlashIndex) || "/";

  useEffect(() => {
    if (!open) return;
    setMode("quick");
    setPassword(sessionPassword ?? "");
    setSubmitting(false);
    submissionInFlight.current = false;
    setError(undefined);
  }, [open, sessionPassword]);

  const submit = async () => {
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    setSubmitting(true);
    setError(undefined);
    try {
      await jobApi.startVerify({
        archivePath,
        password: mode === "complete" && password ? password : null,
        mode,
      });
      onOpenChange(false);
    } catch (caught) {
      setError({
        summary: t("jobOperationFailed"),
        detail: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      submissionInFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="560px" onCloseAutoFocus={onCloseAutoFocus}>
        <Dialog.Title>{t("verifyArchiveTitle")}</Dialog.Title>
        <Dialog.Description>{t("verifyArchiveDescription")}</Dialog.Description>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!submitting && (!passwordRequired || password)) void submit();
          }}
        >
          <p className={styles.archiveName} aria-label={archivePath}>
            <strong>{archiveName}</strong>
            <small title={parentPath}>{parentPath}</small>
          </p>
          <fieldset className={styles.modes}>
            <legend className={styles.srOnly}>{t("verifyArchiveTitle")}</legend>
            <label className={styles.mode} data-selected={mode === "quick"}>
              <input
                type="radio"
                aria-label={t("quickVerification")}
                aria-describedby="quick-verification-description"
                name="verification-mode"
                value="quick"
                checked={mode === "quick"}
                onChange={() => setMode("quick")}
              />
              <span>
                <strong>{t("quickVerification")}</strong>
                <small id="quick-verification-description">
                  {t("quickVerificationDescription")}
                </small>
              </span>
            </label>
            <label className={styles.mode} data-selected={mode === "complete"}>
              <input
                type="radio"
                aria-label={t("completeVerification")}
                aria-describedby="complete-verification-description"
                name="verification-mode"
                value="complete"
                checked={mode === "complete"}
                onChange={() => setMode("complete")}
              />
              <span>
                <strong>{t("completeVerification")}</strong>
                <small id="complete-verification-description">
                  {t("completeVerificationDescription")}
                </small>
              </span>
            </label>
          </fieldset>
          {passwordRequired && (
            <label className={styles.passwordField}>
              <span>{t("password")}</span>
              <input
                type="password"
                aria-label={t("password")}
                value={password}
                autoComplete="current-password"
                aria-describedby="verification-password-hint"
                onChange={(event) => setPassword(event.target.value)}
              />
              <small id="verification-password-hint">
                {t("verificationPasswordHint")}
              </small>
            </label>
          )}
          {error && (
            <div className={styles.error} role="alert">
              <span>{error.summary}</span>
              {error.detail && (
                <details>
                  <summary>{t("verificationTechnicalDetail")}</summary>
                  <small>{error.detail}</small>
                </details>
              )}
            </div>
          )}
          <Flex gap="3" mt="5" justify="end">
            <Dialog.Close>
              <Button type="button" variant="soft" color="gray">
                {t("cancel")}
              </Button>
            </Dialog.Close>
            <Button
              type="submit"
              disabled={submitting || (passwordRequired && !password)}
            >
              {submitting && <Spinner size="1" />}
              {submitting ? t("startingVerification") : t("startVerification")}
            </Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
