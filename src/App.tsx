"use client";

import { KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronRightIcon,
  ClockIcon,
  Cross2Icon,
  FileIcon,
  HomeIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ReloadIcon,
  DownloadIcon,
} from "@radix-ui/react-icons";
import {
  Button,
  Dialog,
  Flex,
  Spinner,
  Text,
  TextField,
} from "@radix-ui/themes";
import { getMatches } from "@tauri-apps/plugin-cli";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Create } from "./tabs";
import { registerE2eBridge } from "@pna/e2e-bridge";
import { archiveApi, normalizeAppError } from "./features/archive/api";
import { ArchiveTreeRow, FolderGlyph } from "./features/archive/ArchiveTreeRow";
import {
  formatAttributeCount,
  formatItemCount,
  I18nProvider,
  useI18n,
} from "./features/i18n";
import {
  formatBytes,
  formatCount,
  formatDateTime,
  formatOptionalBytes,
  formatOptionalDate,
  kindLabel,
  localizeEncryption,
  localizeEncryptionList,
  localizeError,
  previewMessage,
} from "./features/archive/presentation";
import type {
  AppErrorDto,
  ArchiveEntry,
  ArchiveRecent,
  BootstrapSnapshot,
  EntryDetails,
  FolderLocation,
  OpenArchiveResult,
  PreviewDescriptor,
  SortSpec,
} from "./features/archive/types";
import styles from "./App.module.css";
import { jobApi } from "./features/jobs/api";
import JobDrawer from "./features/jobs/JobDrawer";

registerE2eBridge();

type AppView = "home" | "browser" | "create";
type TreePages = Record<string, ArchiveEntry[]>;

export default function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
}

