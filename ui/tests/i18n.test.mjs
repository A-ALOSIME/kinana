import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  createKinanaI18n,
  getLanguageDirection,
  normalizeLanguage,
  persistLanguage,
  readStoredLanguage,
  syncDocumentLanguage,
} from "../src/i18n/index.ts";
import { localizeBackendMessage, localizePlatformName } from "../src/i18n/errorMapper.ts";
import { getDestructiveDialogArrowTarget } from "../src/keyboard.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, "..");

const PLURAL_SUFFIX_RE = /_(zero|one|two|few|many|other)$/;
const ARABIC_CHAR_RE = /[\u0600-\u06FF]/;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function flattenLocaleLeaves(obj, prefix = "", out = new Map()) {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      flattenLocaleLeaves(value, fullKey, out);
    } else {
      out.set(fullKey, value);
    }
  }
  return out;
}

function extractPlaceholders(text) {
  const vars = new Set();
  for (const match of String(text).matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    vars.add(match[1]);
  }
  return [...vars].sort();
}

function stripPluralSuffix(key) {
  return key.replace(PLURAL_SUFFIX_RE, "");
}

function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

test("Locale JSON resources have structural, plural, and variable parity with no untranslated English leaks", () => {
  const arJson = JSON.parse(
    fs.readFileSync(path.join(uiRoot, "src/i18n/locales/ar.json"), "utf8")
  );
  const enJson = JSON.parse(
    fs.readFileSync(path.join(uiRoot, "src/i18n/locales/en.json"), "utf8")
  );

  const arLeaves = flattenLocaleLeaves(arJson);
  const enLeaves = flattenLocaleLeaves(enJson);

  assert.ok(arLeaves.size > 200, "Expected comprehensive Arabic localization resource");
  assert.ok(enLeaves.size > 200, "Expected comprehensive English localization resource");

  const arBaseKeys = new Map();
  for (const [key, value] of arLeaves.entries()) {
    assert.equal(typeof value, "string", `Expected string value for ar:${key}`);
    assert.ok(value.trim().length > 0, `Empty Arabic translation at ${key}`);
    assert.ok(!EMOJI_RE.test(value), `Unexpected emoji in ar:${key}: ${value}`);

    const base = stripPluralSuffix(key);
    if (!arBaseKeys.has(base)) arBaseKeys.set(base, []);
    arBaseKeys.get(base).push([key, value]);
  }

  const enBaseKeys = new Map();
  for (const [key, value] of enLeaves.entries()) {
    assert.equal(typeof value, "string", `Expected string value for en:${key}`);
    assert.ok(value.trim().length > 0, `Empty English translation at ${key}`);
    assert.ok(!EMOJI_RE.test(value), `Unexpected emoji in en:${key}: ${value}`);

    if (key !== "language.ar") {
      assert.ok(
        !ARABIC_CHAR_RE.test(value),
        `English translation en:${key} must not contain Arabic text: ${value}`
      );
    }

    const base = stripPluralSuffix(key);
    if (!enBaseKeys.has(base)) enBaseKeys.set(base, []);
    enBaseKeys.get(base).push([key, value]);
  }

  // Exact parity on all base keys
  assert.deepEqual(
    [...arBaseKeys.keys()].sort(),
    [...enBaseKeys.keys()].sort(),
    "Arabic and English locale base keys must match 1-to-1"
  );

  // Interpolation variables must match per base key across forms (e.g., _one may omit {{count}} while _other uses {{count}})
  for (const baseKey of arBaseKeys.keys()) {
    const arEntries = arBaseKeys.get(baseKey);
    const enEntries = enBaseKeys.get(baseKey);

    const hasPluralAr = arEntries.some(([k]) => PLURAL_SUFFIX_RE.test(k));
    const hasPluralEn = enEntries.some(([k]) => PLURAL_SUFFIX_RE.test(k));
    assert.equal(
      hasPluralAr,
      hasPluralEn,
      `Pluralization form usage mismatch for base key ${baseKey}`
    );

    if (!hasPluralAr) {
      assert.equal(arEntries.length, 1);
      assert.equal(enEntries.length, 1);
      assert.deepEqual(
        extractPlaceholders(arEntries[0][1]),
        extractPlaceholders(enEntries[0][1]),
        `Interpolation placeholders mismatch at ${baseKey}`
      );
    } else {
      // Every non-_one form in both locales must expose the same interpolation vars
      const arOther = arEntries.find(([k]) => k.endsWith("_other"));
      const enOther = enEntries.find(([k]) => k.endsWith("_other"));
      assert.ok(arOther, `Missing _other plural form in ar for ${baseKey}`);
      assert.ok(enOther, `Missing _other plural form in en for ${baseKey}`);
      assert.deepEqual(
        extractPlaceholders(arOther[1]),
        extractPlaceholders(enOther[1]),
        `Plural _other placeholders mismatch at ${baseKey}`
      );
    }
  }

  // Brand identity must remain "Kinana" in both languages
  assert.equal(arJson.common.appName, "Kinana");
  assert.equal(enJson.common.appName, "Kinana");
  assert.equal(arJson.language.ar, "العربية");
  assert.equal(enJson.language.en, "English");
});

