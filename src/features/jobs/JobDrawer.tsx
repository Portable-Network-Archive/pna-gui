"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircledIcon,
  CrossCircledIcon,
  Cross2Icon,
  ExclamationTriangleIcon,
  InfoCircledIcon,
  ReloadIcon,
} from "@radix-ui/react-icons";
import { Button, Dialog, Flex } from "@radix-ui/themes";
import {
  jobApi,
  type JobSnapshot,
  type JobStatus,
  type VerificationReport,
} from "./api";
import { TranslationKey, useI18n } from "../i18n";
import styles from "./JobDrawer.module.css";

const ACTIVE = new Set<JobStatus>(["queued", "running", "cancel_requested"]);

const STATUS_KEYS: Record<JobStatus, TranslationKey> = {
  queued: "jobStatusQueued",
  running: "jobStatusRunning",
  cancel_requested: "jobStatusCancelling",
  cancelled: "jobStatusCancelled",
  succeeded: "jobStatusSucceeded",
  failed: "jobStatusFailed",
  interrupted: "jobStatusInterrupted",
};

function jobSequence(id: string): number {
  const value = Number(id.slice(id.lastIndexOf("-") + 1));
  return Number.isFinite(value) ? value : 0;
}

export default function JobDrawer({
  onOpenArchive,
  onCreatedArchive,
  onViewVerification,
}: {
  onOpenArchive?: (path: string) => void | Promise<void>;
  onCreatedArchive?: () => void | Promise<void>;
  onViewVerification?: (report: VerificationReport) => void;
}) {
  const { t } = useI18n();
  const [jobs, setJobs] = useState<JobSnapshot[]>([]);
  const [open, setOpen] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [listError, setListError] = useState<string>();
  const [listenError, setListenError] = useState<string>();

  const syncErrorMessage = useCallback(
    (caught: unknown) => {
      const detail = caught instanceof Error ? caught.message : String(caught);
      return `${t("jobSyncFailed")}: ${detail}`;
    },
    [t],
  );
  const refreshJobs = useCallback(async () => {
    try {
      const items = await jobApi.list();
      if (Array.isArray(items)) setJobs(items);
      setListError(undefined);
    } catch (caught) {
      setListError(syncErrorMessage(caught));
    }
  }, [syncErrorMessage]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void refreshJobs();
    void import("@tauri-apps/api/webviewWindow")
      .then(async ({ getCurrentWebviewWindow }) => {
        if (disposed) return;
        unlisten = await getCurrentWebviewWindow().listen<JobSnapshot>(
          "job-update",
          (event) => {
            setListenError(undefined);
            setJobs((current) => {
              const remaining = current.filter(
                (job) => job.id !== event.payload.id,
              );
              return [...remaining, event.payload];
            });
            if (
              event.payload.kind === "create" &&
              event.payload.status === "succeeded" &&
              event.payload.outputPath
            ) {
              void onCreatedArchive?.();
            }
          },
        );
      })
      .catch((caught) => {
        if (!disposed) setListenError(syncErrorMessage(caught));
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [onCreatedArchive, refreshJobs, syncErrorMessage]);

  const visible = useMemo(
    () =>
      [...jobs].sort(
        (left, right) => jobSequence(right.id) - jobSequence(left.id),
      ),
    [jobs],
  );
  const syncError = listError ?? listenError;
  if (visible.length === 0 && !syncError) return null;

  const activeCount = visible.filter((job) => ACTIVE.has(job.status)).length;
  const finishedCount = visible.length - activeCount;
  const current = visible[0];
  const reportActionError = (caught: unknown) => {
    const detail = caught instanceof Error ? caught.message : String(caught);
    setActionError(`${t("jobActionFailed")}: ${detail}`);
  };
  const dismiss = async (jobId: string) => {
    setActionError(undefined);
    try {
      setJobs(await jobApi.dismiss(jobId));
    } catch (caught) {
      reportActionError(caught);
    }
  };
  const reveal = async (jobId: string) => {
    setActionError(undefined);
    try {
      await jobApi.revealOutput(jobId);
    } catch (caught) {
      reportActionError(caught);
    }
  };
  const cancel = async (jobId: string) => {
    setActionError(undefined);
    try {
      await jobApi.cancel(jobId);
    } catch (caught) {
      reportActionError(caught);
    }
  };
  const retry = async (jobId: string) => {
    setActionError(undefined);
    try {
      await jobApi.retry(jobId);
    } catch (caught) {
      reportActionError(caught);
    }
  };
  const openArchive = async (path: string) => {
    setActionError(undefined);
    setOpen(false);
    try {
      await onOpenArchive?.(path);
    } catch (caught) {
      reportActionError(caught);
    }
  };
  const viewVerification = (report: VerificationReport) => {
    setOpen(false);
    onViewVerification?.(report);
  };
  const clearFinished = async () => {
    setActionError(undefined);
    try {
      for (const job of visible.filter((item) => !ACTIVE.has(item.status))) {
        await jobApi.dismiss(job.id);
      }
      setJobs(await jobApi.list());
    } catch (caught) {
      reportActionError(caught);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) void refreshJobs();
      }}
    >
      <section className={styles.bar} aria-label={t("backgroundJobs")}>
        <Dialog.Trigger>
          <button
            type="button"
            className={styles.summary}
            aria-label={t("jobCenter")}
          >
            <span className={styles.summaryIcon} aria-hidden="true">
              <ReloadIcon />
            </span>
            <span>
              <strong>{t("jobCenter")}</strong>
              <small>
                {activeCount > 0 && finishedCount > 0
                  ? `${activeCount} ${t("activeJobs")} · ${finishedCount} ${t("finishedJobs")}`
                  : activeCount > 0
                    ? `${activeCount} ${t("activeJobs")}`
                    : finishedCount > 0
                      ? `${finishedCount} ${t("finishedJobs")}`
                      : t("noActiveJobs")}
              </small>
            </span>
          </button>
        </Dialog.Trigger>
        {current && (
          <JobRow
            job={current}
            compact
            onDismiss={dismiss}
            onReveal={reveal}
            onCancel={cancel}
            onRetry={retry}
            onOpenArchive={onOpenArchive ? openArchive : undefined}
            onViewVerification={
              onViewVerification ? viewVerification : undefined
            }
          />
        )}
        {syncError && !open && (
          <ActionError
            message={syncError}
            onDismiss={() => {
              setListError(undefined);
              setListenError(undefined);
            }}
          />
        )}
        {actionError && !open && (
          <ActionError
            message={actionError}
            onDismiss={() => setActionError(undefined)}
          />
        )}
      </section>

      <Dialog.Content className={styles.center} maxWidth="760px">
        <Dialog.Title>{t("jobCenter")}</Dialog.Title>
        <Dialog.Description>{t("jobCenterDescription")}</Dialog.Description>
        <div className={styles.centerToolbar}>
          <span>
            {t("jobCount").replace("{count}", String(visible.length))}
          </span>
          <Button
            type="button"
            size="1"
            variant="soft"
            color="gray"
            disabled={visible.every((job) => ACTIVE.has(job.status))}
            onClick={() => void clearFinished()}
          >
            {t("clearFinishedJobs").replace("{count}", String(finishedCount))}
          </Button>
        </div>
        <div className={styles.centerList}>
          {visible.length === 0 && <p>{t("noActiveJobs")}</p>}
          {visible.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              onDismiss={dismiss}
              onReveal={reveal}
              onCancel={cancel}
              onRetry={retry}
              onOpenArchive={onOpenArchive ? openArchive : undefined}
              onViewVerification={
                onViewVerification ? viewVerification : undefined
              }
            />
          ))}
        </div>
        {actionError && open && (
          <ActionError
            message={actionError}
            onDismiss={() => setActionError(undefined)}
          />
        )}
        {syncError && open && (
          <ActionError
            message={syncError}
            onDismiss={() => {
              setListError(undefined);
              setListenError(undefined);
            }}
          />
        )}
        <Flex mt="4" justify="end">
          <Dialog.Close>
            <Button type="button" variant="soft" color="gray">
              {t("close")}
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function JobRow({
  job,
  compact = false,
  onDismiss,
  onReveal,
  onCancel,
  onRetry,
  onOpenArchive,
  onViewVerification,
}: {
  job: JobSnapshot;
  compact?: boolean;
  onDismiss: (jobId: string) => Promise<void>;
  onReveal: (jobId: string) => Promise<void>;
  onCancel: (jobId: string) => Promise<void>;
  onRetry: (jobId: string) => Promise<void>;
  onOpenArchive?: (path: string) => void | Promise<void>;
  onViewVerification?: (report: VerificationReport) => void;
}) {
  const { t } = useI18n();
  const canCancel = job.status === "queued" || job.status === "running";
  const canRetry = ["failed", "cancelled", "interrupted"].includes(job.status);
  const canDismiss = !ACTIVE.has(job.status);
  const canOpenArchiveOutput = !["extract", "split", "verify"].includes(
    job.kind,
  );
  const presentedError = job.error ? presentJobError(job, t) : undefined;
  const progress = job.totalUnits
    ? `${job.completedUnits} ${t("of")} ${job.totalUnits}`
    : `${job.completedUnits}`;
  const status = job.verificationReport
    ? job.verificationReport.conclusion === "passed" &&
      job.verificationReport.mode === "quick"
      ? t("quickVerificationCompleted")
      : {
          passed: t("verificationPassed"),
          issues_found: t("verificationIssuesFound"),
          incomplete: t("verificationIncomplete"),
        }[job.verificationReport.conclusion]
    : t(STATUS_KEYS[job.status]);
  const detail =
    job.verificationReport?.archivePath ??
    (ACTIVE.has(job.status)
      ? (job.currentItem ?? job.outputPath ?? status)
      : (job.outputPath ?? job.currentItem ?? status));
  const outputIdentity =
    job.outputPath && detail === job.outputPath
      ? splitResultPath(job.outputPath)
      : undefined;
  const icon =
    job.verificationReport?.conclusion === "issues_found" ? (
      <ExclamationTriangleIcon />
    ) : job.verificationReport?.conclusion === "incomplete" ? (
      <InfoCircledIcon />
    ) : job.status === "succeeded" ? (
      <CheckCircledIcon />
    ) : job.status === "failed" || job.status === "interrupted" ? (
      <ExclamationTriangleIcon />
    ) : job.status === "cancelled" ? (
      <CrossCircledIcon />
    ) : (
      <ReloadIcon />
    );

  return (
    <article
      className={styles.job}
      data-status={job.status}
      data-verification={job.verificationReport?.conclusion}
    >
      <span className={styles.statusIcon} aria-hidden="true">
        {icon}
      </span>
      <div className={styles.jobInfo}>
        <div className={styles.jobTitle}>
          <strong>
            {
              {
                create: t("createJob"),
                extract: t("extractJob"),
                append: t("appendJob"),
                delete: t("deleteJob"),
                rename: t("renameJob"),
                split: t("splitJob"),
                concat: t("concatJob"),
                sort: t("sortJob"),
                strip: t("stripJob"),
                migrate: t("migrateJob"),
                verify: t("verificationJob"),
              }[job.kind]
            }
          </strong>
          {job.verificationReport && (
            <small>
              {job.verificationReport.mode === "quick"
                ? t("quickVerification")
                : t("completeVerification")}
            </small>
          )}
          <span
            aria-live={ACTIVE.has(job.status) ? undefined : "polite"}
            aria-atomic={ACTIVE.has(job.status) ? undefined : "true"}
          >
            {status}
          </span>
        </div>
        {outputIdentity ? (
          <span
            className={styles.outputIdentity}
            aria-label={detail}
            title={detail}
          >
            <strong>{outputIdentity.name}</strong>
            {outputIdentity.parent && <small>{outputIdentity.parent}</small>}
          </span>
        ) : (
          <span className={styles.jobDetail} title={detail}>
            {detail}
          </span>
        )}
        {ACTIVE.has(job.status) && job.totalUnits ? (
          <progress
            aria-label={`${status}: ${progress}`}
            value={job.completedUnits}
            max={job.totalUnits}
          />
        ) : null}
        {job.status === "cancel_requested" && (
          <small className={styles.cancelHint} role="status">
            {t("jobCancelWaiting")}
          </small>
        )}
        {!compact && <small className={styles.numeric}>{progress}</small>}
        {presentedError && (
          <small className={styles.error} role="alert">
            {presentedError.message}
          </small>
        )}
        {presentedError?.action && (
          <small className={styles.errorRecovery}>
            {presentedError.action}
          </small>
        )}
        {job.warnings?.map((warning) => (
          <small key={warning} className={styles.warning} role="status">
            {warning}
          </small>
        ))}
      </div>
      <div className={styles.actions}>
        {canCancel && (
          <Button
            type="button"
            size="1"
            variant="soft"
            color="gray"
            aria-label={t("cancelJob")}
            onClick={() => void onCancel(job.id)}
          >
            {t("cancel")}
          </Button>
        )}
        {canRetry && (
          <Button
            type="button"
            size="1"
            variant="soft"
            aria-label={t("retryJob")}
            onClick={() => void onRetry(job.id)}
          >
            {t("retry")}
          </Button>
        )}
        {canDismiss && job.outputPath && (
          <Button
            type="button"
            size="1"
            variant="soft"
            color="gray"
            onClick={() => void onReveal(job.id)}
          >
            {t("showInFolder")}
          </Button>
        )}
        {job.status === "succeeded" &&
          canOpenArchiveOutput &&
          job.outputPath &&
          onOpenArchive && (
            <Button
              type="button"
              size="1"
              variant="soft"
              data-testid="open-created-archive"
              onClick={() => void onOpenArchive(job.outputPath!)}
            >
              {job.kind === "create"
                ? t("openCreatedArchive")
                : t("openJobOutput")}
            </Button>
          )}
        {job.status === "succeeded" &&
          job.verificationReport &&
          onViewVerification && (
            <Button
              type="button"
              size="1"
              variant="soft"
              onClick={() => onViewVerification(job.verificationReport!)}
            >
              {t("viewVerificationResults")}
            </Button>
          )}
        {canDismiss && (
          <button
            type="button"
            className={styles.dismissButton}
            data-testid={`dismiss-job-${job.id}`}
            aria-label={t("dismissCompletedJob")}
            onClick={() => void onDismiss(job.id)}
          >
            <Cross2Icon aria-hidden="true" />
          </button>
        )}
      </div>
    </article>
  );
}

function presentJobError(
  job: JobSnapshot,
  t: (key: TranslationKey) => string,
): { message: string; action?: string } {
  if (job.errorCode === "OUTPUT_ALREADY_EXISTS") {
    return {
      message: t("jobOutputAlreadyExists"),
      action: t("jobOutputAlreadyExistsAction"),
    };
  }
  return { message: job.error ?? t("jobStatusFailed") };
}

function splitResultPath(path: string): { name: string; parent: string } {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (separator < 0) return { name: path, parent: "" };
  return {
    name: path.slice(separator + 1),
    parent: path.slice(0, separator) || path.slice(0, 1),
  };
}

function ActionError({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.actionError} role="alert">
      <span>{message}</span>
      <button type="button" aria-label={t("dismissError")} onClick={onDismiss}>
        <Cross2Icon aria-hidden="true" />
      </button>
    </div>
  );
}
