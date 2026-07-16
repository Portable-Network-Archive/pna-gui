"use client";

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";

const ENGLISH = {
  root: "Root",
  openArchiveTitle: "Open PNA archive",
  backHome: "Back to Home",
  createArchive: "Create new archive",
  currentCreateFeature: "Current archive creation tools",
  createArchiveSubtitle: "Files & folders → PNA archive",
  dropArchive: "Drop a .pna archive to open it",
  loadingArchive: "Opening archive",
  preparingIndex: "Preparing the archive index.",
  passwordRequired: "Password required",
  encryptedArchive:
    "This archive is encrypted. The password will not be saved.",
  password: "Password",
  cancel: "Cancel",
  open: "Open",
  navigation: "Navigation",
  home: "Home",
  archives: "Archives",
  recent: "Recent",
  dropHint: "You can also drop a .pna archive onto this window.",
  recentArchives: "Recent archives",
  recentArchivesHint: "Choose an archive to browse its contents.",
  openArchive: "Open archive",
  openArchiveDescription:
    "Open an existing .pna archive and browse its contents",
  createArchiveDescription: "Create a .pna archive from files and folders",
  saveArchive: "Save archive",
  passwordNeeded: "Enter a password before creating an encrypted archive.",
  passwordMismatch: "The password confirmation does not match.",
  reproducibleEncryptionConflict:
    "Reproducible archives cannot be combined with encryption.",
  createWizard: "Create archive wizard",
  createSteps: "Creation steps",
  selectSources: "Select sources",
  settings: "Settings",
  confirmation: "Confirmation",
  chooseCreateSettings: "Choose how the archive should be created.",
  addFiles: "Add files",
  addFolder: "Add folder",
  noSources: "No files or folders selected.",
  next: "Next",
  confirmPassword: "Confirm password",
  preservePermissions: "Preserve permissions",
  reviewCreate: "Review archive creation",
  preset: "Preset",
  allowOverwrite: "Replace an existing archive at the selected path",
  estimatedNotGuaranteed:
    "Sizes and completion time are estimates, not guarantees.",
  startCreating: "Start creating",
  jobQueued: "Background job queued",
  creationStarted: "Creation Started",
  creationStartedHint:
    "{path} was added to the Job Center. You can start another archive now.",
  dismissCreationNotice: "Dismiss creation notice",
  startingCreation: "Starting…",
  queued: "Queued",
  preset_standard: "Standard",
  preset_backup: "Backup",
  preset_distribution: "Distribution",
  preset_maximum: "Maximum compression",
  preset_fast: "Fast",
  preset_reproducible: "Reproducible",
  preset_custom: "Custom",
  preset_standard_description:
    "Balanced compression and individual-file access.",
  preset_backup_description:
    "Preserves permissions with dependable compression.",
  preset_distribution_description:
    "Straightforward sharing without source permissions.",
  preset_maximum_description:
    "Smallest practical size; takes longer to process.",
  preset_fast_description: "Fastest processing with a larger archive.",
  preset_reproducible_description:
    "Repeatable output for unchanged source files.",
  extract: "Extract",
  extractArchive: "Extract archive",
  extractDescription:
    "Choose a destination and how existing files should be handled.",
  destination: "Destination",
  destinationRequired: "Choose a destination folder",
  chooseDestination: "Choose destination",
  conflictPolicy: "Existing files",
  conflictAsk: "Stop on conflicts",
  conflictOverwrite: "Replace",
  conflictSkip: "Skip",
  conflictRename: "Keep both — recommended",
  conflictRenameHelp:
    "Existing files stay unchanged; new files receive a numbered name.",
  conflictOverwriteHelp:
    "Existing files are replaced only after each new file is complete.",
  conflictSkipHelp:
    "Existing files stay unchanged and are omitted from this extraction.",
  conflictStopHelp:
    "Nothing is replaced; extraction stops and reports the first conflict.",
  extractFolderHint:
    "A folder named {name} will be created inside the selected destination.",
  selectItemToExtractOnly:
    "Select a file or folder in the archive browser to enable this option.",
  chooseDestinationToContinue: "Choose a destination folder to continue.",
  enterPasswordToContinue: "Enter the archive password to continue.",
  readyToExtract: "Ready to extract.",
  startingExtraction: "Starting…",
  extractSelectedOnly: "Extract only the selected item",
  restorePermissions: "Restore permissions when supported",
  startExtracting: "Start extracting",
  startExtractingSelected: "Extract Selected Item",
  startExtractingAll: "Extract All Items",
  backgroundJobs: "Background jobs",
  jobCenter: "Job center",
  activeJobs: "active",
  finishedJobs: "finished",
  noActiveJobs: "No active jobs",
  jobCenterDescription:
    "Review progress, results, and actions for this session.",
  jobCount: "{count} jobs",
  clearFinishedJobs: "Clear Finished",
  createJob: "Archive creation",
  extractJob: "Archive extraction",
  cancelJob: "Cancel job",
  retryJob: "Retry job",
  dismissCompletedJob: "Dismiss completed job",
  showInFolder: "Show in Folder",
  openCreatedArchive: "Open Created Archive",
  jobStatusQueued: "Waiting",
  jobStatusRunning: "In Progress",
  jobStatusCancelling: "Cancelling…",
  jobCancelWaiting:
    "Finishing the current safe step before stopping. You can continue using the app.",
  jobStatusCancelled: "Cancelled",
  jobStatusSucceeded: "Completed",
  jobStatusFailed: "Failed",
  jobStatusInterrupted: "Interrupted",
  jobActionFailed: "Could Not Complete the Job Action",
  jobSyncFailed: "Could Not Synchronize Background Jobs",
  retry: "Retry",
  close: "Close",
  of: "of",
  dropFiles: "Drop files here",
  browseFiles: "or click to browse",
  addMoreFiles: "Drop more files or click to add",
  removeFile: "Remove file",
  archiveOptions: "Archive options",
  solidMode: "Solid mode",
  done: "Done",
  noRecentArchives: "No recent archives",
  noRecentArchivesHint: "Archives you open will appear here for quick access.",
  name: "Name",
  items: "Items",
  size: "Size",
  lastUsed: "Last used",
  actions: "Actions",
  removeFromRecent: "Remove from Recents",
  selectedArchive: "Selected archive",
  showContents: "Show contents",
  selectArchiveHint: "Select an archive in the list to see its information.",
  openAnotherArchive: "Open another archive",
  searchArchive: "Search archive",
  searchPlaceholder: "Search by file name or path…",
  clearSearch: "Clear search",
  archiveTree: "Archive tree",
  folders: "Folders",
  back: "Back",
  forward: "Forward",
  currentFolder: "Current folder",
  reload: "Reload",
  searchResultsFor: "Search results for",
  returnToFolder: "Return to current folder",
  type: "Type",
  originalSize: "Original size",
  storedSize: "Stored size",
  compression: "Compression",
  encryption: "Encryption",
  modifiedAt: "Modified",
  noMatches: "No matching items",
  emptyFolder: "This folder is empty",
  changeSearch: "Try a different search term.",
  loading: "Loading…",
  loadMore: "Load more",
  showing: "showing",
  newArchive: "New archive",
  archiveBrowser: "Archive browser",
  submitSearch: "Search",
  chooseAnotherArchive: "Choose another archive",
  dismissError: "Dismiss error",
  collapse: "Collapse",
  expand: "Expand",
  inspector: "Inspector",
  selectedItem: "Selected item",
  archiveInformation: "Archive information",
  preview: "Preview",
  loadingPreview: "Loading",
  folderProperties: "Showing folder properties.",
  properties: "Properties",
  createdAt: "Created",
  permission: "Permissions",
  owner: "Owner",
  group: "Group",
  extendedAttributes: "Extended attributes",
  configuration: "Configuration",
  lastModified: "Last modified",
  none: "None",
  selectItemHint: "Select an item in the list to see details and a preview.",
  listingLoading: "Loading items",
  file: "File",
  directory: "Folder",
  symlink: "Symbolic link",
  hardlink: "Hard link",
  previewSelectFile: "Select a file to preview it.",
  previewUnsupported: "This file type is not available for safe text preview.",
  previewBinary: "Binary data cannot be previewed.",
  previewTruncated: "Showing only the beginning of the file.",
  errorInternal: "The operation could not be completed.",
  errorInvalidArgument: "The selected item is not valid.",
  errorPasswordRequired: "A password is required to open this archive.",
  errorWrongPassword:
    "The password is incorrect or the encrypted data could not be read.",
  errorPathNotFound: "The selected archive or item could not be found.",
  errorPermissionDenied: "You do not have permission to read this archive.",
  errorIo: "The archive could not be read.",
  errorArchiveCorrupt:
    "This is not a readable PNA archive, or its data is damaged.",
  actionEnterPassword: "Enter the archive password and try again.",
  actionCheckLocation: "Check the location or choose the archive again.",
  actionCheckPassword: "Check the password and try again.",
} as const;