function AppContent() {
  const { t } = useI18n();
  const [view, setView] = useState<AppView>("home");
  const [bootstrap, setBootstrap] = useState<BootstrapSnapshot>({
    productName: "Portable Network Archive",
    recent: [],
  });
  const [openArchive, setOpenArchive] = useState<OpenArchiveResult>();
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<AppErrorDto>();
  const [passwordPath, setPasswordPath] = useState<string>();
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string>();
  const openingRef = useRef(false);

  const refreshBootstrap = useCallback(async () => {
    try {
      setBootstrap(await archiveApi.bootstrap());
    } catch (caught) {
      setError(normalizeAppError(caught));
    }
  }, []);

  const openArchivePath = useCallback(
    async (path: string, suppliedPassword?: string) => {
      if (openingRef.current) return;
      openingRef.current = true;
      setBusy(true);
      setError(undefined);
      try {
        const result = await archiveApi.open(path, suppliedPassword);
        setOpenArchive(result);
        setView("browser");
        setPasswordPath(undefined);
        setPassword("");
        setPasswordError(undefined);
        await refreshBootstrap();
      } catch (caught) {
        const appError = normalizeAppError(caught);
        if (
          appError.code === "PASSWORD_REQUIRED" ||
          appError.code === "WRONG_PASSWORD"
        ) {
          setPasswordPath(path);
          setPassword("");
          setPasswordError(
            appError.code === "WRONG_PASSWORD"
              ? localizeError(appError, t).message
              : undefined,
          );
        } else {
          setError({ ...appError, context: path });
        }
      } finally {
        openingRef.current = false;
        setBusy(false);
      }
    },
    [refreshBootstrap, t],
  );

  const chooseArchive = useCallback(async () => {
    const selected = await openDialog({
      title: t("openArchiveTitle"),
      multiple: false,
      filters: [{ name: "Portable Network Archive", extensions: ["pna"] }],
    });
    if (typeof selected === "string") await openArchivePath(selected);
  }, [openArchivePath, t]);

  const goHome = useCallback(async () => {
    if (openArchive) {
      await archiveApi.close(openArchive.handle).catch(() => undefined);
    }
    setOpenArchive(undefined);
    setView("home");
    setError(undefined);
  }, [openArchive]);

  useEffect(() => {
    void refreshBootstrap();
  }, [refreshBootstrap]);

  useEffect(() => {
    let disposed = false;
    let cleanups: Array<() => void> = [];
    void import("@tauri-apps/api/webviewWindow").then(
      async ({ getCurrentWebviewWindow }) => {
        if (disposed) return;
        const appWindow = getCurrentWebviewWindow();
        const unlistenDrop = await appWindow.onDragDropEvent((event) => {
          if (view === "create") return;
          if (event.payload.type === "enter") setDragActive(true);
          if (event.payload.type === "leave") setDragActive(false);
          if (event.payload.type === "drop") {
            setDragActive(false);
            const archive = event.payload.paths.find((path) =>
              path.toLowerCase().endsWith(".pna"),
            );
            if (archive) void openArchivePath(archive);
          }
        });
        const unlistenMenu = await appWindow.listen<"extract" | "create">(
          "switch_tab",
          (event) => {
            if (event.payload === "create") setView("create");
            else void chooseArchive();
          },
        );
        cleanups = [unlistenDrop, unlistenMenu];
      },
    );
    void getMatches()
      .then((matches) => {
        const source = matches.args.source?.value;
        const path =
          typeof source === "string"
            ? source
            : Array.isArray(source)
              ? source[0]
              : null;
        if (path) return openArchivePath(path);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [chooseArchive, openArchivePath, view]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        void chooseArchive();
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        setView("create");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chooseArchive]);

  const removeRecent = async (path: string) => {
    try {
      const recent = await archiveApi.removeRecent(path);
      setBootstrap((current) => ({ ...current, recent }));
    } catch (caught) {
      setError(normalizeAppError(caught));
    }
  };

  return (
    <div className={styles.root}>
      {view === "home" && (
        <HomeView
          productName={bootstrap.productName}
          recent={bootstrap.recent}
          error={error}
          onDismissError={() => setError(undefined)}
          onOpen={chooseArchive}
          onCreate={() => setView("create")}
          onOpenRecent={openArchivePath}
          onRemoveRecent={removeRecent}
        />
      )}
      {view === "browser" && openArchive && (
        <BrowserView
          archive={openArchive}
          error={error}
          onDismissError={() => setError(undefined)}
          onHome={goHome}
          onOpen={chooseArchive}
          onError={setError}
        />
      )}
      {view === "create" && (
        <div className={styles.legacyView}>
          <header className={styles.legacyHeader}>
            <button
              className={styles.toolbarButton}
              onClick={() => setView("home")}
            >
              <ArrowLeftIcon aria-hidden="true" /> {t("backHome")}
            </button>
            <div>
              <strong>{t("createArchive")}</strong>
              <span>{t("createArchiveSubtitle")}</span>
            </div>
          </header>
          <div className={styles.legacyContent}>
            <Create />
          </div>
        </div>
      )}

      {dragActive && (
        <div className={styles.dropOverlay} role="status">
          <ArchiveIcon aria-hidden="true" />
          <strong>{t("dropArchive")}</strong>
        </div>
      )}
      {busy && (
        <div className={styles.busyOverlay} role="status" aria-live="polite">
          <div className={styles.busyCard}>
            <Spinner size="3" />
            <strong>{t("loadingArchive")}</strong>
            <span>{t("preparingIndex")}</span>
          </div>
        </div>
      )}

      <Dialog.Root
        open={Boolean(passwordPath)}
        onOpenChange={(open) => {
          if (!open) {
            setPasswordPath(undefined);
            setPassword("");
            setPasswordError(undefined);
          }
        }}
      >
        <Dialog.Content maxWidth="420px">
          <Dialog.Title>{t("passwordRequired")}</Dialog.Title>
          <Dialog.Description size="2" color="gray">
            {t("encryptedArchive")}
          </Dialog.Description>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (passwordPath && password)
                void openArchivePath(passwordPath, password);
            }}
          >
            <label className={styles.dialogField}>
              <Text size="2" weight="medium">
                {t("password")}
              </Text>
              <TextField.Root
                autoFocus
                type="password"
                name="archive-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setPasswordError(undefined);
                }}
                autoComplete="current-password"
              />
              {passwordError && (
                <Text size="1" color="red" role="alert">
                  {passwordError}
                </Text>
              )}
            </label>
            <Flex gap="3" mt="5" justify="end">
              <Dialog.Close>
                <Button type="button" variant="soft" color="gray">
                  {t("cancel")}
                </Button>
              </Dialog.Close>
              <Button
                type="submit"
                data-testid="archive-password-submit"
                disabled={!password || busy}
              >
                {t("open")}
              </Button>
            </Flex>
          </form>
        </Dialog.Content>
      </Dialog.Root>
      <JobDrawer
        onOpenArchive={openArchivePath}
        onCreatedArchive={refreshBootstrap}
      />
    </div>
  );
}

interface HomeViewProps {
  productName: string;
  recent: ArchiveRecent[];
  error?: AppErrorDto;
  onDismissError: () => void;
  onOpen: () => void;
  onCreate: () => void;
  onOpenRecent: (path: string) => void;
  onRemoveRecent: (path: string) => void;
}

