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
  addFilesToArchive: "Add files",
  addToArchive: "Add to archive",
  addToArchiveDescription:
    "Choose files or folders to add. The original archive is replaced only after the updated archive is complete.",
  chooseFiles: "Choose files",
  chooseFolder: "Choose folder",
  selectedSources: "Selected sources",
  noSourcesSelected: "No files or folders selected yet.",
  startAdding: "Add to Archive",
  startingAddition: "Starting…",
  rename: "Rename",
  renameItem: "Rename Item",
  renameArchiveEntry: "Rename archive item",
  newName: "New name",
  invalidArchiveName: "Enter a single file or folder name without a slash.",
  renameNameRequired: "Enter a name.",
  renameNameContainsSeparator: "A name cannot contain / or \\.",
  delete: "Delete",
  deleteFromArchive: "Delete from Archive",
  deleteFromArchiveQuestion: "Delete from archive?",
  deleteFromArchiveDescription:
    "This removes the selected item and everything below it from the archive. Local source files are not deleted.",
  archiveTools: "Archive tools",
  archiveToolsDescription:
    "Create transport parts or write a normalized copy. Source archives are never changed by these tools.",
  operation: "Operation",
  splitArchive: "Split into parts",
  concatArchive: "Combine parts",
  sortArchive: "Sort items by name",
  stripMetadata: "Remove metadata",
  migrateMetadata: "Migrate legacy metadata",
  splitSummary:
    "Creates <archive>.part1.pna and numbered siblings in the selected folder. The source archive is unchanged.",
  concatSummary:
    "Choose any one part. Numbered siblings are discovered and validated before a separate archive is written.",
  sortSummary:
    "Writes a separate copy with entries reordered by name. File data, encryption, and supported metadata are preserved.",
  stripSummary:
    "Writes a separate copy using only the preservation options selected below. File data and integrity digests are retained.",
  migrateSummary:
    "Writes a separate copy with metadata represented by the current PNA library. File data and the source archive are unchanged.",
  chooseParts: "Choose any part",
  chooseOutput: "Choose output file",
  chooseSplitDestination: "Choose output folder",
  maximumPartSizeMb: "Maximum part size (MB)",
  invalidPartSize: "Enter a part size of at least 0.001 MB.",
  outputNotSelected: "No output selected.",
  partsNotSelected: "No archive part selected.",
  keepTimestamps: "Keep timestamps",
  keepPermissions: "Keep ownership and permissions",
  keepExtendedAttributes: "Keep extended attributes",
  keepPrivateChunks: "Keep private chunks",
  descending: "Descending order",
  start: "Start",
  startingOperation: "Starting…",
  more: "More",
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
    "Review progress, saved results, and available actions.",
  jobCount: "{count} jobs",
  clearFinishedJobs: "Clear {count} Finished Jobs",
  createJob: "Archive creation",
  extractJob: "Archive extraction",
  appendJob: "Adding archive items",
  deleteJob: "Removing archive items",
  renameJob: "Renaming archive item",
  splitJob: "Splitting archive",
  concatJob: "Combining archive parts",
  sortJob: "Sorting archive items",
  stripJob: "Removing archive metadata",
  migrateJob: "Migrating archive metadata",
  verificationJob: "Archive verification",
  verifyArchive: "Verify",
  verifyArchiveTitle: "Verify archive",
  verifyArchiveDescription:
    "Choose how much of the archive to check. Verification does not change the archive or write extracted files.",
  quickVerification: "Structure verification",
  quickVerificationDescription:
    "Checks the PNA structure and chunk CRCs without reading file contents.",
  completeVerification: "Content verification",
  completeVerificationDescription:
    "Reads every verifiable file through decryption and decompression without writing files; content that cannot be verified is reported as not checked. File attributes and restore destinations are not tested.",
  verificationPasswordHint:
    "The password is used only for this verification and is not included in the result.",
  startVerification: "Start verification",
  startingVerification: "Starting…",
  viewVerificationResults: "View results",
  verificationResults: "Verification results",
  saveVerificationReport: "Save report",
  saveVerificationReportTitle: "Choose a folder for the verification report",
  reportJson: "JSON — Automation",
  reportHtml: "HTML — Read and share",
  verificationReportSaved: "Report saved to {path}",
  verificationReportExportConflict:
    "The report folder changed while saving. Try again or choose another folder.",
  verificationReportExportPermission:
    "The report could not be saved at this location because permission was denied.",
  verificationReportExportStorage:
    "The report could not be saved because the destination does not have enough free space.",
  verificationReportExportInvalid:
    "Choose a destination folder that still exists, with a file name matching the selected report format.",
  verificationReportExportInvalidReport:
    "This verification result does not have a valid archive identity. Run verification again before exporting.",
  verificationReportExportReportMissing:
    "The exported report file could not be found. It may have been moved or deleted.",
  verificationReportExportJobUnavailable:
    "This verification result is no longer available. Run verification again to export a report.",
  verificationReportExportFailed: "The report could not be saved.",
  verificationPassed: "Checks completed",
  quickVerificationCompleted: "Structure verified; file contents not checked",
  verificationIssuesFound: "Some checks failed",
  verificationIncomplete: "Some content could not be checked",
  entriesChecked: "Entries checked",
  filesChecked: "Files read",
  bytesChecked: "Decoded bytes read",
  failedChecks: "Failed checks",
  notCheckedChecks: "Not checked",
  verificationCompletedAt: "Completed",
  verificationSourceVersion: "Verified source",
  verificationResultStale:
    "This archive has changed since this result was recorded.",
  verificationFreshnessUnknown:
    "Could not confirm whether the archive has changed since this result was recorded.",
  verificationReportNotPersisted:
    "The verification completed, but this result will not be available after the app restarts. Save a report before closing the app.",
  additionalChecksNotShown: "{count} additional checks are not shown.",
  checkPassed: "Checked",
  checkFailed: "Failed",
  checkNotChecked: "Not checked",
  checkArchiveHeader: "Archive header",
  checkChunkIntegrity: "Chunk integrity",
  checkEntryStructure: "Entry structure",
  checkFileContents: "File contents",
  checkDirectoryEntry: "Directory entry",
  checkSolidContents: "Solid group contents",
  checkLinkEntry: "Archive link",
  checkUnsupportedEntry: "Unsupported entry",
  checkEntryPath: "Entry path",
  verificationTechnicalDetail: "Technical details",
  cancelJob: "Cancel job",
  retryJob: "Retry job",
  dismissCompletedJob: "Dismiss completed job",
  dismissVerificationResult: "Delete saved verification result",
  dismissVerificationResultTitle: "Delete verification result?",
  deleteVerificationResult: "Delete result",
  dismissVerificationReportWarning:
    "Delete this verification result? It will no longer be available to view or export.",
  dismissJobResultTitle: "Remove job history?",
  dismissJobResultWarning:
    "This removes saved results, error details, and retry entries from the Job Center. It does not delete output files.",
  removeJobResult: "Remove result",
  showInFolder: "Open containing folder",
  openCreatedArchive: "Open Created Archive",
  openJobOutput: "Open Output Archive",
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
  jobRestarted:
    "The app closed before this job finished. Start the operation again from its original screen if it is still needed.",
  jobOperationFailed: "The operation could not be completed.",
  jobOperationFailedAction:
    "Review the operation settings and destination, then try again.",
  jobPermissionDenied:
    "The operation does not have permission to access one of its files or folders.",
  jobNotFound: "A required file or folder could not be found.",
  jobInvalidInput: "The operation settings are not valid.",
  jobInvalidData: "The archive data could not be processed.",
  jobWorkerFailed: "The background operation stopped unexpectedly.",
  jobArchiveEntryAlreadyExists:
    "An item with the same archive path already exists.",
  jobPreviousArchiveNotRemoved:
    "The new archive was saved, but the previous archive backup could not be removed.",
  jobPreviousArchiveNotRemovedAction:
    "Review and remove the retained backup after confirming the new archive.",
  jobStateNotPersisted:
    "This job is running, but its status may not be available after the app restarts.",
  retry: "Retry",
  jobOutputAlreadyExists: "The output file already exists.",
  jobOutputAlreadyExistsAction:
    "Move or rename the existing file, or choose another output, then retry.",
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
  errorEncryptedDataUnverifiable:
    "This archive does not contain the integrity information needed to verify encrypted uncompressed data safely.",
  errorPathNotFound: "The selected archive or item could not be found.",
  errorPermissionDenied: "You do not have permission to read this archive.",
  errorIo: "The archive could not be read.",
  errorArchiveCorrupt:
    "This is not a readable PNA archive, or its data is damaged.",
  actionEnterPassword: "Enter the archive password and try again.",
  actionCheckLocation: "Check the location or choose the archive again.",
  actionCheckPassword: "Check the password and try again.",
  actionRecreateWithIntegrity:
    "Recreate the archive with integrity metadata before opening its contents.",
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
  addFilesToArchive: "ファイルを追加",
  addToArchive: "アーカイブへ追加",
  addToArchiveDescription:
    "追加するファイルまたはフォルダーを選択します。更新版が完成するまで元のアーカイブは置き換えません。",
  chooseFiles: "ファイルを選択",
  chooseFolder: "フォルダーを選択",
  selectedSources: "選択した対象",
  noSourcesSelected: "ファイルまたはフォルダーが選択されていません。",
  startAdding: "アーカイブへ追加",
  startingAddition: "開始中…",
  rename: "名前を変更",
  renameItem: "項目の名前を変更",
  renameArchiveEntry: "アーカイブ内項目の名前を変更",
  newName: "新しい名前",
  invalidArchiveName:
    "スラッシュを含まないファイル名またはフォルダー名を入力してください。",
  renameNameRequired: "名前を入力してください。",
  renameNameContainsSeparator: "名前に / または \\ は使用できません。",
  delete: "削除",
  deleteFromArchive: "アーカイブから削除",
  deleteFromArchiveQuestion: "アーカイブから削除しますか？",
  deleteFromArchiveDescription:
    "選択項目とその配下をアーカイブから削除します。ローカルの元ファイルは削除しません。",
  archiveTools: "アーカイブツール",
  archiveToolsDescription:
    "運搬用の分割ファイルまたは正規化した別名コピーを作成します。これらのツールは元アーカイブを変更しません。",
  operation: "操作",
  splitArchive: "分割する",
  concatArchive: "分割ファイルを結合",
  sortArchive: "名前順に並べ替え",
  stripMetadata: "メタデータを削除",
  migrateMetadata: "旧メタデータを移行",
  splitSummary:
    "選択したフォルダーへ <archive>.part1.pna と連番ファイルを作成します。元アーカイブは変更しません。",
  concatSummary:
    "いずれか1つの分割ファイルを選択します。同じ連番のファイルを自動検出・検証してから別名アーカイブを作成します。",
  sortSummary:
    "項目を名前順に並べ替えた別名コピーを作成します。ファイル内容、暗号化、対応メタデータは保持します。",
  stripSummary:
    "下で選択した項目だけを保持する別名コピーを作成します。ファイル内容と整合性ダイジェストは保持します。",
  migrateSummary:
    "現在のPNAライブラリ表現でメタデータを書き直した別名コピーを作成します。ファイル内容と元アーカイブは変更しません。",
  chooseParts: "いずれかの分割ファイルを選択",
  chooseOutput: "出力ファイルを選択",
  chooseSplitDestination: "保存先フォルダーを選択",
  maximumPartSizeMb: "最大分割サイズ（MB）",
  invalidPartSize: "0.001 MB以上の分割サイズを入力してください。",
  outputNotSelected: "出力先が選択されていません。",
  partsNotSelected: "分割ファイルが選択されていません。",
  keepTimestamps: "タイムスタンプを保持",
  keepPermissions: "所有者と権限を保持",
  keepExtendedAttributes: "拡張属性を保持",
  keepPrivateChunks: "プライベートチャンクを保持",
  descending: "降順",
  start: "開始",
  startingOperation: "開始中…",
  more: "その他",
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
  jobCenterDescription: "進捗、保存された結果、利用できる操作を確認します。",
  jobCount: "{count}件のジョブ",
  clearFinishedJobs: "終了したジョブ{count}件を消去",
  createJob: "アーカイブ作成",
  extractJob: "アーカイブ展開",
  appendJob: "アーカイブへ追加",
  deleteJob: "アーカイブから削除",
  renameJob: "アーカイブ内の名前変更",
  splitJob: "アーカイブ分割",
  concatJob: "分割アーカイブの結合",
  sortJob: "アーカイブ項目の並べ替え",
  stripJob: "アーカイブメタデータの削除",
  migrateJob: "アーカイブメタデータの移行",
  verificationJob: "アーカイブ検証",
  verifyArchive: "検証",
  verifyArchiveTitle: "アーカイブを検証",
  verifyArchiveDescription:
    "確認する範囲を選択します。検証はアーカイブを変更せず、展開ファイルも書き出しません。",
  quickVerification: "構造のみ検証",
  quickVerificationDescription:
    "PNA構造とチャンクCRCを確認します。ファイル内容は読みません。",
  completeVerification: "内容まで検証",
  completeVerificationDescription:
    "復号・展開処理を通して検証可能なすべてのファイルを読みますが、書き出しません。検証できない内容は未確認として報告します。属性や展開先での復元までは確認しません。",
  verificationPasswordHint:
    "パスワードは今回の検証だけに使用し、結果には含めません。",
  startVerification: "検証を開始",
  startingVerification: "開始中…",
  viewVerificationResults: "結果を表示",
  verificationResults: "検証結果",
  saveVerificationReport: "レポートを保存",
  saveVerificationReportTitle: "検証レポートの保存先フォルダーを選択",
  reportJson: "JSON — 自動処理用",
  reportHtml: "HTML — 閲覧・共有用",
  verificationReportSaved: "レポートを保存しました: {path}",
  verificationReportExportConflict:
    "保存中にフォルダーの状態が変わりました。再試行するか別のフォルダーを選んでください。",
  verificationReportExportPermission:
    "この場所への保存権限がないため、レポートを保存できませんでした。",
  verificationReportExportStorage:
    "保存先の空き容量が足りないため、レポートを保存できませんでした。",
  verificationReportExportInvalid:
    "選択したレポート形式に合うファイル名で、実在する保存先フォルダーを選んでください。",
  verificationReportExportInvalidReport:
    "この検証結果には有効なアーカイブ識別情報がありません。再度検証してから保存してください。",
  verificationReportExportReportMissing:
    "書き出したレポートファイルが見つかりません。移動または削除された可能性があります。",
  verificationReportExportJobUnavailable:
    "この検証結果はもう利用できません。レポートを書き出すには再度検証を実行してください。",
  verificationReportExportFailed: "レポートを保存できませんでした。",
  verificationPassed: "確認が完了しました",
  quickVerificationCompleted: "構造を確認しました（ファイル内容は未確認）",
  verificationIssuesFound: "失敗した確認項目があります",
  verificationIncomplete: "確認できなかった内容があります",
  entriesChecked: "確認したエントリ",
  filesChecked: "読み取ったファイル",
  bytesChecked: "読み取った展開後バイト数",
  failedChecks: "失敗した確認",
  notCheckedChecks: "未確認",
  verificationCompletedAt: "完了日時",
  verificationSourceVersion: "検証した対象",
  verificationResultStale: "この結果の記録後にアーカイブが変更されています。",
  verificationFreshnessUnknown:
    "この結果の記録後にアーカイブが変更されていないか確認できませんでした。",
  verificationReportNotPersisted:
    "検証は完了しましたが、この結果はアプリの再起動後に表示できません。アプリを閉じる前にレポートを保存してください。",
  additionalChecksNotShown: "ほか{count}件の確認結果は省略されています。",
  checkPassed: "確認済み",
  checkFailed: "失敗",
  checkNotChecked: "未確認",
  checkArchiveHeader: "アーカイブヘッダー",
  checkChunkIntegrity: "チャンク整合性",
  checkEntryStructure: "エントリ構造",
  checkFileContents: "ファイル内容",
  checkDirectoryEntry: "ディレクトリエントリ",
  checkSolidContents: "Solidグループの内容",
  checkLinkEntry: "アーカイブ内リンク",
  checkUnsupportedEntry: "未対応エントリ",
  checkEntryPath: "エントリのパス",
  verificationTechnicalDetail: "技術的な詳細",
  cancelJob: "ジョブをキャンセル",
  retryJob: "ジョブを再試行",
  dismissCompletedJob: "完了したジョブを閉じる",
  dismissVerificationResult: "保存した検証結果を削除",
  dismissVerificationResultTitle: "検証結果を削除しますか？",
  deleteVerificationResult: "結果を削除",
  dismissVerificationReportWarning:
    "この検証結果を削除しますか？削除後は表示もエクスポートもできません。",
  dismissJobResultTitle: "ジョブ履歴を削除しますか？",
  dismissJobResultWarning:
    "ジョブセンターから保存済み結果、エラー詳細、再試行項目を削除します。出力ファイルは削除しません。",
  removeJobResult: "結果を削除",
  showInFolder: "保存先フォルダーを開く",
  openCreatedArchive: "作成したアーカイブを開く",
  openJobOutput: "出力アーカイブを開く",
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
  jobRestarted:
    "ジョブの完了前にアプリが終了しました。処理がまだ必要な場合は、元の画面からもう一度開始してください。",
  jobOperationFailed: "処理を完了できませんでした。",
  jobOperationFailedAction:
    "処理設定と出力先を確認してから、もう一度実行してください。",
  jobPermissionDenied:
    "必要なファイルまたはフォルダーへアクセスする権限がありません。",
  jobNotFound: "必要なファイルまたはフォルダーが見つかりませんでした。",
  jobInvalidInput: "処理の設定が正しくありません。",
  jobInvalidData: "アーカイブのデータを処理できませんでした。",
  jobWorkerFailed: "バックグラウンド処理が予期せず停止しました。",
  jobArchiveEntryAlreadyExists: "同じアーカイブパスの項目が既に存在します。",
  jobPreviousArchiveNotRemoved:
    "新しいアーカイブは保存されましたが、以前のアーカイブのバックアップを削除できませんでした。",
  jobPreviousArchiveNotRemovedAction:
    "新しいアーカイブを確認した後、残されたバックアップを確認して削除してください。",
  jobStateNotPersisted:
    "このジョブは実行中ですが、アプリを再起動すると状態を表示できない可能性があります。",
  retry: "再試行",
  jobOutputAlreadyExists: "出力ファイルは既に存在します。",
  jobOutputAlreadyExistsAction:
    "既存ファイルを移動または名前変更するか、別の出力先を選んでから再試行してください。",
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
  errorEncryptedDataUnverifiable:
    "このアーカイブには、暗号化された無圧縮データを安全に検証するための整合性情報がありません。",
  errorPathNotFound: "選択したアーカイブまたは項目が見つかりません。",
  errorPermissionDenied: "アーカイブを読み取る権限がありません。",
  errorIo: "アーカイブを読み取れませんでした。",
  errorArchiveCorrupt:
    "PNAアーカイブとして読み取れないか、データが破損しています。",
  actionEnterPassword: "パスワードを入力して、もう一度お試しください。",
  actionCheckLocation: "場所を確認するか、一覧から選び直してください。",
  actionCheckPassword: "パスワードを確認して、もう一度入力してください。",
  actionRecreateWithIntegrity:
    "内容を開くには、整合性メタデータを含むアーカイブとして作り直してください。",
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
