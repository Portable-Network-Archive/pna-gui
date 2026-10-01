"use client";

import { useId, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";
import { createSingleFlightGate } from "../singleFlight";
import styles from "./ArchiveEditSaveChoice.module.css";

export function useArchiveEditSave(archivePath: string, open: boolean) {
  const { t } = useI18n();
  const hintId = useId();
  const pickerGate = useMemo(() => createSingleFlightGate(), []);
  const [mode, setMode] = useState<"copy" | "overwrite">("copy");
  const [outputError, setOutputError] = useState<string>();
  const [previousOpen, setPreviousOpen] = useState(open);
  if (previousOpen !== open) {
    setPreviousOpen(open);
    setMode("copy");
    setOutputError(undefined);
  }
  const chooseOutput = async (): Promise<string | null | undefined> => {
    setOutputError(undefined);
    if (mode === "overwrite") return null;
    const selected = await pickerGate.run("edit-save-picker", async () =>
      save({
        title: t("saveEditedArchive"),
        defaultPath: /\.pna$/i.test(archivePath)
          ? archivePath.replace(/\.pna$/i, "-edited.pna")
          : `${archivePath}-edited.pna`,
        filters: [{ name: "Portable Network Archive", extensions: ["pna"] }],
      }),
    );
    if (!selected) return undefined;
    const output = selected.toLowerCase().endsWith(".pna")
      ? selected
      : `${selected}.pna`;
    if (output === archivePath) throw new Error(t("editSaveDifferentPath"));
    if (await invoke<boolean>("archive_output_exists", { path: output })) {
      setOutputError(t("editSaveExistingPath"));
      return undefined;
    }
    return output;
  };
  const choice = (
    <div className={styles.choice}>
      <label>
        {t("editSaveMode")}
        <select
          aria-label={t("editSaveMode")}
          aria-describedby={hintId}
          value={mode}
          onChange={(event) => {
            setMode(event.target.value as typeof mode);
            setOutputError(undefined);
          }}
        >
          <option value="copy">{t("editSaveCopy")}</option>
          <option value="overwrite">{t("editSaveOverwrite")}</option>
        </select>
      </label>
      <p id={hintId}>
        {t(mode === "copy" ? "editSaveCopyHint" : "editSaveOverwriteHint")}
      </p>
      {outputError && <p role="alert">{outputError}</p>}
      <small>
        {t("editSourceArchive")}: {archivePath}
      </small>
    </div>
  );
  return { choice, chooseOutput };
}
