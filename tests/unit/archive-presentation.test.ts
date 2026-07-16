import { describe, expect, it } from "vitest";
import { translate } from "../../src/features/i18n";
import {
  formatBytes,
  formatOptionalBytes,
  formatOptionalDate,
  kindLabel,
  localizeEncryption,
  localizeEncryptionList,
  localizeError,
  previewMessage,
} from "../../src/features/archive/presentation";

const en = (key: Parameters<typeof translate>[1]) => translate("en", key);
const ja = (key: Parameters<typeof translate>[1]) => translate("ja", key);

describe("archive presentation", () => {
  it.each([
    ["UI-BYTES-ZERO", 0, "0 B"],
    ["UI-BYTES-BYTES", 512, "512 B"],
    ["UI-BYTES-KIB", 1536, "1.5 KB"],
  ] as const)("[%s] formats byte values", (_, value, expected) => {
    expect(formatBytes(value, "en")).toBe(expected);
  });

  it.each([
    ["UI-NULL-BYTES-UNDEFINED", undefined],
    ["UI-NULL-BYTES-NULL", null],
  ] as const)("[%s] renders missing byte values as an em dash", (_, value) => {
    expect(formatOptionalBytes(value, "en")).toBe("—");
  });

  it.each([
    ["UI-NULL-DATE-UNDEFINED", undefined],
    ["UI-NULL-DATE-NULL", null],
  ] as const)(
    "[%s] never renders a missing date as the Unix epoch",
    (_, value) => {
      expect(formatOptionalDate(value, "en")).toBe("—");
    },
  );

  it.each([
    ["UI-KIND-FILE", "file", "File"],
    ["UI-KIND-DIRECTORY", "directory", "Folder"],
    ["UI-KIND-SYMLINK", "symlink", "Symbolic link"],
    ["UI-KIND-HARDLINK", "hardlink", "Hard link"],
  ] as const)("[%s] localizes entry kinds", (_, kind, expected) => {
    expect(kindLabel(kind, en)).toBe(expected);
  });

  it.each([
    ["UI-ENCRYPT-NONE-TITLE", "None"],
    ["UI-ENCRYPT-NONE-LOWER", "none"],
    ["UI-ENCRYPT-NONE-JA", "なし"],
  ] as const)("[%s] canonicalizes no-encryption values", (_, value) => {
    expect(localizeEncryption(value, en)).toBe("None");
  });

  it("[UI-ENCRYPT-LIST] formats mixed encryption methods", () => {
    expect(localizeEncryptionList(["None", "AES"], en)).toBe("None / AES");
    expect(localizeEncryptionList([], ja)).toBe("なし");
  });

  it.each([
    ["UI-PREVIEW-SELECT", "SELECT_FILE", "Select a file to preview it."],
    [
      "UI-PREVIEW-UNSUPPORTED",
      "UNSUPPORTED_TYPE",
      "This file type is not available for safe text preview.",
    ],
    ["UI-PREVIEW-BINARY", "BINARY_DATA", "Binary data cannot be previewed."],
    [
      "UI-PREVIEW-TRUNCATED",
      "TRUNCATED",
      "Showing only the beginning of the file.",
    ],
  ] as const)("[%s] resolves preview result codes", (_, code, expected) => {
    expect(previewMessage(code, en)).toBe(expected);
  });

  it.each([
    [
      "UI-ERROR-INTERNAL",
      "INTERNAL_ERROR",
      "The operation could not be completed.",
    ],
    [
      "UI-ERROR-PASSWORD",
      "PASSWORD_REQUIRED",
      "A password is required to open this archive.",
    ],
    [
      "UI-ERROR-WRONG-PASSWORD",
      "WRONG_PASSWORD",
      "The password is incorrect or the encrypted data could not be read.",
    ],
    [
      "UI-ERROR-ENCRYPTED-UNVERIFIABLE",
      "ENCRYPTED_DATA_UNVERIFIABLE",
      "This archive does not contain the integrity information needed to verify encrypted uncompressed data safely.",
    ],
    [
      "UI-ERROR-NOT-FOUND",
      "PATH_NOT_FOUND",
      "The selected archive or item could not be found.",
    ],
    [
      "UI-ERROR-PERMISSION",
      "PERMISSION_DENIED",
      "You do not have permission to read this archive.",
    ],
    ["UI-ERROR-IO", "IO_ERROR", "The archive could not be read."],
    [
      "UI-ERROR-CORRUPT",
      "ARCHIVE_CORRUPT",
      "This is not a readable PNA archive, or its data is damaged.",
    ],
  ] as const)(
    "[%s] localizes structured backend errors",
    (_, code, expected) => {
      expect(
        localizeError(
          { code, message: "backend fallback", retryable: true },
          en,
        ).message,
      ).toBe(expected);
    },
  );
});
