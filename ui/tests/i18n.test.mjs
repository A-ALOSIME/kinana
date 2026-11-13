import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  RTL_LANGUAGES,
  SUPPORTED_LANGUAGES,
  SUPPORTED_LANGUAGE_CODES,
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

const ALL_22_LANG_CODES = [
  "ar",
  "en",
  "es",
  "fr",
  "de",
  "pt-BR",
  "zh-CN",
  "zh-TW",
  "ja",
  "ko",
  "ru",
  "fa",
  "tr",
  "it",
  "id",
  "hi",
  "vi",
  "pl",
  "uk",
  "ur",
  "th",
  "he",
];

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

test("All 22 locale JSON resources have structural, plural, and variable parity with zero emoji and correct brand identity", () => {
  const enJson = JSON.parse(
    fs.readFileSync(path.join(uiRoot, "src/i18n/locales/en.json"), "utf8")
  );
  const enLeaves = flattenLocaleLeaves(enJson);
  assert.ok(enLeaves.size >= 469, "Expected comprehensive English localization resource (469 keys)");

  const enBaseKeys = new Map();
  for (const [key, value] of enLeaves.entries()) {
    assert.equal(typeof value, "string", `Expected string value for en:${key}`);
    assert.ok(value.trim().length > 0, `Empty English translation at ${key}`);
    assert.ok(!EMOJI_RE.test(value), `Unexpected emoji in en:${key}: ${value}`);

    const base = stripPluralSuffix(key);
    if (!enBaseKeys.has(base)) enBaseKeys.set(base, []);
    enBaseKeys.get(base).push([key, value]);
  }

  // Iterate over all 22 languages
  for (const langCode of ALL_22_LANG_CODES) {
    const filePath = path.join(uiRoot, `src/i18n/locales/${langCode}.json`);
    assert.ok(fs.existsSync(filePath), `Locale file missing: ${langCode}.json`);

    const langJson = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const langLeaves = flattenLocaleLeaves(langJson);
    assert.ok(
      langLeaves.size >= 469,
      `Expected comprehensive localization resource for ${langCode} (>= 469 keys, got ${langLeaves.size})`
    );

    const langBaseKeys = new Map();
    for (const [key, value] of langLeaves.entries()) {
      assert.equal(typeof value, "string", `Expected string value for ${langCode}:${key}`);
      assert.ok(value.trim().length > 0, `Empty translation in ${langCode} at ${key}`);
      assert.ok(!EMOJI_RE.test(value), `Unexpected emoji in ${langCode}:${key}: ${value}`);

      const base = stripPluralSuffix(key);
      if (!langBaseKeys.has(base)) langBaseKeys.set(base, []);
      langBaseKeys.get(base).push([key, value]);
    }

    // Exact parity on all base keys
    assert.deepEqual(
      [...langBaseKeys.keys()].sort(),
      [...enBaseKeys.keys()].sort(),
      `Base keys in ${langCode} must match en.json 1-to-1`
    );

    // Variable interpolation matching
    for (const baseKey of enBaseKeys.keys()) {
      const enEntries = enBaseKeys.get(baseKey);
      const langEntries = langBaseKeys.get(baseKey);

      const hasPluralEn = enEntries.some(([k]) => PLURAL_SUFFIX_RE.test(k));
      const hasPluralLang = langEntries.some(([k]) => PLURAL_SUFFIX_RE.test(k));
      assert.equal(
        hasPluralLang,
        hasPluralEn,
        `Pluralization form usage mismatch for base key ${baseKey} in ${langCode}`
      );

      if (!hasPluralEn) {
        assert.equal(langEntries.length, 1);
        assert.deepEqual(
          extractPlaceholders(langEntries[0][1]),
          extractPlaceholders(enEntries[0][1]),
          `Interpolation placeholders mismatch at ${baseKey} in ${langCode}`
        );
      } else {
        const enOther = enEntries.find(([k]) => k.endsWith("_other"));
        const langOther = langEntries.find(([k]) => k.endsWith("_other"));
        assert.ok(enOther, `Missing _other plural form in en for ${baseKey}`);
        assert.ok(langOther, `Missing _other plural form in ${langCode} for ${baseKey}`);
        assert.deepEqual(
          extractPlaceholders(langOther[1]),
          extractPlaceholders(enOther[1]),
          `Plural _other placeholders mismatch at ${baseKey} in ${langCode}`
        );
      }
    }

    // Brand identity must remain "Kinana" across all 22 languages
    assert.equal(
      langJson.common.appName,
      "Kinana",
      `Brand name common.appName must be "Kinana" in ${langCode}`
    );
  }
});

