"use client";

import { useEffect, useMemo, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ArchiveIcon, Cross1Icon, FileIcon } from "@radix-ui/react-icons";
import { Button } from "@radix-ui/themes";
import { TranslationKey, useI18n } from "../features/i18n";
import { jobApi } from "../features/jobs/api";
import styles from "./Create.module.css";

const COMPRESSION = ["store", "deflate", "zstd", "xz"] as const;
type Compression = (typeof COMPRESSION)[number];
const ENCRYPTION = ["none", "aes", "camellia"] as const;
type Encryption = (typeof ENCRYPTION)[number];
type Preset =
  | "standard"
  | "backup"
  | "distribution"
  | "maximum"
  | "fast"
  | "reproducible";
type PresetSelection = Preset | "custom";

interface Settings {
  compression: Compression;
  encryption: Encryption;
  solid: boolean;
  preservePermissions: boolean;
  reproducible: boolean;
}

const PRESETS: Record<Preset, Settings> = {
  standard: {
    compression: "zstd",
    encryption: "none",
    solid: false,
    preservePermissions: true,
    reproducible: false,
  },
  backup: {
    compression: "zstd",
    encryption: "none",
    solid: false,
    preservePermissions: true,
    reproducible: false,
  },
  distribution: {
    compression: "zstd",
    encryption: "none",
    solid: false,
    preservePermissions: false,
    reproducible: false,
  },
  maximum: {
    compression: "xz",
    encryption: "none",
    solid: true,
    preservePermissions: true,
    reproducible: false,
  },
  fast: {
    compression: "store",
    encryption: "none",
    solid: false,
    preservePermissions: true,
    reproducible: false,
  },
  reproducible: {
    compression: "zstd",
    encryption: "none",
    solid: false,
    preservePermissions: false,
    reproducible: true,
  },
};

