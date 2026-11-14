import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createKinanaI18n, SUPPORTED_LANGUAGES } from "../src/i18n/index.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, "..");

test("Custom Auto-Lock duration controls wire numeric 45 placeholder, localized minutes unit, and responsive layout", () => {
  const appSrc = fs.readFileSync(path.join(uiRoot, "src/App.tsx"), "utf8");

  // Verify numeric placeholder '45'
  assert.ok(
    appSrc.includes('placeholder="45"'),
    "Expected custom auto-lock duration input to use concise numeric placeholder '45'"
  );

  // Verify localized minutesUnit label is rendered
  assert.ok(
    appSrc.includes('{t("settings.autoLock.minutesUnit")}'),
    "Expected localized minutes unit label beside input"
  );

  // Verify custom label is preserved
  assert.ok(
    appSrc.includes('{t("settings.autoLock.customLabel")}'),
    "Expected custom duration label to be preserved"
  );

  // Verify compact input width and center alignment
  assert.ok(
    appSrc.includes('className="w-20 sm:w-24 shrink-0"') ||
      appSrc.includes('w-20 sm:w-24'),
    "Expected input to be constrained to compact width"
  );
  assert.ok(
    appSrc.includes("text-center"),
    "Expected numeric placeholder and input to be centered"
  );

  // Verify Apply button and input are inside aligned flex container
  assert.ok(
    appSrc.includes('{t("common.apply")}'),
    "Expected Apply button to be present"
  );
});

test("Auto-Lock minutesUnit translation exists across all 22 supported languages with zero emoji", () => {
  const expectedTranslations = {
    ar: "دقيقة",
    en: "minutes",
    es: "minutos",
    fr: "minutes",
    de: "Minuten",
    "pt-BR": "minutos",
    "zh-CN": "分钟",
    "zh-TW": "分鐘",
    ja: "分",
    ko: "분",
    ru: "мин.",
    fa: "دقیقه",
    tr: "dakika",
    it: "minuti",
    id: "menit",
    hi: "मिनट",
    vi: "phút",
    pl: "min.",
    uk: "хв.",
    ur: "منٹ",
    th: "นาที",
    he: "דקות",
  };

  const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

  for (const lang of SUPPORTED_LANGUAGES) {
    const i18n = createKinanaI18n(lang.code);
    const translatedUnit = i18n.t("settings.autoLock.minutesUnit");
    assert.ok(
      typeof translatedUnit === "string" && translatedUnit.trim().length > 0,
      `Expected non-empty minutesUnit in ${lang.code}`
    );
    assert.ok(
      !EMOJI_RE.test(translatedUnit),
      `Found unexpected emoji in ${lang.code} minutesUnit: ${translatedUnit}`
    );

    if (expectedTranslations[lang.code]) {
      assert.equal(
        translatedUnit,
        expectedTranslations[lang.code],
        `Unexpected translation for ${lang.code}`
      );
    }
  }

  // Check representative languages specifically
  const arI18n = createKinanaI18n("ar");
  const enI18n = createKinanaI18n("en");
  const deI18n = createKinanaI18n("de");
  const frI18n = createKinanaI18n("fr");
  const faI18n = createKinanaI18n("fa");
  const zhTwI18n = createKinanaI18n("zh-TW");

  assert.equal(arI18n.t("settings.autoLock.minutesUnit"), "دقيقة");
  assert.equal(enI18n.t("settings.autoLock.minutesUnit"), "minutes");
  assert.equal(deI18n.t("settings.autoLock.minutesUnit"), "Minuten");
  assert.equal(frI18n.t("settings.autoLock.minutesUnit"), "minutes");
  assert.equal(faI18n.t("settings.autoLock.minutesUnit"), "دقیقه");
  assert.equal(zhTwI18n.t("settings.autoLock.minutesUnit"), "分鐘");
});

test("Minimalist subtle scrollbar styles in index.css enforce thin dimensions, transparent track, and subtle dark thumb", () => {
  const cssSrc = fs.readFileSync(path.join(uiRoot, "src/index.css"), "utf8");

  // Webkit scrollbar width/height of 4px
  assert.ok(
    cssSrc.includes("width: 4px;"),
    "Expected webkit scrollbar width: 4px"
  );
  assert.ok(
    cssSrc.includes("height: 4px;"),
    "Expected webkit scrollbar height: 4px"
  );

  // Hidden native scrollbar buttons (arrows)
  assert.ok(
    cssSrc.includes("::-webkit-scrollbar-button") && cssSrc.includes("display: none;"),
    "Expected native scrollbar arrow buttons to be hidden"
  );

  // Transparent track without borders
  assert.ok(
    cssSrc.includes("::-webkit-scrollbar-track") && cssSrc.includes("background: transparent;"),
    "Expected transparent scrollbar track"
  );
  assert.ok(
    cssSrc.includes("border: none;"),
    "Expected scrollbar borders removed"
  );

  // Subtle dark-gray thumb (14% white on dark background)
  assert.ok(
    cssSrc.includes("rgba(255, 255, 255, 0.14)"),
    "Expected subtle thumb color rgba(255, 255, 255, 0.14)"
  );

  // Fully rounded thumb
  assert.ok(
    cssSrc.includes("border-radius: 9999px;"),
    "Expected fully rounded thumb border-radius: 9999px"
  );

  // Hover and active states
  assert.ok(
    cssSrc.includes("::-webkit-scrollbar-thumb:hover"),
    "Expected hover state for thumb"
  );
  assert.ok(
    cssSrc.includes("::-webkit-scrollbar-thumb:active"),
    "Expected active state for thumb"
  );

  // Cross-browser standard scrollbar styling
  assert.ok(
    cssSrc.includes("scrollbar-width: thin;"),
    "Expected standard scrollbar-width: thin"
  );
  assert.ok(
    cssSrc.includes("scrollbar-color: rgba(255, 255, 255, 0.14) transparent;"),
    "Expected standard scrollbar-color property"
  );

  // Dedicated utility to visually hide scrollbars
  assert.ok(
    cssSrc.includes(".kinana-scrollbar-hidden"),
    "Expected .kinana-scrollbar-hidden utility class"
  );
  assert.ok(
    cssSrc.includes("scrollbar-width: none;"),
    "Expected scrollbar-width: none in hidden utility"
  );
});

test("Language dropdown applies dedicated kinana-scrollbar-hidden utility while preserving options accessibility", () => {
  const switcherSrc = fs.readFileSync(
    path.join(uiRoot, "src/components/LanguageSwitcher.tsx"),
    "utf8"
  );

  // Options list applies dedicated utility
  assert.ok(
    switcherSrc.includes("kinana-scrollbar-hidden"),
    "Expected language options listbox to use kinana-scrollbar-hidden utility class"
  );
  assert.ok(
    switcherSrc.includes("overflow-y-auto"),
    "Expected options listbox to remain vertically scrollable via overflow-y-auto"
  );

  // Keyboard navigation and auto scroll remain wired
  assert.ok(
    switcherSrc.includes('scrollIntoView({ block: "nearest" })'),
    "Expected highlighted option to scroll into view automatically"
  );
  assert.ok(
    switcherSrc.includes('e.key === "ArrowDown"'),
    "Expected ArrowDown keyboard navigation"
  );
  assert.ok(
    switcherSrc.includes('e.key === "ArrowUp"'),
    "Expected ArrowUp keyboard navigation"
  );
});
