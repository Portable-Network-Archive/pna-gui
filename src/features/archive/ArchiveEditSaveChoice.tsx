"use client";

import { useId, useMemo, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n";
import { createSingleFlightGate } from "../singleFlight";
import styles from "./ArchiveEditSaveChoice.module.css";

export function useArchiveEditSave(archivePath: string) {
  const { t } = useI18n();
  const hintId = useId();
  const pickerGate = useMemo(() => createSingleFlightGate(), []);
  const [mode, setMode] = useState<"copy" | "overwrite">("copy");
  const chooseOutput = async (): Promise<string | null | undefined> => {
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
          onChange={(event) => setMode(event.target.value as typeof mode)}
        >
          <option value="copy">{t("editSaveCopy")}</option>
          <option value="overwrite">{t("editSaveOverwrite")}</option>
        </select>
      </label>
      <p id={hintId}>
        {t(mode === "copy" ? "editSaveCopyHint" : "editSaveOverwriteHint")}
      </p>
      <small>
        {t("editSourceArchive")}: {archivePath}
      </small>
    </div>
  );
  return { choice, chooseOutput };
}