test("Language architecture supports all 22 languages, defaults to ar RTL, and persists independently", () => {
  assert.equal(DEFAULT_LANGUAGE, "ar");
  assert.equal(SUPPORTED_LANGUAGES.length, 22);
  assert.deepEqual(
    SUPPORTED_LANGUAGES.map((o) => o.code),
    ALL_22_LANG_CODES
  );
  assert.deepEqual([...SUPPORTED_LANGUAGE_CODES], ALL_22_LANG_CODES);

  // Direction checks
  assert.equal(getLanguageDirection("ar"), "rtl");
  assert.equal(getLanguageDirection("fa"), "rtl");
  assert.equal(getLanguageDirection("ur"), "rtl");
  assert.equal(getLanguageDirection("he"), "rtl");

  const ltrCodes = ALL_22_LANG_CODES.filter((c) => !RTL_LANGUAGES.has(c));
  assert.equal(ltrCodes.length, 18);
  for (const code of ltrCodes) {
    assert.equal(getLanguageDirection(code), "ltr", `Expected ltr for ${code}`);
  }

  // Normalization checks
  assert.equal(normalizeLanguage(undefined), "ar");
  assert.equal(normalizeLanguage(null), "ar");
  assert.equal(normalizeLanguage("unknown-lang"), "ar");
  assert.equal(normalizeLanguage("en"), "en");
  assert.equal(normalizeLanguage("en-US"), "en");
  assert.equal(normalizeLanguage("pt-BR"), "pt-BR");
  assert.equal(normalizeLanguage("pt-br"), "pt-BR");
  assert.equal(normalizeLanguage("zh-CN"), "zh-CN");
  assert.equal(normalizeLanguage("zh-cn"), "zh-CN");
  assert.equal(normalizeLanguage("zh-TW"), "zh-TW");
  assert.equal(normalizeLanguage("zh-tw"), "zh-TW");
  assert.equal(normalizeLanguage("ja"), "ja");
  assert.equal(normalizeLanguage("ko"), "ko");
  assert.equal(normalizeLanguage("ru"), "ru");
  assert.equal(normalizeLanguage("fa"), "fa");
  assert.equal(normalizeLanguage("ur"), "ur");
  assert.equal(normalizeLanguage("he"), "he");
  assert.equal(normalizeLanguage("hi"), "hi");
  assert.equal(normalizeLanguage("th"), "th");
  assert.equal(normalizeLanguage("vi"), "vi");
  assert.equal(normalizeLanguage("de"), "de");
  assert.equal(normalizeLanguage("fr"), "fr");
  assert.equal(normalizeLanguage("es"), "es");
  assert.equal(normalizeLanguage("it"), "it");
  assert.equal(normalizeLanguage("pl"), "pl");
  assert.equal(normalizeLanguage("tr"), "tr");
  assert.equal(normalizeLanguage("uk"), "uk");
  assert.equal(normalizeLanguage("id"), "id");

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

    // Switching to German (de, LTR)
    persistLanguage("de");
    assert.equal(storage.getItem(LANGUAGE_STORAGE_KEY), "de");
    assert.equal(syncDocumentLanguage("de"), "ltr");
    assert.equal(fakeDoc.documentElement.lang, "de");
    assert.equal(fakeDoc.documentElement.dir, "ltr");
    assert.equal(fakeDoc.title, "Kinana");

    instance = createKinanaI18n(readStoredLanguage());
    assert.equal(instance.language, "de");
    assert.equal(instance.dir("de"), "ltr");
    assert.equal(instance.t("auth.unlock.submit"), "Tresor entsperren");

    // Switching to Persian (fa, RTL)
    persistLanguage("fa");
    assert.equal(storage.getItem(LANGUAGE_STORAGE_KEY), "fa");
    assert.equal(syncDocumentLanguage("fa"), "rtl");
    assert.equal(fakeDoc.documentElement.lang, "fa");
    assert.equal(fakeDoc.documentElement.dir, "rtl");

    instance = createKinanaI18n(readStoredLanguage());
    assert.equal(instance.language, "fa");
    assert.equal(instance.dir("fa"), "rtl");
    assert.equal(instance.t("auth.unlock.submit"), "باز کردن گاوصندوق");

    // Switching to Japanese (ja, LTR)
    persistLanguage("ja");
    assert.equal(storage.getItem(LANGUAGE_STORAGE_KEY), "ja");
    assert.equal(syncDocumentLanguage("ja"), "ltr");
    assert.equal(fakeDoc.documentElement.lang, "ja");
    assert.equal(fakeDoc.documentElement.dir, "ltr");

    instance = createKinanaI18n(readStoredLanguage());
    assert.equal(instance.language, "ja");
    assert.equal(instance.dir("ja"), "ltr");
    assert.equal(instance.t("auth.unlock.submit"), "保管庫のロックを解除");

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

test("Pluralization, interpolation, backend error mapping, and platform localization work across languages", () => {
  const arI18n = createKinanaI18n("ar");
  const enI18n = createKinanaI18n("en");
  const ruI18n = createKinanaI18n("ru");
  const zhI18n = createKinanaI18n("zh-CN");

  // Pluralization & variable interpolation
  assert.equal(arI18n.t("status.minutesUnit", { count: 1 }), "دقيقة واحدة");
  assert.equal(arI18n.t("status.minutesUnit", { count: 2 }), "دقيقتان");
  assert.equal(arI18n.t("status.minutesUnit", { count: 5 }), "5 دقائق");

  assert.equal(enI18n.t("status.minutesUnit", { count: 1 }), "1 minute");
  assert.equal(enI18n.t("status.minutesUnit", { count: 5 }), "5 minutes");

  assert.equal(ruI18n.t("status.minutesUnit", { count: 1 }), "1 минута");
  assert.equal(zhI18n.t("status.minutesUnit", { count: 5 }), "5 分钟");

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
