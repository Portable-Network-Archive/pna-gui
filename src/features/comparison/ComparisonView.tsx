"use client";

import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button, RadioGroup, Spinner, TextField } from "@radix-ui/themes";
import { ArrowLeftIcon, MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { formatBytes } from "../archive/presentation";
import {
  type DifferenceKind,
  type ComparisonResult,
  type ComparisonSource,
  type JobSnapshot,
  jobApi,
} from "../jobs/api";
import { type TranslationKey, useI18n } from "../i18n";
import { createSingleFlightGate } from "../singleFlight";
import {
  comparisonApi,
  type ComparisonDifference,
  type ComparisonItem,
} from "./api";
import styles from "./ComparisonView.module.css";

const FILTERS: Array<{
  kind: DifferenceKind | null;
  label: TranslationKey;
  count: keyof ComparisonResult["summary"];
}> = [
  { kind: null, label: "allDifferences", count: "total" },
  { kind: "added", label: "differenceAdded", count: "added" },
  { kind: "removed", label: "differenceRemoved", count: "removed" },
  {
    kind: "content_changed",
    label: "differenceContentChanged",
    count: "contentChanged",
  },
  {
    kind: "metadata_changed",
    label: "differenceMetadataChanged",
    count: "metadataChanged",
  },
  { kind: "same", label: "differenceSame", count: "same" },
  {
    kind: "comparison_unavailable",
    label: "differenceUnavailable",
    count: "comparisonUnavailable",
  },
];

const STATUS_LABELS: Record<DifferenceKind, TranslationKey> = {
  same: "differenceSame",
  added: "differenceAdded",
  removed: "differenceRemoved",
  content_changed: "differenceContentChanged",
  metadata_changed: "differenceMetadataChanged",
  comparison_unavailable: "differenceUnavailable",
};

const METADATA_LABELS: Record<string, TranslationKey> = {
  created_at: "createdAt",
  modified_at: "modifiedAt",
  accessed_at: "accessedAt",
  permission: "permission",
  owner: "owner",
  group: "group",
  extended_attributes: "extendedAttributes",
  compression: "compression",
  encryption: "encryption",
};

function technicalDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function SourceCard({
  label,
  value,
  side,
  kindSelectable,
  onChange,
}: {
  label: string;
  value: ComparisonSource | null;
  side: "A" | "B";
  kindSelectable: boolean;
  onChange: (source: ComparisonSource | null) => void;
}) {
  const { t } = useI18n();
  const pickerGate = useMemo(() => createSingleFlightGate(), []);
  const [kind, setKind] = useState<ComparisonSource["kind"]>(
    value?.kind ?? "archive",
  );
  const [pickerError, setPickerError] = useState<string>();

  const choose = () =>
    pickerGate.run(`choose-${side}`, async () => {
      try {
        const selected = await openDialog(
          kind === "folder"
            ? {
                title: side === "A" ? t("chooseA") : t("chooseB"),
                directory: true,
                multiple: false,
              }
            : {
                title: side === "A" ? t("chooseA") : t("chooseB"),
                directory: false,
                multiple: false,
                filters: [{ name: "PNA archive", extensions: ["pna"] }],
              },
        );
        if (typeof selected !== "string") return;
        setPickerError(undefined);
        onChange({ kind, path: selected, password: null });
      } catch (error) {
        setPickerError(technicalDetail(error));
      }
    });

  return (
    <section className={styles.sourceCard} role="group" aria-label={label}>
      <header>
        <strong>{label}</strong>
        {kindSelectable ? (
          <RadioGroup.Root
            aria-label={`${label} source type`}
            value={kind}
            onValueChange={(next) => {
              const nextKind = next as ComparisonSource["kind"];
              setKind(nextKind);
              if (value && value.kind !== nextKind) onChange(null);
            }}
          >
            <RadioGroup.Item value="archive">{t("archive")}</RadioGroup.Item>
            <RadioGroup.Item value="folder">{t("folder")}</RadioGroup.Item>
          </RadioGroup.Root>
        ) : (
          <span className={styles.sourceKind}>{t("archive")}</span>
        )}
      </header>
      <div className={styles.sourcePath} aria-live="polite">
        {value?.path ?? "—"}
      </div>
      <Button type="button" variant="soft" onClick={() => void choose()}>
        {side === "A" ? t("chooseA") : t("chooseB")}
      </Button>
      {value?.kind === "archive" && (
        <label className={styles.passwordField}>
          <span>{t("password")}</span>
          <TextField.Root
            type="password"
            autoComplete="off"
            aria-label={`${label} ${t("password")}`}
            value={value.password ?? ""}
            onChange={(event) =>
              onChange({
                ...value,
                password: event.target.value || null,
              })
            }
            aria-describedby={`compare-${side}-password-hint`}
          />
          <small id={`compare-${side}-password-hint`}>
            {t("optionalArchivePassword")}
          </small>
        </label>
      )}
      {pickerError && (
        <details className={styles.inlineError} open>
          <summary>{t("comparisonSourcePickerFailed")}</summary>
          <small>{pickerError}</small>
        </details>
      )}
    </section>
  );
}

function ItemValues({
  title,
  sourcePath,
  item,
}: {
  title: string;
  sourcePath: string;
  item: ComparisonItem | null;
}) {
  const { locale, t } = useI18n();
  return (
    <section className={styles.valuePanel}>
      <h3>{title}</h3>
      <p className={styles.inspectorPath}>{sourcePath}</p>
      {item ? (
        <dl>
          <div>
            <dt>{t("itemType")}</dt>
            <dd>{item.kind}</dd>
          </div>
          <div>
            <dt>{t("size")}</dt>
            <dd>{item.size == null ? "—" : formatBytes(item.size, locale)}</dd>
          </div>
          <div>
            <dt>{t("contentHash")}</dt>
            <dd className={styles.hash}>{item.contentSha256 ?? "—"}</dd>
          </div>
          <div>
            <dt>{t("permission")}</dt>
            <dd>{item.permission ?? "—"}</dd>
          </div>
        </dl>
      ) : (
        <p className={styles.missingValue}>—</p>
      )}
    </section>
  );
}

export default function ComparisonView({
  initialLeft = null,
  jobId,
  result,
  onBack,
  onViewResult,
}: {
  initialLeft?: ComparisonSource | null;
  jobId?: string;
  result?: ComparisonResult;
  onBack: () => void;
  onViewResult?: (jobId: string, result: ComparisonResult) => void;
}) {
  const { t } = useI18n();
  const submitGate = useMemo(() => createSingleFlightGate(), []);
  const pageRequestRef = useRef(0);
  const [left, setLeft] = useState<ComparisonSource | null>(initialLeft);
  const [right, setRight] = useState<ComparisonSource | null>(null);
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(false);
  const [startedJobId, setStartedJobId] = useState<string>();
  const [startedJob, setStartedJob] = useState<JobSnapshot>();
  const [submitError, setSubmitError] = useState<string>();
  const [filter, setFilter] = useState<DifferenceKind | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ComparisonDifference[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [selected, setSelected] = useState<ComparisonDifference | null>(null);
  const [loading, setLoading] = useState(Boolean(jobId && result));
  const [loadError, setLoadError] = useState<string>();
  const sameSource = Boolean(
    left && right && left.kind === right.kind && left.path === right.path,
  );

  useEffect(() => {
    if (!startedJobId) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const accept = (job: JobSnapshot) => {
      if (!disposed && job.id === startedJobId) setStartedJob(job);
    };
    void jobApi
      .list()
      .then((jobs) => {
        const current = jobs.find((job) => job.id === startedJobId);
        if (current) accept(current);
      })
      .catch((error) => {
        if (!disposed) setSubmitError(technicalDetail(error));
      });
    void import("@tauri-apps/api/webviewWindow")
      .then(async ({ getCurrentWebviewWindow }) => {
        if (disposed) return;
        unlisten = await getCurrentWebviewWindow().listen<JobSnapshot>(
          "job-update",
          (event) => accept(event.payload),
        );
      })
      .catch((error) => {
        if (!disposed) setSubmitError(technicalDetail(error));
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [startedJobId]);

  const loadPage = async (cursor: number | null, append: boolean) => {
    if (!jobId) return;
    const requestId = ++pageRequestRef.current;
    setLoading(true);
    try {
      const page = await comparisonApi.page({
        jobId,
        kinds: filter ? [filter] : [],
        query,
        cursor,
        limit: 200,
      });
      if (requestId !== pageRequestRef.current) return;
      setItems((current) =>
        append ? [...current, ...page.items] : page.items,
      );
      setNextCursor(page.nextCursor ?? null);
      setLoadError(undefined);
    } catch (error) {
      if (requestId === pageRequestRef.current) {
        setLoadError(technicalDetail(error));
      }
    } finally {
      if (requestId === pageRequestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    setSelected(null);
    void loadPage(null, false);
    // loadPage intentionally follows the current result controls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, result, filter, query]);

  const submit = () =>
    submitGate.run("compare", async () => {
      if (!left || !right) {
        setSubmitError(t("comparisonSourceRequired"));
        return;
      }
      if (left.kind === right.kind && left.path === right.path) {
        setSubmitError(t("comparisonSameSource"));
        return;
      }
      setStarting(true);
      setSubmitError(undefined);
      try {
        const job = await jobApi.startCompare({ left, right });
        setStartedJobId(job.id);
        setStartedJob(job);
        setStarted(true);
      } catch (error) {
        setSubmitError(technicalDetail(error));
      } finally {
        setStarting(false);
      }
    });

  const applySearch = (event: FormEvent) => {
    event.preventDefault();
    setQuery(searchInput.trim());
  };
  const selectByKeyboard = (
    event: KeyboardEvent<HTMLTableRowElement>,
    item: ComparisonDifference,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setSelected(item);
  };

  if (!jobId || !result) {
    return (
      <main className={styles.view}>
        <header className={styles.pageHeader}>
          <Button
            type="button"
            variant="ghost"
            aria-label={t("backHome")}
            onClick={onBack}
          >
            <ArrowLeftIcon />
          </Button>
          <div>
            <h1>{t("compareArchives")}</h1>
            <p>{t("comparisonDescription")}</p>
          </div>
        </header>
        <div className={styles.setup}>
          <div className={styles.sourceGrid}>
            <SourceCard
              label={t("compareBaseline")}
              value={left}
              side="A"
              kindSelectable={false}
              onChange={setLeft}
            />
            <SourceCard
              label={t("compareTarget")}
              value={right}
              side="B"
              kindSelectable
              onChange={setRight}
            />
          </div>
          <p className={styles.readOnlyHint}>{t("comparisonReadOnlyHint")}</p>
          {sameSource && (
            <p className={styles.validationMessage} role="alert">
              {t("comparisonSameSource")}
            </p>
          )}
          {started &&
          startedJob?.status === "succeeded" &&
          startedJob.comparisonReport ? (
            <section className={styles.startedNotice} role="status">
              <strong>{t("comparisonCompleted")}</strong>
              <span>{t("comparisonCompletedHint")}</span>
              <Button
                type="button"
                size="1"
                variant="soft"
                onClick={() =>
                  onViewResult?.(startedJob.id, startedJob.comparisonReport!)
                }
              >
                {t("viewComparisonResults")}
              </Button>
            </section>
          ) : started &&
            startedJob &&
            ["failed", "cancelled", "interrupted"].includes(
              startedJob.status,
            ) ? (
            <section className={styles.submitError} role="alert">
              <strong>{t("comparisonDidNotComplete")}</strong>
              <span>{t("comparisonDidNotCompleteHint")}</span>
              {startedJob.error && <small>{startedJob.error}</small>}
            </section>
          ) : started ? (
            <section className={styles.startedNotice} role="status">
              <strong>{t("comparisonStarted")}</strong>
              <span>{t("comparisonStartedHint")}</span>
            </section>
          ) : null}
          {submitError && (
            <details className={styles.submitError} open>
              <summary>{t("errorInternal")}</summary>
              <small>{submitError}</small>
            </details>
          )}
          <div className={styles.setupActions}>
            <Button
              type="button"
              disabled={starting || !left || !right || sameSource}
              onClick={() => void submit()}
            >
              {starting ? (
                <>
                  <Spinner /> {t("startingComparison")}
                </>
              ) : (
                t("compareAAndB")
              )}
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.view} data-testid="comparison-results-view">
      <header className={styles.pageHeader}>
        <Button
          type="button"
          variant="ghost"
          aria-label={t("backHome")}
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </Button>
        <div>
          <h1>{t("comparisonResults")}</h1>
          <p className={styles.sourceIdentity}>
            <span>A</span> {result.left.path} <span>B</span> {result.right.path}
          </p>
        </div>
      </header>
      <nav className={styles.filters} aria-label={t("status")}>
        {FILTERS.map((item) => (
          <Button
            key={item.kind ?? "all"}
            type="button"
            variant={filter === item.kind ? "solid" : "soft"}
            aria-label={`${t(item.label)} ${result.summary[item.count]}`}
            onClick={() => setFilter(item.kind)}
          >
            {t(item.label)}
            <span>{result.summary[item.count]}</span>
          </Button>
        ))}
      </nav>
      <form className={styles.search} onSubmit={applySearch}>
        <TextField.Root
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder={t("comparisonSearchPlaceholder")}
          aria-label={t("comparisonSearchPlaceholder")}
        >
          <TextField.Slot>
            <MagnifyingGlassIcon />
          </TextField.Slot>
        </TextField.Root>
        <Button type="submit" variant="soft">
          {t("searchComparison")}
        </Button>
        {query && (
          <Button
            type="button"
            variant="ghost"
            color="gray"
            onClick={() => {
              setSearchInput("");
              setQuery("");
            }}
          >
            {t("clearSearch")}
          </Button>
        )}
      </form>
      <div className={styles.resultsLayout}>
        <section className={styles.tablePanel}>
          {loadError && (
            <details className={styles.inlineError} open>
              <summary>{t("comparisonLoadFailed")}</summary>
              <small>{loadError}</small>
            </details>
          )}
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t("path")}</th>
                <th>{t("status")}</th>
                <th>{t("size")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={`${item.kind}:${item.path}`}
                  data-comparison-path={item.path}
                  tabIndex={0}
                  aria-selected={selected === item}
                  onClick={() => setSelected(item)}
                  onKeyDown={(event) => selectByKeyboard(event, item)}
                >
                  <td>{item.path}</td>
                  <td>
                    <span className={styles.status} data-kind={item.kind}>
                      {t(STATUS_LABELS[item.kind])}
                    </span>
                  </td>
                  <td>
                    {item.left && item.right
                      ? `${item.left.size} → ${item.right.size}`
                      : formatBytes(
                          item.left?.size ?? item.right?.size ?? 0,
                          "en",
                        )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && items.length === 0 && (
            <p className={styles.empty}>{t("noDifferencesMatch")}</p>
          )}
          {loading && (
            <p className={styles.loading} role="status">
              <Spinner /> {t("listingLoading")}
            </p>
          )}
          {nextCursor !== null && (
            <Button
              type="button"
              variant="soft"
              disabled={loading}
              onClick={() => void loadPage(nextCursor, true)}
            >
              {t("loadMore")}
            </Button>
          )}
        </section>
        <aside className={styles.inspector} aria-label={t("differenceDetails")}>
          <h2>{t("differenceDetails")}</h2>
          {selected ? (
            <>
              <p className={styles.selectedPath}>{selected.path}</p>
              <div className={styles.valueGrid}>
                <ItemValues
                  title={t("sourceA")}
                  sourcePath={result.left.path}
                  item={selected.left ?? null}
                />
                <ItemValues
                  title={t("sourceB")}
                  sourcePath={result.right.path}
                  item={selected.right ?? null}
                />
              </div>
              {selected.metadataDifferences.length > 0 && (
                <section className={styles.metadataDifferences}>
                  <h3>{t("metadataDifferences")}</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>{t("property")}</th>
                        <th>{t("sourceA")}</th>
                        <th>{t("sourceB")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.metadataDifferences.map((difference) => (
                        <tr key={difference.field}>
                          <th>
                            {METADATA_LABELS[difference.field]
                              ? t(METADATA_LABELS[difference.field])
                              : difference.field}
                          </th>
                          <td>{difference.left ?? "—"}</td>
                          <td>{difference.right ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}
            </>
          ) : (
            <p className={styles.inspectorEmpty}>{t("selectDifferenceHint")}</p>
          )}
        </aside>
      </div>
    </main>
  );
}