export type TranslationKey = keyof typeof ENGLISH;

const JAPANESE: Record<TranslationKey, string> = {
  root: "ルート",
  openArchiveTitle: "PNAアーカイブを開く",
  backHome: "ホームへ戻る",
  createArchive: "新しいアーカイブを作成",
  currentCreateFeature: "現在の作成機能",
  createArchiveSubtitle: "ファイル・フォルダー → PNAアーカイブ",
  dropArchive: ".pnaをドロップして開く",
  loadingArchive: "アーカイブを読み込んでいます",
  preparingIndex: "項目の索引を準備しています。",
  passwordRequired: "パスワードが必要です",
  encryptedArchive: "暗号化されたアーカイブです。パスワードは保存されません。",
  password: "パスワード",
  cancel: "キャンセル",
  open: "開く",
  navigation: "ナビゲーション",
  home: "ホーム",
  archives: "アーカイブ",
  recent: "最近使用",
  dropHint: ".pnaをウィンドウへドロップして開くこともできます。",
  recentArchives: "最近のアーカイブ",
  recentArchivesHint: "内容を確認するアーカイブを選択してください。",
  openArchive: "アーカイブを開く",
  openArchiveDescription: "既存の.pnaを開いて内容を確認します",
  createArchiveDescription: "ファイルやフォルダーから.pnaを作成します",
  saveArchive: "アーカイブを保存",
  passwordNeeded:
    "暗号化されたアーカイブを作成するにはパスワードを入力してください。",
  passwordMismatch: "確認用パスワードが一致しません。",
  reproducibleEncryptionConflict:
    "再現可能アーカイブと暗号化は同時に使用できません。",
  createWizard: "アーカイブ作成ウィザード",
  createSteps: "作成手順",
  selectSources: "対象選択",
  settings: "設定",
  confirmation: "確認",
  chooseCreateSettings: "アーカイブの作成方法を選択します。",
  addFiles: "ファイルを追加",
  addFolder: "フォルダーを追加",
  noSources: "ファイルまたはフォルダーが選択されていません。",
  next: "次へ",
  confirmPassword: "パスワードの確認",
  preservePermissions: "権限を保持",
  reviewCreate: "作成内容の確認",
  preset: "プリセット",
  allowOverwrite: "選択先に既存アーカイブがある場合は置き換える",
  estimatedNotGuaranteed:
    "サイズと所要時間は推定値であり、保証値ではありません。",
  startCreating: "作成開始",
  jobQueued: "バックグラウンドジョブを追加しました",
  creationStarted: "作成を開始しました",
  creationStartedHint:
    "{path} の作成をジョブセンターに追加しました。続けて別のアーカイブを作成できます。",
  dismissCreationNotice: "作成開始のお知らせを閉じる",
  startingCreation: "開始中…",
  queued: "待機中",
  preset_standard: "標準",
  preset_backup: "バックアップ",
  preset_distribution: "配布",
  preset_maximum: "高圧縮",
  preset_fast: "高速",
  preset_reproducible: "再現可能",
  preset_custom: "カスタム",
  preset_standard_description: "圧縮率と個別ファイルへのアクセスを両立します。",
  preset_backup_description: "権限を保持し、安定した圧縮で保存します。",
  preset_distribution_description: "元の権限を含めず、共有しやすくします。",
  preset_maximum_description:
    "サイズを最小化しますが、処理に時間がかかります。",
  preset_fast_description: "サイズより処理速度を優先します。",
  preset_reproducible_description: "同じ入力から再現可能な出力を作成します。",
  extract: "展開",
  extractArchive: "アーカイブを展開",
  extractDescription: "展開先と既存ファイルの扱いを選択します。",
  destination: "展開先",
  destinationRequired: "展開先フォルダーを選択",
  chooseDestination: "展開先を選択",
  conflictPolicy: "既存ファイル",
  conflictAsk: "競合時に停止",
  conflictOverwrite: "置き換える",
  conflictSkip: "スキップ",
  conflictRename: "両方を保持（推奨）",
  conflictRenameHelp:
    "既存ファイルを変更せず、新しいファイルを番号付きの名前で保存します。",
  conflictOverwriteHelp:
    "新しいファイルが完成してから既存ファイルを置き換えます。",
  conflictSkipHelp: "既存ファイルを変更せず、その項目の展開を省略します。",
  conflictStopHelp: "何も置き換えず、最初の競合を報告して展開を停止します。",
  extractFolderHint: "選択した展開先の中に「{name}」フォルダーを作成します。",
  selectItemToExtractOnly:
    "この項目を有効にするには、アーカイブブラウザーでファイルまたはフォルダーを選択してください。",
  chooseDestinationToContinue:
    "続行するには展開先フォルダーを選択してください。",
  enterPasswordToContinue:
    "続行するにはアーカイブのパスワードを入力してください。",
  readyToExtract: "展開を開始できます。",
  startingExtraction: "開始中…",
  extractSelectedOnly: "選択項目のみ展開",
  restorePermissions: "対応環境では権限を復元",
  startExtracting: "展開開始",
  startExtractingSelected: "選択項目を展開",
  startExtractingAll: "すべての項目を展開",
  backgroundJobs: "バックグラウンドジョブ",
  jobCenter: "ジョブセンター",
  activeJobs: "件を処理中",
  finishedJobs: "件完了",
  noActiveJobs: "実行中の処理はありません",
  jobCenterDescription: "このセッションの進捗、結果、操作を確認します。",
  jobCount: "{count}件のジョブ",
  clearFinishedJobs: "完了済みを消去",
  createJob: "アーカイブ作成",
  extractJob: "アーカイブ展開",
  cancelJob: "ジョブをキャンセル",
  retryJob: "ジョブを再試行",
  dismissCompletedJob: "完了したジョブを閉じる",
  showInFolder: "保存先を表示",
  openCreatedArchive: "作成したアーカイブを開く",
  jobStatusQueued: "待機中",
  jobStatusRunning: "処理中",
  jobStatusCancelling: "キャンセル中…",
  jobCancelWaiting:
    "安全な処理区切りまで待ってから停止します。この間も別の操作を続けられます。",
  jobStatusCancelled: "キャンセル済み",
  jobStatusSucceeded: "完了",
  jobStatusFailed: "失敗",
  jobStatusInterrupted: "中断",
  jobActionFailed: "ジョブの操作を完了できませんでした",
  jobSyncFailed: "バックグラウンドジョブを同期できませんでした",
  retry: "再試行",
  close: "閉じる",
  of: "/",
  dropFiles: "ファイルをここにドロップ",
  browseFiles: "またはクリックして選択",
  addMoreFiles: "追加のファイルをドロップ、またはクリックして追加",
  removeFile: "ファイルを削除",
  archiveOptions: "アーカイブ設定",
  solidMode: "Solidモード",
  done: "完了",
  noRecentArchives: "最近使用したアーカイブはありません",
  noRecentArchivesHint:
    "最初のアーカイブを開くと、ここからすぐ戻れるようになります。",
  name: "名前",
  items: "項目数",
  size: "サイズ",
  lastUsed: "最終使用",
  actions: "操作",
  removeFromRecent: "最近一覧から削除",
  selectedArchive: "選択中のアーカイブ",
  showContents: "内容を表示",
  selectArchiveHint: "一覧からアーカイブを選択すると、情報を表示します。",
  openAnotherArchive: "別のアーカイブを開く",
  searchArchive: "アーカイブ内を検索",
  searchPlaceholder: "ファイル名やパスを検索…",
  clearSearch: "検索をクリア",
  archiveTree: "アーカイブツリー",
  folders: "フォルダー",
  back: "戻る",
  forward: "進む",
  currentFolder: "現在のフォルダー",
  reload: "再読み込み",
  searchResultsFor: "検索結果",
  returnToFolder: "現在のフォルダーへ戻る",
  type: "種類",
  originalSize: "元サイズ",
  storedSize: "格納サイズ",
  compression: "圧縮方式",
  encryption: "暗号化",
  modifiedAt: "更新日時",
  noMatches: "一致する項目はありません",
  emptyFolder: "このフォルダーは空です",
  changeSearch: "検索語を変えてもう一度お試しください。",
  loading: "読み込み中…",
  loadMore: "さらに読み込む",
  showing: "表示中",
  newArchive: "新規作成",
  archiveBrowser: "アーカイブブラウザ",
  submitSearch: "検索",
  chooseAnotherArchive: "別のアーカイブを選ぶ",
  dismissError: "エラーを閉じる",
  collapse: "折りたたむ",
  expand: "展開する",
  inspector: "インスペクタ",
  selectedItem: "選択中の項目",
  archiveInformation: "アーカイブ情報",
  preview: "プレビュー",
  loadingPreview: "読み込み中",
  folderProperties: "フォルダーのプロパティを表示しています。",
  properties: "プロパティ",
  createdAt: "作成日時",
  permission: "権限",
  owner: "所有者",
  group: "グループ",
  extendedAttributes: "拡張属性",
  configuration: "構成",
  lastModified: "最終更新",
  none: "なし",
  selectItemHint: "一覧の項目を選択すると詳細とプレビューを表示します。",
  listingLoading: "一覧を読み込み中",
  file: "ファイル",
  directory: "フォルダー",
  symlink: "シンボリックリンク",
  hardlink: "ハードリンク",
  previewSelectFile: "ファイルを選択するとプレビューできます。",
  previewUnsupported:
    "このファイル形式は安全なテキストプレビューの対象外です。",
  previewBinary: "バイナリデータのためプレビューできません。",
  previewTruncated: "先頭部分のみ表示しています。",
  errorInternal: "内部処理を完了できませんでした。",
  errorInvalidArgument: "選択した項目は有効ではありません。",
  errorPasswordRequired: "このアーカイブを開くにはパスワードが必要です。",
  errorWrongPassword:
    "パスワードが正しくないか、暗号化データを読み取れませんでした。",
  errorPathNotFound: "選択したアーカイブまたは項目が見つかりません。",
  errorPermissionDenied: "アーカイブを読み取る権限がありません。",
  errorIo: "アーカイブを読み取れませんでした。",
  errorArchiveCorrupt:
    "PNAアーカイブとして読み取れないか、データが破損しています。",
  actionEnterPassword: "パスワードを入力して、もう一度お試しください。",
  actionCheckLocation: "場所を確認するか、一覧から選び直してください。",
  actionCheckPassword: "パスワードを確認して、もう一度入力してください。",
};

