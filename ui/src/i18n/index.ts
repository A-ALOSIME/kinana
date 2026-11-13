import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import ar from "./locales/ar.json" with { type: "json" };
import de from "./locales/de.json" with { type: "json" };
import en from "./locales/en.json" with { type: "json" };
import es from "./locales/es.json" with { type: "json" };
import fa from "./locales/fa.json" with { type: "json" };
import fr from "./locales/fr.json" with { type: "json" };
import he from "./locales/he.json" with { type: "json" };
import hi from "./locales/hi.json" with { type: "json" };
import id from "./locales/id.json" with { type: "json" };
import it from "./locales/it.json" with { type: "json" };
import ja from "./locales/ja.json" with { type: "json" };
import ko from "./locales/ko.json" with { type: "json" };
import pl from "./locales/pl.json" with { type: "json" };
import ptBR from "./locales/pt-BR.json" with { type: "json" };
import ru from "./locales/ru.json" with { type: "json" };
import th from "./locales/th.json" with { type: "json" };
import tr from "./locales/tr.json" with { type: "json" };
import uk from "./locales/uk.json" with { type: "json" };
import ur from "./locales/ur.json" with { type: "json" };
import vi from "./locales/vi.json" with { type: "json" };
import zhCN from "./locales/zh-CN.json" with { type: "json" };
import zhTW from "./locales/zh-TW.json" with { type: "json" };

export type SupportedLanguage =
  | "ar"
  | "en"
  | "es"
  | "fr"
  | "de"
  | "pt-BR"
  | "zh-CN"
  | "zh-TW"
  | "ja"
  | "ko"
  | "ru"
  | "fa"
  | "tr"
  | "it"
  | "id"
  | "hi"
  | "vi"
  | "pl"
  | "uk"
  | "ur"
  | "th"
  | "he";

export type TextDirection = "rtl" | "ltr";

export const DEFAULT_LANGUAGE: SupportedLanguage = "ar";
export const LANGUAGE_STORAGE_KEY = "kinana_language";

export const RTL_LANGUAGES = new Set<SupportedLanguage>(["ar", "fa", "ur", "he"]);

export interface LanguageOption {
  code: SupportedLanguage;
  label: string;
  dir: TextDirection;
}

export const SUPPORTED_LANGUAGES: readonly LanguageOption[] = [
  { code: "ar", label: "العربية", dir: "rtl" },
  { code: "en", label: "English", dir: "ltr" },
  { code: "es", label: "Español", dir: "ltr" },
  { code: "fr", label: "Français", dir: "ltr" },
  { code: "de", label: "Deutsch", dir: "ltr" },
  { code: "pt-BR", label: "Português (Brasil)", dir: "ltr" },
  { code: "zh-CN", label: "简体中文", dir: "ltr" },
  { code: "zh-TW", label: "繁體中文", dir: "ltr" },
  { code: "ja", label: "日本語", dir: "ltr" },
  { code: "ko", label: "한국어", dir: "ltr" },
  { code: "ru", label: "Русский", dir: "ltr" },
  { code: "fa", label: "فارسی", dir: "rtl" },
  { code: "tr", label: "Türkçe", dir: "ltr" },
  { code: "it", label: "Italiano", dir: "ltr" },
  { code: "id", label: "Bahasa Indonesia", dir: "ltr" },
  { code: "hi", label: "हिन्दी", dir: "ltr" },
  { code: "vi", label: "Tiếng Việt", dir: "ltr" },
  { code: "pl", label: "Polski", dir: "ltr" },
  { code: "uk", label: "Українська", dir: "ltr" },
  { code: "ur", label: "اردو", dir: "rtl" },
  { code: "th", label: "ไทย", dir: "ltr" },
  { code: "he", label: "עברית", dir: "rtl" },
] as const;

export const SUPPORTED_LANGUAGE_CODES: readonly SupportedLanguage[] = SUPPORTED_LANGUAGES.map(
  (o) => o.code
);

