import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import ar from "./locales/ar.json" with { type: "json" };
import en from "./locales/en.json" with { type: "json" };

export type SupportedLanguage = "ar" | "en";
export type TextDirection = "rtl" | "ltr";

export const DEFAULT_LANGUAGE: SupportedLanguage = "ar";
export const LANGUAGE_STORAGE_KEY = "kinana_language";

export interface LanguageOption {
  code: SupportedLanguage;
  label: string;
  dir: TextDirection;
}

export const SUPPORTED_LANGUAGES: readonly LanguageOption[] = [
  { code: "ar", label: "العربية", dir: "rtl" },
  { code: "en", label: "English", dir: "ltr" },
] as const;

export function normalizeLanguage(lang?: string | null): SupportedLanguage {
  if (!lang) return DEFAULT_LANGUAGE;
  const lower = lang.trim().toLowerCase();
  if (lower === "en" || lower.startsWith("en-")) {
    return "en";
  }
  return DEFAULT_LANGUAGE;
}

export function getLanguageDirection(lang?: string | null): TextDirection {
  return normalizeLanguage(lang) === "en" ? "ltr" : "rtl";
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
  en: { translation: en },
} as const;

export function createKinanaI18n(initialLanguage: SupportedLanguage = readStoredLanguage()) {
  const instance = i18n.createInstance();
  instance.use(initReactI18next).init({
    resources: i18nResources,
    lng: initialLanguage,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: ["ar", "en"],
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
    supportedLngs: ["ar", "en"],
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