export type SupportedLocale = "en" | "ja";

interface I18nValue {
  locale: SupportedLocale;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nValue>({
  locale: "en",
  t: (key) => ENGLISH[key],
});

export function resolveLocale(languages: readonly string[]): SupportedLocale {
  return languages[0]?.toLowerCase().split("-")[0] === "ja" ? "ja" : "en";
}

export function translate(
  locale: SupportedLocale,
  key: TranslationKey,
): string {
  return (locale === "ja" ? JAPANESE : ENGLISH)[key];
}

function subscribeToLanguageChange(onStoreChange: () => void): () => void {
  window.addEventListener("languagechange", onStoreChange);
  return () => window.removeEventListener("languagechange", onStoreChange);
}

function getBrowserLocale(): SupportedLocale {
  return resolveLocale(
    navigator.languages.length ? navigator.languages : [navigator.language],
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore<SupportedLocale>(
    subscribeToLanguageChange,
    getBrowserLocale,
    (): SupportedLocale => "en",
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <I18nContext.Provider
      value={{ locale, t: (key) => translate(locale, key) }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

export function formatItemCount(
  value: number,
  locale: SupportedLocale,
): string {
  const count = new Intl.NumberFormat(locale).format(value);
  if (locale === "ja") return `${count} 項目`;
  return `${count} ${value === 1 ? "item" : "items"}`;
}

export function formatAttributeCount(
  value: number,
  locale: SupportedLocale,
): string {
  const count = new Intl.NumberFormat(locale).format(value);
  if (locale === "ja") return `${count}件`;
  return `${count} ${value === 1 ? "attribute" : "attributes"}`;
}