export default function Create() {
  const { t } = useI18n();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sources, setSources] = useState<string[]>([]);
  const [configuration, setConfiguration] = useState<{
    preset: PresetSelection;
    settings: Settings;
  }>({ preset: "standard", settings: PRESETS.standard });
  const { preset, settings } = configuration;
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [draggingOver, setDraggingOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [queuedJob, setQueuedJob] = useState<string>();
  const addSources = (paths: string[]) => {
    setSources((current) => [...new Set([...current, ...paths])]);
  };

  const chooseFiles = async () => {
    const selected = await open({ multiple: true });
    if (selected) addSources([selected].flat());
  };

  const chooseFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") addSources([selected]);
  };

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/webviewWindow").then(
      async ({ getCurrentWebviewWindow }) => {
        if (disposed) return;
        unlisten = await getCurrentWebviewWindow().onDragDropEvent((event) => {
          if (event.payload.type === "enter" || event.payload.type === "over")
            setDraggingOver(true);
          if (event.payload.type === "leave") setDraggingOver(false);
          if (event.payload.type === "drop") {
            setDraggingOver(false);
            addSources(event.payload.paths);
          }
        });
      },
    );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const validation = useMemo(() => {
    if (settings.reproducible && settings.encryption !== "none")
      return t("reproducibleEncryptionConflict");
    if (settings.encryption !== "none" && !password) return t("passwordNeeded");
    if (settings.encryption !== "none" && password !== passwordConfirmation)
      return t("passwordMismatch");
    return undefined;
  }, [password, passwordConfirmation, settings, t]);

  const applyPreset = (next: Preset) => {
    setConfiguration({ preset: next, settings: PRESETS[next] });
    if (next === "reproducible") {
      setPassword("");
      setPasswordConfirmation("");
    }
  };

  const start = async () => {
    if (validation) {
      setError(validation);
      return;
    }
    const selected = await save({
      title: t("saveArchive"),
      defaultPath: "archive.pna",
      filters: [{ name: "PNA Archive", extensions: ["pna"] }],
    });
    if (!selected) return;
    const outputPath = selected.toLowerCase().endsWith(".pna")
      ? selected
      : `${selected}.pna`;
    setSubmitting(true);
    setError(undefined);
    try {
      await jobApi.startCreate({
        sources,
        outputPath,
        overwrite,
        options: {
          solid: settings.solid,
          compression: settings.compression,
          encryption: settings.encryption,
          password: settings.encryption === "none" ? null : password,
          preservePermissions: settings.preservePermissions,
          reproducible: settings.reproducible,
        },
      });
      setQueuedJob(outputPath);
      setSources([]);
      setStep(1);
    } catch (caught) {
      setError(String(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className={styles.wizard} aria-label={t("createWizard")}>
      <ol className={styles.steps} aria-label={t("createSteps")}>
        {[t("selectSources"), t("settings"), t("confirmation")].map(
          (label, index) => (
            <li
              key={label}
              data-active={step === index + 1}
              data-complete={step > index + 1}
              aria-current={step === index + 1 ? "step" : undefined}
            >
              <span>{index + 1}</span>
              {label}
            </li>
          ),
        )}
      </ol>

      {queuedJob && (
        <div className={styles.notice} role="status">
          <span>
            <strong>{t("creationStarted")}</strong>
            {t("creationStartedHint").replace("{path}", queuedJob)}
          </span>
          <button
            type="button"
            aria-label={t("dismissCreationNotice")}
            onClick={() => setQueuedJob(undefined)}
          >
            <Cross1Icon aria-hidden="true" />
          </button>
        </div>
      )}
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      {step === 1 && (
        <div className={styles.panel}>
          <button
            type="button"
            className={`${styles.dropZone} ${draggingOver ? styles.dragOver : ""}`}
            onClick={chooseFiles}
            aria-label={`${t("dropFiles")} ${t("browseFiles")}`}
          >
            <ArchiveIcon width={28} height={28} aria-hidden="true" />
            <strong>{t("dropFiles")}</strong>
            <span>{t("browseFiles")}</span>
          </button>
          <div className={styles.sourceActions}>
            <Button variant="soft" onClick={chooseFiles}>
              {t("addFiles")}
            </Button>
            <Button variant="soft" onClick={chooseFolder}>
              {t("addFolder")}
            </Button>
          </div>
          {sources.length === 0 ? (
            <p className={styles.empty}>{t("noSources")}</p>
          ) : (
            <ul className={styles.sources}>
              {sources.map((source) => (
                <li key={source}>
                  <FileIcon aria-hidden="true" />
                  <span>{source}</span>
                  <button
                    type="button"
                    aria-label={`${t("removeFile")}: ${source}`}
                    onClick={() =>
                      setSources((current) =>
                        current.filter((value) => value !== source),
                      )
                    }
                  >
                    <Cross1Icon aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {step === 2 && (
        <div className={styles.panel}>
          <p>{t("chooseCreateSettings")}</p>
          <div className={styles.presets}>
            {(
              [
                "standard",
                "backup",
                "distribution",
                "maximum",
                "fast",
                "reproducible",
              ] as Preset[]
            ).map((value) => (
              <button
                type="button"
                key={value}
                data-selected={preset === value}
                onClick={() => applyPreset(value)}
              >
                <strong>{t(`preset_${value}` as TranslationKey)}</strong>
                <small>
                  {t(`preset_${value}_description` as TranslationKey)}
                </small>
              </button>
            ))}
          </div>
          <div className={styles.settingsGrid}>
            <label>
              {t("compression")}
              <select
                aria-label={t("compression")}
                value={settings.compression}
                onChange={(event) => {
                  const compression = event.target.value as Compression;
                  setConfiguration((current) => ({
                    preset: "custom",
                    settings: { ...current.settings, compression },
                  }));
                }}
              >
                {COMPRESSION.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("encryption")}
              <select
                aria-label={t("encryption")}
                value={settings.encryption}
                onChange={(event) => {
                  const value = event.target.value as Encryption;
                  setConfiguration((current) => ({
                    preset: "custom",
                    settings: {
                      ...current.settings,
                      encryption: value,
                      reproducible:
                        value === "none"
                          ? current.settings.reproducible
                          : false,
                    },
                  }));
                }}
              >
                {ENCRYPTION.map((value) => (
                  <option key={value} value={value}>
                    {value === "none" ? t("none") : value}
                  </option>
                ))}
              </select>
            </label>
            {settings.encryption !== "none" && (
              <>
                <label>
                  {t("password")}
                  <input
                    type="password"
                    aria-label={t("password")}
                    name="archive-password"
                    autoComplete="new-password"
                    aria-invalid={Boolean(validation)}
                    aria-describedby={
                      validation ? "create-validation" : undefined
                    }
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                <label>
                  {t("confirmPassword")}
                  <input
                    type="password"
                    aria-label={t("confirmPassword")}
                    name="archive-password-confirmation"
                    autoComplete="new-password"
                    aria-invalid={Boolean(validation)}
                    aria-describedby={
                      validation ? "create-validation" : undefined
                    }
                    value={passwordConfirmation}
                    onChange={(event) =>
                      setPasswordConfirmation(event.target.value)
                    }
                  />
                </label>
              </>
            )}
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={settings.solid}
                onChange={(event) => {
                  const solid = event.target.checked;
                  setConfiguration((current) => ({
                    preset: "custom",
                    settings: { ...current.settings, solid },
                  }));
                }}
              />
              {t("solidMode")}
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={settings.preservePermissions}
                onChange={(event) => {
                  const preservePermissions = event.target.checked;
                  setConfiguration((current) => ({
                    preset: "custom",
                    settings: { ...current.settings, preservePermissions },
                  }));
                }}
              />
              {t("preservePermissions")}
            </label>
          </div>
          {validation && (
            <p
              id="create-validation"
              className={styles.validation}
              role="alert"
            >
              {validation}
            </p>
          )}
        </div>
      )}

      {step === 3 && (
        <div className={styles.panel}>
          <h2>{t("reviewCreate")}</h2>
          <dl className={styles.review}>
            <div>
              <dt>{t("items")}</dt>
              <dd>{sources.length}</dd>
            </div>
            <div>
              <dt>{t("preset")}</dt>
              <dd>{t(`preset_${preset}` as TranslationKey)}</dd>
            </div>
            <div>
              <dt>{t("compression")}</dt>
              <dd>{settings.compression}</dd>
            </div>
            <div>
              <dt>{t("encryption")}</dt>
              <dd>
                {settings.encryption === "none"
                  ? t("none")
                  : settings.encryption}
              </dd>
            </div>
            <div>
              <dt>{t("configuration")}</dt>
              <dd>{settings.solid ? "Solid" : "Normal"}</dd>
            </div>
          </dl>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(event) => setOverwrite(event.target.checked)}
            />
            {t("allowOverwrite")}
          </label>
          <p className={styles.hint}>{t("estimatedNotGuaranteed")}</p>
          {validation && (
            <p
              id="create-validation"
              className={styles.validation}
              role="alert"
            >
              {validation}
            </p>
          )}
        </div>
      )}

      <footer className={styles.wizardActions}>
        {step > 1 && (
          <Button variant="soft" onClick={() => setStep((step - 1) as 1 | 2)}>
            {t("back")}
          </Button>
        )}
        <span />
        {step < 3 ? (
          <Button
            disabled={step === 1 && sources.length === 0}
            onClick={() => setStep((step + 1) as 2 | 3)}
          >
            {t("next")}
          </Button>
        ) : (
          <Button
            disabled={submitting || Boolean(validation)}
            aria-busy={submitting}
            aria-describedby={validation ? "create-validation" : undefined}
            onClick={start}
          >
            {submitting ? t("startingCreation") : t("startCreating")}
          </Button>
        )}
      </footer>
    </section>
  );
}
