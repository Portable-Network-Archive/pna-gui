import type { AppErrorDto, ArchiveEntry, PreviewDescriptor } from "./types";
import type { SupportedLocale, TranslationKey } from "../i18n";

export type Translate = (key: TranslationKey) => string;

export function kindLabel(kind: ArchiveEntry["kind"], t: Translate): string {
  return {
    file: t("file"),
    directory: t("directory"),
    symlink: t("symlink"),
    hardlink: t("hardlink"),
  }[kind];
}

export function formatCount(value: number, locale: SupportedLocale): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatBytes(value: number, locale: SupportedLocale): string {
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  const amount = value / 1024 ** unit;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(amount)} ${units[unit]}`;
}

export function formatOptionalBytes(
  value: number | null | undefined,
  locale: SupportedLocale,
): string {
  return value == null ? "—" : formatBytes(value, locale);
}

export function formatDateTime(value: number, locale: SupportedLocale): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}

export function formatOptionalDate(
  value: number | null | undefined,
  locale: SupportedLocale,
): string {
  return value == null ? "—" : formatDateTime(value, locale);
}

export function localizeEncryption(
  value: string | null | undefined,
  t: Translate,
): string {
  if (!value) return "—";
  return value.toLowerCase() === "none" || value === "なし" ? t("none") : value;
}

export function localizeEncryptionList(values: string[], t: Translate): string {
  if (values.length === 0) return t("none");
  return values.map((value) => localizeEncryption(value, t)).join(" / ");
}

export function previewMessage(
  code: PreviewDescriptor["messageCode"],
  t: Translate,
): string {
  if (!code) return "";
  return {
    SELECT_FILE: t("previewSelectFile"),
    UNSUPPORTED_TYPE: t("previewUnsupported"),
    BINARY_DATA: t("previewBinary"),
    TRUNCATED: t("previewTruncated"),
  }[code];
}

export function localizeError(error: AppErrorDto, t: Translate): AppErrorDto {
  const message =
    {
      INTERNAL_ERROR: t("errorInternal"),
      INVALID_ARGUMENT: t("errorInvalidArgument"),
      PASSWORD_REQUIRED: t("errorPasswordRequired"),
      WRONG_PASSWORD: t("errorWrongPassword"),
      ENCRYPTED_DATA_UNVERIFIABLE: t("errorEncryptedDataUnverifiable"),
      PATH_NOT_FOUND: t("errorPathNotFound"),
      PERMISSION_DENIED: t("errorPermissionDenied"),
      IO_ERROR: t("errorIo"),
      ARCHIVE_CORRUPT: t("errorArchiveCorrupt"),
    }[error.code] ?? error.message;
  const userAction =
    {
      PASSWORD_REQUIRED: t("actionEnterPassword"),
      WRONG_PASSWORD: t("actionCheckPassword"),
      ENCRYPTED_DATA_UNVERIFIABLE: t("actionRecreateWithIntegrity"),
      PATH_NOT_FOUND: t("actionCheckLocation"),
    }[error.code] ?? error.userAction;
  return { ...error, message, userAction };
}