test("Language architecture restricts selectable languages to ar/en, defaults to ar RTL, and persists independently", () => {
  assert.equal(DEFAULT_LANGUAGE, "ar");
  assert.deepEqual(
    SUPPORTED_LANGUAGES.map((o) => o.code),
    ["ar", "en"]
  );
  assert.equal(normalizeLanguage(undefined), "ar");
  assert.equal(normalizeLanguage("fr"), "ar");
  assert.equal(normalizeLanguage("en"), "en");
  assert.equal(normalizeLanguage("en-US"), "en");
  assert.equal(getLanguageDirection("ar"), "rtl");
  assert.equal(getLanguageDirection("en"), "ltr");

  const prevStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const prevDocument = Object.getOwnPropertyDescriptor(globalThis, "document");

  try {
    const storage = createMemoryStorage();
    Object.defineProperty(globalThis, "localStorage", {
      value: storage,
      configurable: true,
    });
    const fakeDoc = {
      documentElement: { lang: "", dir: "" },
      title: "",
    };
    Object.defineProperty(globalThis, "document", {
      value: fakeDoc,
      configurable: true,
    });

    // Fresh environment defaults to Arabic RTL
    assert.equal(readStoredLanguage(), "ar");
    let instance = createKinanaI18n(readStoredLanguage());
    assert.equal(instance.language, "ar");

    // Switching to English persists across simulated app restart and syncs document metadata
    persistLanguage("en");
    assert.equal(storage.getItem(LANGUAGE_STORAGE_KEY), "en");
    assert.equal(syncDocumentLanguage("en"), "ltr");
    assert.equal(fakeDoc.documentElement.lang, "en");
    assert.equal(fakeDoc.documentElement.dir, "ltr");
    assert.equal(fakeDoc.title, "Kinana");

    instance = createKinanaI18n(readStoredLanguage());
    assert.equal(instance.language, "en");
    assert.equal(instance.dir("en"), "ltr");
    assert.equal(instance.t("auth.unlock.submit"), "Unlock Vault");

    // Switching back to Arabic restores RTL
    persistLanguage("ar");
    assert.equal(syncDocumentLanguage("ar"), "rtl");
    assert.equal(fakeDoc.documentElement.lang, "ar");
    assert.equal(fakeDoc.documentElement.dir, "rtl");
    assert.equal(fakeDoc.title, "Kinana");

    instance = createKinanaI18n(readStoredLanguage());
    assert.equal(instance.language, "ar");
    assert.equal(instance.dir("ar"), "rtl");
    assert.equal(instance.t("auth.unlock.submit"), "فتح الخزنة");
  } finally {
    if (prevStorage) {
      Object.defineProperty(globalThis, "localStorage", prevStorage);
    } else {
      delete globalThis.localStorage;
    }
    if (prevDocument) {
      Object.defineProperty(globalThis, "document", prevDocument);
    } else {
      delete globalThis.document;
    }
  }
});