function HomeView({
  productName,
  recent,
  error,
  onDismissError,
  onOpen,
  onCreate,
  onOpenRecent,
  onRemoveRecent,
}: HomeViewProps) {
  const { locale, t } = useI18n();
  const [selectedPath, setSelectedPath] = useState<string>();
  const selected = recent.find((item) => item.path === selectedPath);

  return (
    <div className={styles.shell} data-testid="home-view">
      <AppToolbar title={productName} onOpen={onOpen} onCreate={onCreate} />
      {error && (
        <ErrorBanner
          error={error}
          onDismiss={onDismissError}
          onChooseAnother={onOpen}
        />
      )}
      <div className={styles.workspace}>
        <aside className={styles.sidebar} aria-label={t("navigation")}>
          <div className={styles.sidebarTitle}>{t("navigation")}</div>
          <div
            className={`${styles.navItem} ${styles.navItemActive} ${styles.navItemStatic}`}
            aria-current="page"
          >
            <HomeIcon aria-hidden="true" /> {t("home")}
          </div>
          <div className={styles.sidebarSection}>
            <span>{t("archives")}</span>
          </div>
          <div className={`${styles.navItem} ${styles.navItemStatic}`}>
            <ClockIcon aria-hidden="true" /> {t("recent")}
            <span className={styles.countBadge}>{recent.length}</span>
          </div>
          <p className={styles.sidebarHint}>{t("dropHint")}</p>
        </aside>

        <main className={styles.homeMain}>
          <div className={styles.sectionHeading}>
            <div>
              <h1>{t("recentArchives")}</h1>
              <p>{t("recentArchivesHint")}</p>
            </div>
          </div>
          <div className={styles.actionGrid}>
            <button className={styles.actionCard} onClick={onOpen}>
              <span className={styles.actionIcon}>
                <FolderGlyph />
              </span>
              <span>
                <strong>{t("openArchive")}</strong>
                <small>{t("openArchiveDescription")}</small>
              </span>
              <ArrowRightIcon aria-hidden="true" />
            </button>
            <button className={styles.actionCard} onClick={onCreate}>
              <span className={styles.actionIcon}>
                <PlusIcon aria-hidden="true" />
              </span>
              <span>
                <strong>{t("createArchive")}</strong>
                <small>{t("createArchiveDescription")}</small>
              </span>
              <ArrowRightIcon aria-hidden="true" />
            </button>
          </div>

          <section
            className={styles.recentPanel}
            aria-label={t("recentArchives")}
          >
            {recent.length === 0 ? (
              <div className={styles.emptyState}>
                <ArchiveIcon aria-hidden="true" />
                <strong>{t("noRecentArchives")}</strong>
                <p>{t("noRecentArchivesHint")}</p>
                <Button onClick={onOpen}>{t("openArchive")}</Button>
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t("name")}</th>
                    <th>{t("items")}</th>
                    <th>{t("size")}</th>
                    <th>{t("lastUsed")}</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((item) => (
                    <tr
                      key={item.path}
                      className={
                        selectedPath === item.path
                          ? styles.selectedRow
                          : undefined
                      }
                      onClick={() => setSelectedPath(item.path)}
                      onDoubleClick={() => onOpenRecent(item.path)}
                    >
                      <td>
                        <button
                          className={styles.nameButton}
                          onClick={() => onOpenRecent(item.path)}
                        >
                          <ArchiveIcon aria-hidden="true" />
                          <span>
                            <strong>{item.displayName}</strong>
                            <small>{item.path}</small>
                          </span>
                        </button>
                      </td>
                      <td className={styles.numeric}>
                        {formatCount(item.entryCount, locale)}
                      </td>
                      <td className={styles.numeric}>
                        {formatBytes(item.storedBytes, locale)}
                      </td>
                      <td>{formatDateTime(item.lastOpenedAt, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </main>

        <aside className={styles.inspector} aria-label={t("selectedArchive")}>
          <h2>{t("selectedArchive")}</h2>
          {selected ? (
            <div className={styles.summaryInspector}>
              <ArchiveIcon className={styles.largeArchiveIcon} />
              <strong>{selected.displayName}</strong>
              <span className={styles.pathText}>{selected.path}</span>
              <DefinitionList
                items={[
                  [t("items"), formatCount(selected.entryCount, locale)],
                  [t("size"), formatBytes(selected.storedBytes, locale)],
                  [
                    t("lastUsed"),
                    formatDateTime(selected.lastOpenedAt, locale),
                  ],
                ]}
              />
              <div className={styles.inspectorActions}>
                <Button onClick={() => onOpenRecent(selected.path)}>
                  {t("showContents")}
                </Button>
                <Button
                  color="gray"
                  variant="soft"
                  onClick={() => onRemoveRecent(selected.path)}
                >
                  {t("removeFromRecent")}
                </Button>
              </div>
            </div>
          ) : (
            <div className={styles.inspectorEmpty}>
              <ArchiveIcon />
              <p>{t("selectArchiveHint")}</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

interface BrowserViewProps {
  archive: OpenArchiveResult;
  error?: AppErrorDto;
  onDismissError: () => void;
  onHome: () => void;
  onOpen: () => void;
  onError: (error: AppErrorDto) => void;
}

function BrowserView({
  archive,
  error,
  onDismissError,
  onHome,
  onOpen,
  onError,
}: BrowserViewProps) {
  const { locale, t } = useI18n();
  const rootLocation: FolderLocation = { name: t("root"), path: "" };
  const [history, setHistory] = useState<FolderLocation[][]>([[rootLocation]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [items, setItems] = useState<ArchiveEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [totalCount, setTotalCount] = useState(0);
  const [listBusy, setListBusy] = useState(true);
  const [sort, setSort] = useState<SortSpec>({
    field: "name",
    direction: "asc",
  });
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [details, setDetails] = useState<EntryDetails>();
  const [preview, setPreview] = useState<PreviewDescriptor>();
  const [treePages, setTreePages] = useState<TreePages>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["root"]));
  const [extractOpen, setExtractOpen] = useState(false);

  const currentTrail = history[historyIndex];
  const current = currentTrail[currentTrail.length - 1];

  const loadTreeChildren = useCallback(
    async (parentId?: string) => {
      const key = parentId ?? "root";
      if (treePages[key]) return;
      try {
        const page = await archiveApi.children(
          archive.handle,
          parentId,
          undefined,
          { field: "name", direction: "asc" },
        );
        setTreePages((currentPages) => ({
          ...currentPages,
          [key]: page.items,
        }));
      } catch (caught) {
        onError(normalizeAppError(caught));
      }
    },
    [archive.handle, onError, treePages],
  );

  useEffect(() => {
    void loadTreeChildren();
  }, [loadTreeChildren]);

  useEffect(() => {
    let active = true;
    setListBusy(true);
    setSelectedId(undefined);
    setDetails(undefined);
    setPreview(undefined);
    const request = query
      ? archiveApi.search(archive.handle, query)
      : archiveApi.children(archive.handle, current.id, undefined, sort);
    void request
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setNextCursor(page.nextCursor ?? undefined);
        setTotalCount(page.totalCount);
      })
      .catch((caught) => active && onError(normalizeAppError(caught)))
      .finally(() => active && setListBusy(false));
    return () => {
      active = false;
    };
  }, [archive.handle, current.id, onError, query, sort]);

  const navigate = (trail: FolderLocation[]) => {
    setHistory((currentHistory) => [
      ...currentHistory.slice(0, historyIndex + 1),
      trail,
    ]);
    setHistoryIndex((index) => index + 1);
    setQuery("");
    setQueryInput("");
  };

  const openEntry = (entry: ArchiveEntry) => {
    if (entry.kind === "directory") {
      navigate([
        ...currentTrail,
        { id: entry.id, name: entry.name, path: entry.path },
      ]);
    } else {
      void selectEntry(entry);
    }
  };

  const selectEntry = async (entry: ArchiveEntry) => {
    setSelectedId(entry.id);
    setDetails(undefined);
    setPreview(undefined);
    try {
      const detail = await archiveApi.details(archive.handle, entry.id);
      setDetails(detail);
      if (entry.kind === "file") {
        setPreview(await archiveApi.preview(archive.handle, entry.id));
      }
    } catch (caught) {
      onError(normalizeAppError(caught));
    }
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    setListBusy(true);
    try {
      const page = query
        ? await archiveApi.search(archive.handle, query, nextCursor)
        : await archiveApi.children(
            archive.handle,
            current.id,
            nextCursor,
            sort,
          );
      setItems((currentItems) => [...currentItems, ...page.items]);
      setNextCursor(page.nextCursor ?? undefined);
      setTotalCount(page.totalCount);
    } catch (caught) {
      onError(normalizeAppError(caught));
    } finally {
      setListBusy(false);
    }
  };

  const toggleSort = (field: SortSpec["field"]) => {
    setSort((currentSort) => ({
      field,
      direction:
        currentSort.field === field && currentSort.direction === "asc"
          ? "desc"
          : "asc",
    }));
  };

  return (
    <div className={styles.shell} data-testid="archive-browser">
      <header className={styles.toolbar}>
        <button
          className={styles.brandButton}
          data-testid="archive-home"
          onClick={onHome}
          title={t("backHome")}
        >
          <ArchiveIcon />
          <span>{archive.summary.displayName}</span>
        </button>
        <div className={styles.toolbarDivider} />
        <button className={styles.toolbarButton} onClick={onOpen}>
          <FolderGlyph /> {t("openAnotherArchive")}
        </button>
        <button
          className={styles.toolbarButton}
          onClick={() => setExtractOpen(true)}
        >
          <DownloadIcon aria-hidden="true" /> {t("extract")}
        </button>
        <div className={styles.toolbarSpacer} />
        <form
          className={styles.searchBox}
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(queryInput.trim());
          }}
        >
          <input
            data-testid="archive-search"
            aria-label={t("searchArchive")}
            name="archive-search"
            autoComplete="off"
            spellCheck={false}
            placeholder={t("searchPlaceholder")}
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
          />
          <button
            type="submit"
            className={styles.searchSubmit}
            aria-label={t("submitSearch")}
            title={t("submitSearch")}
          >
            <MagnifyingGlassIcon aria-hidden="true" />
          </button>
          {queryInput && (
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t("clearSearch")}
              onClick={() => {
                setQueryInput("");
                setQuery("");
              }}
            >
              <Cross2Icon aria-hidden="true" />
            </button>
          )}
        </form>
      </header>
      {error && (
        <ErrorBanner
          error={error}
          onDismiss={onDismissError}
          onChooseAnother={onOpen}
        />
      )}
      <div className={styles.browserWorkspace}>
        <aside
          className={styles.treeSidebar}
          aria-label={t("archiveTree")}
          data-testid="archive-tree"
        >
          <div className={styles.sidebarTitle}>{t("folders")}</div>
          <button
            className={styles.treeRoot}
            onClick={() => navigate([rootLocation])}
          >
            <ArchiveIcon aria-hidden="true" />
            <span>{archive.summary.displayName}</span>
          </button>
          <TreeBranch
            parentKey="root"
            trail={[rootLocation]}
            pages={treePages}
            expanded={expanded}
            selectedId={current.id}
            onToggle={async (entry) => {
              setExpanded((currentExpanded) => {
                const next = new Set(currentExpanded);
                if (next.has(entry.id)) next.delete(entry.id);
                else next.add(entry.id);
                return next;
              });
              await loadTreeChildren(entry.id);
            }}
            onNavigate={navigate}
          />
          <div className={styles.archiveFacts}>
            <span>{formatItemCount(archive.summary.entryCount, locale)}</span>
            <span>{formatBytes(archive.summary.storedBytes, locale)}</span>
            <span>{archive.summary.solid ? "Solid" : "Normal"}</span>
          </div>
        </aside>

        <main className={styles.browserMain}>
          <div className={styles.pathBar}>
            <button
              className={styles.iconButton}
              aria-label={t("back")}
              disabled={historyIndex === 0}
              onClick={() => setHistoryIndex((index) => Math.max(0, index - 1))}
            >
              <ArrowLeftIcon aria-hidden="true" />
            </button>
            <button
              className={styles.iconButton}
              aria-label={t("forward")}
              disabled={historyIndex === history.length - 1}
              onClick={() =>
                setHistoryIndex((index) =>
                  Math.min(history.length - 1, index + 1),
                )
              }
            >
              <ArrowRightIcon aria-hidden="true" />
            </button>
            <nav className={styles.breadcrumbs} aria-label={t("currentFolder")}>
              <button onClick={() => navigate([rootLocation])}>
                {archive.summary.displayName}
              </button>
              {currentTrail.slice(1).map((location, index) => (
                <span key={location.id}>
                  <ChevronRightIcon aria-hidden="true" />
                  <button
                    onClick={() => navigate(currentTrail.slice(0, index + 2))}
                  >
                    {location.name}
                  </button>
                </span>
              ))}
            </nav>
            <button
              className={styles.iconButton}
              aria-label={t("reload")}
              title={t("reload")}
              onClick={() => setSort((currentSort) => ({ ...currentSort }))}
            >
              <ReloadIcon aria-hidden="true" />
            </button>
          </div>
          {query && (
            <div className={styles.searchSummary}>
              {t("searchResultsFor")} “{query}”
              <button
                onClick={() => {
                  setQuery("");
                  setQueryInput("");
                }}
              >
                {t("returnToFolder")}
              </button>
            </div>
          )}
          <div className={styles.listPanel}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <SortableHeader
                    label={t("name")}
                    field="name"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    label={t("type")}
                    field="kind"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    label={t("originalSize")}
                    field="originalBytes"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHeader
                    label={t("storedSize")}
                    field="storedBytes"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <th>{t("compression")}</th>
                  <th>{t("encryption")}</th>
                  <SortableHeader
                    label={t("modifiedAt")}
                    field="modifiedAt"
                    sort={sort}
                    onSort={toggleSort}
                  />
                </tr>
              </thead>
              <tbody>
                {items.map((entry) => (
                  <tr
                    key={entry.id}
                    data-entry-path={entry.path}
                    className={
                      selectedId === entry.id ? styles.selectedRow : undefined
                    }
                    tabIndex={0}
                    onClick={() => void selectEntry(entry)}
                    onDoubleClick={() => openEntry(entry)}
                    onKeyDown={(event) =>
                      handleEntryKey(event, () => openEntry(entry))
                    }
                  >
                    <td>
                      <span className={styles.fileIdentity}>
                        <span className={styles.fileName}>
                          {entry.kind === "directory" ? (
                            <FolderGlyph />
                          ) : (
                            <FileIcon />
                          )}
                          <span>{entry.name}</span>
                        </span>
                        {query && (
                          <small
                            className={styles.entryLocation}
                            title={entry.path}
                          >
                            {entry.path}
                          </small>
                        )}
                      </span>
                    </td>
                    <td>{kindLabel(entry.kind, t)}</td>
                    <td className={styles.numeric}>
                      {formatOptionalBytes(entry.originalBytes, locale)}
                    </td>
                    <td className={styles.numeric}>
                      {formatOptionalBytes(entry.storedBytes, locale)}
                    </td>
                    <td>{entry.compression ?? "—"}</td>
                    <td>{localizeEncryption(entry.encryption, t)}</td>
                    <td>{formatOptionalDate(entry.modifiedAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {listBusy && items.length === 0 && <TableSkeleton />}
            {!listBusy && items.length === 0 && (
              <div className={styles.emptyStateCompact}>
                <FolderGlyph />
                <strong>{query ? t("noMatches") : t("emptyFolder")}</strong>
                {query && <span>{t("changeSearch")}</span>}
              </div>
            )}
            {nextCursor && (
              <button
                className={styles.loadMoreButton}
                onClick={() => void loadMore()}
                disabled={listBusy}
              >
                {listBusy ? t("loading") : t("loadMore")}
              </button>
            )}
            <div className={styles.listStatus}>
              {formatItemCount(totalCount, locale)}
              {items.length < totalCount &&
                ` (${t("showing")} ${formatItemCount(items.length, locale)})`}
            </div>
          </div>
        </main>

        <Inspector
          summary={archive.summary}
          details={details}
          preview={preview}
        />
      </div>
      <ExtractDialog
        open={extractOpen}
        archive={archive}
        selectedPath={details?.entry.path}
        onOpenChange={setExtractOpen}
        onError={onError}
      />
    </div>
  );
}

function ExtractDialog({
  open,
  archive,
  selectedPath,
  onOpenChange,
  onError,
}: {
  open: boolean;
  archive: OpenArchiveResult;
  selectedPath?: string;
  onOpenChange: (open: boolean) => void;
  onError: (error: AppErrorDto) => void;
}) {
  const { t } = useI18n();
  const [destination, setDestination] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [conflict, setConflict] = useState<
    "ask" | "overwrite" | "skip" | "rename"
  >("rename");
  const [restorePermissions, setRestorePermissions] = useState(true);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const encrypted = archive.summary.encryptionMethods.some(
    (method) => method.toLowerCase() !== "none",
  );
  const extractFolderName = archive.summary.displayName.replace(/\.pna$/i, "");
  const conflictHelp = {
    rename: t("conflictRenameHelp"),
    overwrite: t("conflictOverwriteHelp"),
    skip: t("conflictSkipHelp"),
    ask: t("conflictStopHelp"),
  }[conflict];
  const readiness = !destination
    ? t("chooseDestinationToContinue")
    : encrypted && !password
      ? t("enterPasswordToContinue")
      : t("readyToExtract");

  useEffect(() => {
    if (open) setSelectedOnly(Boolean(selectedPath));
  }, [open, selectedPath]);

  const chooseDestination = async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: t("chooseDestination"),
    });
    if (typeof selected === "string") setDestination(selected);
  };

  const start = async () => {
    setSubmitting(true);
    try {
      await jobApi.startExtract({
        archivePath: archive.summary.path,
        destination,
        entries: selectedOnly && selectedPath ? [selectedPath] : [],
        password: password || null,
        conflict,
        restorePermissions,
        keepCompletedOnCancel: true,
      });
      onOpenChange(false);
      setDestination("");
    } catch (caught) {
      onError(normalizeAppError(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="520px">
        <Dialog.Title>{t("extractArchive")}</Dialog.Title>
        <Dialog.Description>{t("extractDescription")}</Dialog.Description>
        <div className={styles.extractForm}>
          <label>
            {t("destination")}
            <div className={styles.destinationRow}>
              <input
                readOnly
                name="extract-destination"
                value={destination}
                placeholder={t("destinationRequired")}
                aria-describedby="extract-destination-hint extract-readiness"
              />
              <Button type="button" variant="soft" onClick={chooseDestination}>
                {t("chooseDestination")}
              </Button>
            </div>
          </label>
          <p
            id="extract-destination-hint"
            className={styles.destinationPreview}
          >
            {t("extractFolderHint").replace("{name}", extractFolderName)}
          </p>
          <label>
            {t("conflictPolicy")}
            <select
              name="conflict-policy"
              value={conflict}
              onChange={(event) =>
                setConflict(event.target.value as typeof conflict)
              }
            >
              <option value="rename">{t("conflictRename")}</option>
              <option value="overwrite">{t("conflictOverwrite")}</option>
              <option value="skip">{t("conflictSkip")}</option>
              <option value="ask">{t("conflictAsk")}</option>
            </select>
          </label>
          <p className={styles.formHint}>{conflictHelp}</p>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={selectedOnly}
              disabled={!selectedPath}
              onChange={(event) => setSelectedOnly(event.target.checked)}
            />
            {t("extractSelectedOnly")}
          </label>
          {!selectedPath && (
            <p className={styles.formHint}>{t("selectItemToExtractOnly")}</p>
          )}
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={restorePermissions}
              onChange={(event) => setRestorePermissions(event.target.checked)}
            />
            {t("restorePermissions")}
          </label>
          {encrypted && (
            <label>
              {t("password")}
              <input
                type="password"
                name="archive-password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          )}
          <p id="extract-readiness" className={styles.extractReadiness}>
            {readiness}
          </p>
        </div>
        <Flex mt="5" gap="3" justify="end">
          <Button
            type="button"
            variant="soft"
            color="gray"
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            disabled={!destination || submitting || (encrypted && !password)}
            aria-busy={submitting}
            aria-describedby="extract-readiness"
            onClick={start}
          >
            {submitting
              ? t("startingExtraction")
              : selectedOnly && selectedPath
                ? t("startExtractingSelected")
                : t("startExtractingAll")}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function AppToolbar({
  title,
  onOpen,
  onCreate,
}: {
  title: string;
  onOpen: () => void;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  return (
    <header className={styles.toolbar}>
      <div className={styles.brand}>
        <ArchiveIcon aria-hidden="true" />
        <strong>{title}</strong>
      </div>
      <div className={styles.toolbarDivider} />
      <button className={styles.toolbarButton} onClick={onCreate}>
        <PlusIcon aria-hidden="true" /> {t("newArchive")}
      </button>
      <button className={styles.toolbarButton} onClick={onOpen}>
        <FolderGlyph /> {t("open")}
      </button>
      <div className={styles.toolbarSpacer} />
      <span className={styles.phaseLabel}>{t("archiveBrowser")}</span>
    </header>
  );
}

function ErrorBanner({
  error,
  onDismiss,
  onChooseAnother,
}: {
  error: AppErrorDto;
  onDismiss: () => void;
  onChooseAnother?: () => void;
}) {
  const { t } = useI18n();
  const localized = localizeError(error, t);
  useEffect(() => {
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", dismissOnEscape);
    return () => window.removeEventListener("keydown", dismissOnEscape);
  }, [onDismiss]);
  return (
    <div className={styles.errorBanner} role="alert">
      <div>
        <strong>{localized.message}</strong>
        {error.context && (
          <span className={styles.errorContext}>{error.context}</span>
        )}
        {localized.userAction && <span>{localized.userAction}</span>}
      </div>
      {error.context && onChooseAnother && (
        <Button
          type="button"
          size="1"
          variant="soft"
          color="gray"
          onClick={onChooseAnother}
        >
          {t("chooseAnotherArchive")}
        </Button>
      )}
      <button
        className={styles.iconButton}
        aria-label={t("dismissError")}
        onClick={onDismiss}
      >
        <Cross2Icon aria-hidden="true" />
      </button>
    </div>
  );
}

function TreeBranch({
  parentKey,
  trail,
  pages,
  expanded,
  selectedId,
  onToggle,
  onNavigate,
}: {
  parentKey: string;
  trail: FolderLocation[];
  pages: TreePages;
  expanded: Set<string>;
  selectedId?: string;
  onToggle: (entry: ArchiveEntry) => Promise<void>;
  onNavigate: (trail: FolderLocation[]) => void;
}) {
  const { t } = useI18n();
  const directories = (pages[parentKey] ?? []).filter(
    (entry) => entry.kind === "directory",
  );
  return (
    <div className={styles.treeBranch}>
      {directories.map((entry) => {
        const entryTrail = [
          ...trail,
          { id: entry.id, name: entry.name, path: entry.path },
        ];
        const isExpanded = expanded.has(entry.id);
        return (
          <div key={entry.id}>
            <ArchiveTreeRow
              active={selectedId === entry.id}
              expanded={isExpanded}
              name={entry.name}
              collapseLabel={t("collapse")}
              expandLabel={t("expand")}
              onToggle={() => void onToggle(entry)}
              onNavigate={() => onNavigate(entryTrail)}
            />
            {isExpanded && (
              <TreeBranch
                parentKey={entry.id}
                trail={entryTrail}
                pages={pages}
                expanded={expanded}
                selectedId={selectedId}
                onToggle={onToggle}
                onNavigate={onNavigate}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Inspector({
  summary,
  details,
  preview,
}: {
  summary: OpenArchiveResult["summary"];
  details?: EntryDetails;
  preview?: PreviewDescriptor;
}) {
  const { locale, t } = useI18n();
  return (
    <aside className={styles.inspector} aria-label={t("inspector")}>
      <h2>{details ? t("selectedItem") : t("archiveInformation")}</h2>
      {details ? (
        <div className={styles.entryInspector}>
          <div className={styles.entryTitle}>
            {details.entry.kind === "directory" ? (
              <FolderGlyph />
            ) : (
              <FileIcon aria-hidden="true" />
            )}
            <strong>{details.entry.name}</strong>
          </div>
          <span className={styles.pathText}>{details.entry.path}</span>
          <section>
            <h3>{t("preview")}</h3>
            {!preview && details.entry.kind === "file" && (
              <div className={styles.previewLoading}>
                <Spinner size="2" /> {t("loadingPreview")}
              </div>
            )}
            {preview?.kind === "text" && (
              <pre className={styles.textPreview} data-testid="archive-preview">
                {preview.text}
              </pre>
            )}
            {preview?.kind === "unsupported" && (
              <div className={styles.previewUnavailable}>
                <FileIcon aria-hidden="true" />
                <span>{previewMessage(preview.messageCode, t)}</span>
              </div>
            )}
            {details.entry.kind !== "file" && (
              <div className={styles.previewUnavailable}>
                <FolderGlyph />
                <span>{t("folderProperties")}</span>
              </div>
            )}
            {preview?.messageCode && preview.kind === "text" && (
              <p className={styles.previewNote}>
                {previewMessage(preview.messageCode, t)}
              </p>
            )}
          </section>
          <section>
            <h3>{t("properties")}</h3>
            <DefinitionList
              items={[
                [t("type"), kindLabel(details.entry.kind, t)],
                [
                  t("originalSize"),
                  formatOptionalBytes(details.entry.originalBytes, locale),
                ],
                [
                  t("storedSize"),
                  formatOptionalBytes(details.entry.storedBytes, locale),
                ],
                [t("compression"), details.entry.compression ?? "—"],
                [
                  t("encryption"),
                  localizeEncryption(details.entry.encryption, t),
                ],
                [
                  t("modifiedAt"),
                  formatOptionalDate(details.entry.modifiedAt, locale),
                ],
                [t("createdAt"), formatOptionalDate(details.createdAt, locale)],
                [t("permission"), details.permission ?? "—"],
                [t("owner"), details.owner ?? "—"],
                [t("group"), details.group ?? "—"],
                [
                  t("extendedAttributes"),
                  formatAttributeCount(details.xattrCount, locale),
                ],
              ]}
            />
          </section>
        </div>
      ) : (
        <div className={styles.summaryInspector}>
          <ArchiveIcon className={styles.largeArchiveIcon} aria-hidden="true" />
          <strong>{summary.displayName}</strong>
          <span className={styles.pathText}>{summary.path}</span>
          <DefinitionList
            items={[
              [t("items"), formatCount(summary.entryCount, locale)],
              [t("originalSize"), formatBytes(summary.originalBytes, locale)],
              [t("storedSize"), formatBytes(summary.storedBytes, locale)],
              [t("configuration"), summary.solid ? "Solid" : "Normal"],
              [t("compression"), summary.compressionMethods.join(" / ") || "—"],
              [
                t("encryption"),
                localizeEncryptionList(summary.encryptionMethods, t),
              ],
              [
                t("lastModified"),
                formatOptionalDate(summary.fileModifiedAt, locale),
              ],
            ]}
          />
          <p className={styles.inspectorHint}>{t("selectItemHint")}</p>
        </div>
      )}
    </aside>
  );
}

function DefinitionList({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className={styles.definitionList}>
      {items.map(([term, value]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SortableHeader({
  label,
  field,
  sort,
  onSort,
}: {
  label: string;
  field: SortSpec["field"];
  sort: SortSpec;
  onSort: (field: SortSpec["field"]) => void;
}) {
  return (
    <th
      aria-sort={
        sort.field === field
          ? sort.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <button className={styles.sortButton} onClick={() => onSort(field)}>
        {label}
        {sort.field === field && (
          <span>{sort.direction === "asc" ? "↑" : "↓"}</span>
        )}
      </button>
    </th>
  );
}

function TableSkeleton() {
  const { t } = useI18n();
  return (
    <div className={styles.tableSkeleton} aria-label={t("listingLoading")}>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

function handleEntryKey(
  event: KeyboardEvent<HTMLTableRowElement>,
  open: () => void,
) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    open();
  }
}