export function normalizeLanguage(lang?: string | null): SupportedLanguage {
  if (!lang) return DEFAULT_LANGUAGE;
  const lower = lang.trim().toLowerCase();

  // Exact matches
  if (lower === "ar" || lower.startsWith("ar-") || lower.startsWith("ar_")) return "ar";
  if (lower === "en" || lower.startsWith("en-") || lower.startsWith("en_")) return "en";
  if (lower === "es" || lower.startsWith("es-") || lower.startsWith("es_")) return "es";
  if (lower === "fr" || lower.startsWith("fr-") || lower.startsWith("fr_")) return "fr";
  if (lower === "de" || lower.startsWith("de-") || lower.startsWith("de_")) return "de";
  if (lower === "pt-br" || lower.startsWith("pt")) return "pt-BR";
  if (lower === "zh-tw" || lower === "zh-hant" || lower.startsWith("zh-tw") || lower.startsWith("zh-hk")) return "zh-TW";
  if (lower === "zh-cn" || lower === "zh-hans" || lower.startsWith("zh")) return "zh-CN";
  if (lower === "ja" || lower.startsWith("ja-") || lower.startsWith("ja_")) return "ja";
  if (lower === "ko" || lower.startsWith("ko-") || lower.startsWith("ko_")) return "ko";
  if (lower === "ru" || lower.startsWith("ru-") || lower.startsWith("ru_")) return "ru";
  if (lower === "fa" || lower.startsWith("fa-") || lower.startsWith("fa_")) return "fa";
  if (lower === "tr" || lower.startsWith("tr-") || lower.startsWith("tr_")) return "tr";
  if (lower === "it" || lower.startsWith("it-") || lower.startsWith("it_")) return "it";
  if (lower === "id" || lower.startsWith("id-") || lower.startsWith("id_")) return "id";
  if (lower === "hi" || lower.startsWith("hi-") || lower.startsWith("hi_")) return "hi";
  if (lower === "vi" || lower.startsWith("vi-") || lower.startsWith("vi_")) return "vi";
  if (lower === "pl" || lower.startsWith("pl-") || lower.startsWith("pl_")) return "pl";
  if (lower === "uk" || lower.startsWith("uk-") || lower.startsWith("uk_")) return "uk";
  if (lower === "ur" || lower.startsWith("ur-") || lower.startsWith("ur_")) return "ur";
  if (lower === "th" || lower.startsWith("th-") || lower.startsWith("th_")) return "th";
  if (lower === "he" || lower.startsWith("he-") || lower.startsWith("he_")) return "he";

  return DEFAULT_LANGUAGE;
}

export function getLanguageDirection(lang?: string | null): TextDirection {
  const normalized = normalizeLanguage(lang);
  return RTL_LANGUAGES.has(normalized) ? "rtl" : "ltr";
}

export function readStoredLanguage(): SupportedLanguage {
  try {
    const storage = globalThis?.localStorage;
    if (!storage) return DEFAULT_LANGUAGE;
    return normalizeLanguage(storage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function persistLanguage(lang: SupportedLanguage): void {
  try {
    const storage = globalThis?.localStorage;
    if (!storage) return;
    storage.setItem(LANGUAGE_STORAGE_KEY, normalizeLanguage(lang));
  } catch {
    // Ignore storage unavailability in restricted contexts
  }
}

export function syncDocumentLanguage(lang?: string | null): TextDirection {
  const normalized = normalizeLanguage(lang);
  const dir = getLanguageDirection(normalized);
  try {
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.lang = normalized;
      document.documentElement.dir = dir;
      document.title = "Kinana";
    }
  } catch {
    // Safe no-op in non-DOM test environments
  }
  return dir;
}

export const i18nResources = {
  ar: { translation: ar },
  de: { translation: de },
  en: { translation: en },
  es: { translation: es },
  fa: { translation: fa },
  fr: { translation: fr },
  he: { translation: he },
  hi: { translation: hi },
  id: { translation: id },
  it: { translation: it },
  ja: { translation: ja },
  ko: { translation: ko },
  pl: { translation: pl },
  "pt-BR": { translation: ptBR },
  ru: { translation: ru },
  th: { translation: th },
  tr: { translation: tr },
  uk: { translation: uk },
  ur: { translation: ur },
  vi: { translation: vi },
  "zh-CN": { translation: zhCN },
  "zh-TW": { translation: zhTW },
} as const;

export function createKinanaI18n(initialLanguage: SupportedLanguage = readStoredLanguage()) {
  const instance = i18n.createInstance();
  instance.use(initReactI18next).init({
    resources: i18nResources,
    lng: initialLanguage,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGE_CODES],
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });
  return instance;
}

const initialLanguage = readStoredLanguage();

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: i18nResources,
    lng: initialLanguage,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGE_CODES],
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });
}

syncDocumentLanguage(initialLanguage);

export async function changeAppLanguage(lang: SupportedLanguage): Promise<TextDirection> {
  const normalized = normalizeLanguage(lang);
  persistLanguage(normalized);
  await i18n.changeLanguage(normalized);
  return syncDocumentLanguage(normalized);
}

export default i18n;