test("Pluralization, interpolation, backend error mapping, and platform localization work for ar and en", () => {
  const arI18n = createKinanaI18n("ar");
  const enI18n = createKinanaI18n("en");

  // Pluralization & variable interpolation
  assert.equal(arI18n.t("status.minutesUnit", { count: 1 }), "دقيقة واحدة");
  assert.equal(arI18n.t("status.minutesUnit", { count: 2 }), "دقيقتان");
  assert.equal(arI18n.t("status.minutesUnit", { count: 5 }), "5 دقائق");
  assert.equal(arI18n.t("status.minutesUnit", { count: 15 }), "15 دقيقة");

  assert.equal(enI18n.t("status.minutesUnit", { count: 1 }), "1 minute");
  assert.equal(enI18n.t("status.minutesUnit", { count: 5 }), "5 minutes");

  assert.equal(
    arI18n.t("status.zoomHud", { percent: "125%" }),
    "نسبة التكبير: 125%"
  );
  assert.equal(
    enI18n.t("status.zoomHud", { percent: "125%" }),
    "Zoom: 125%"
  );

  // Backend error mapping
  const arLocked = localizeBackendMessage(
    "No active vault session. Vault is locked.",
    undefined,
    arI18n.t.bind(arI18n)
  );
  const enLocked = localizeBackendMessage(
    "No active vault session. Vault is locked.",
    undefined,
    enI18n.t.bind(enI18n)
  );
  assert.ok(ARABIC_CHAR_RE.test(arLocked));
  assert.ok(!ARABIC_CHAR_RE.test(enLocked));
  assert.notEqual(enLocked, "No active vault session. Vault is locked.");

  const enCredWrite = localizeBackendMessage(
    new Error("CredWriteW failed with code 1312"),
    undefined,
    enI18n.t.bind(enI18n)
  );
  assert.ok(enCredWrite.includes("1312"));
  assert.ok(!ARABIC_CHAR_RE.test(enCredWrite));

  const enFallback = localizeBackendMessage("   ", "errors.vaultLocked", enI18n.t.bind(enI18n));
  assert.equal(enFallback, "The vault is locked.");

  // Unknown backend detail stays visible rather than dropped
  assert.equal(
    localizeBackendMessage("Custom IO timeout on E:/vault", "errors.vaultLocked", enI18n.t.bind(enI18n)),
    "Custom IO timeout on E:/vault"
  );

  // Platform names
  assert.equal(
    localizePlatformName("Windows Credential Manager", arI18n.t.bind(arI18n)),
    "مدير اعتمادات ويندوز (Windows Credential Manager)"
  );
  assert.equal(
    localizePlatformName("Windows Credential Manager", enI18n.t.bind(enI18n)),
    "Windows Credential Manager"
  );
  assert.ok(
    !ARABIC_CHAR_RE.test(
      localizePlatformName("Linux Secret Service (gnome-keyring)", enI18n.t.bind(enI18n))
    )
  );
});

test("RTL and LTR directional handling covers arrow navigation, LanguageSwitcher visibility, and offline UI sources", () => {
  // Destructive dialog arrow navigation flips naturally between RTL and LTR
  assert.equal(getDestructiveDialogArrowTarget({ key: "ArrowRight" }, null, "rtl"), "delete");
  assert.equal(getDestructiveDialogArrowTarget({ key: "ArrowLeft" }, null, "rtl"), "cancel");
  assert.equal(getDestructiveDialogArrowTarget({ key: "ArrowRight" }, null, "ltr"), "cancel");
  assert.equal(getDestructiveDialogArrowTarget({ key: "ArrowLeft" }, null, "ltr"), "delete");

  const i18nSrc = fs.readFileSync(path.join(uiRoot, "src/i18n/index.ts"), "utf8");
  assert.ok(!/https?:\/\//i.test(i18nSrc), "i18n setup must remain 100% offline with zero network URLs");

  const switcherSrc = fs.readFileSync(
    path.join(uiRoot, "src/components/LanguageSwitcher.tsx"),
    "utf8"
  );
  assert.ok(switcherSrc.includes('"minimal"'));
  assert.ok(switcherSrc.includes('"settings"'));

  const appSrc = fs.readFileSync(path.join(uiRoot, "src/App.tsx"), "utf8");
  assert.ok(appSrc.includes('<LanguageSwitcher variant="minimal" />'));
  assert.ok(appSrc.includes('<LanguageSwitcher variant="settings" />'));
  assert.ok(appSrc.includes('invoke("set_tray_language"'));
});
