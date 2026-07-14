import { describe, expect, it } from "vitest";
import {
  formatAttributeCount,
  formatItemCount,
  resolveLocale,
  translate,
} from "../../src/features/i18n";

describe("locale resolution", () => {
  it.each([
    ["UI-LOC-EN", ["en-US"], "en"],
    ["UI-LOC-JA", ["ja-JP"], "ja"],
    ["UI-LOC-FALLBACK", ["fr-FR"], "en"],
    ["UI-LOC-EMPTY", [], "en"],
  ] as const)(
    "[%s] resolves the primary environment language",
    (_, languages, expected) => {
      expect(resolveLocale(languages)).toBe(expected);
    },
  );

  it("[UI-LOC-COPY] provides complete English and Japanese product copy", () => {
    expect(translate("en", "openArchive")).toBe("Open archive");
    expect(translate("ja", "openArchive")).toBe("アーカイブを開く");
  });
});

describe("localized counters", () => {
  it.each([
    ["UI-COUNT-EN-ZERO", 0, "en", "0 items"],
    ["UI-COUNT-EN-ONE", 1, "en", "1 item"],
    ["UI-COUNT-EN-MANY", 2, "en", "2 items"],
    ["UI-COUNT-JA", 2, "ja", "2 項目"],
  ] as const)("[%s] formats item count", (_, value, locale, expected) => {
    expect(formatItemCount(value, locale)).toBe(expected);
  });

  it.each([
    ["UI-XATTR-EN-ONE", 1, "en", "1 attribute"],
    ["UI-XATTR-EN-MANY", 2, "en", "2 attributes"],
    ["UI-XATTR-JA", 2, "ja", "2件"],
  ] as const)("[%s] formats attribute count", (_, value, locale, expected) => {
    expect(formatAttributeCount(value, locale)).toBe(expected);
  });
});
