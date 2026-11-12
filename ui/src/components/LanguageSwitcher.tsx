import * as React from "react";
import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  SUPPORTED_LANGUAGES,
  changeAppLanguage,
  normalizeLanguage,
  type SupportedLanguage,
} from "@/i18n";
import { cn } from "@/lib/utils";

export interface LanguageSwitcherProps {
  variant?: "minimal" | "settings";
  className?: string;
  onLanguageChanged?: (lang: SupportedLanguage) => void;
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({
  variant = "minimal",
  className,
  onLanguageChanged,
}) => {
  const { t, i18n } = useTranslation();
  const activeLang = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language);

  const handleSelect = async (lang: SupportedLanguage) => {
    if (lang === activeLang) return;
    await changeAppLanguage(lang);
    onLanguageChanged?.(lang);
  };

  if (variant === "settings") {
    return (
      <div
        className={cn(
          "p-6 rounded-2xl bg-muted/40 border border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4",
          className
        )}
      >
        <div className="flex items-center gap-3">
          <Languages className="w-6 h-6 text-white shrink-0" />
          <div>
            <h4 className="text-lg font-bold text-foreground">
              {t("language.sectionTitle")}
            </h4>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("language.sectionDescription")}
            </p>
          </div>
        </div>

        <div
          role="group"
          aria-label={t("language.switchAriaLabel")}
          className="inline-flex items-center bg-background/80 p-1 rounded-xl border border-border/70 shrink-0 self-start sm:self-auto"
        >
          {SUPPORTED_LANGUAGES.map((opt) => {
            const isSelected = activeLang === opt.code;
            return (
              <button
                key={opt.code}
                type="button"
                data-language-option={opt.code}
                aria-pressed={isSelected}
                onClick={() => void handleSelect(opt.code)}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-bold transition-all cursor-pointer",
                  isSelected
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label={t("language.switchAriaLabel")}
      className={cn(
        "inline-flex items-center gap-1 bg-card/90 backdrop-blur-md p-1 rounded-xl border border-border/70 shadow-sm",
        className
      )}
    >
      <Languages className="w-3.5 h-3.5 text-muted-foreground mx-1.5 shrink-0" aria-hidden="true" />
      {SUPPORTED_LANGUAGES.map((opt) => {
        const isSelected = activeLang === opt.code;
        return (
          <button
            key={opt.code}
            type="button"
            data-language-option={opt.code}
            aria-pressed={isSelected}
            onClick={() => void handleSelect(opt.code)}
            className={cn(
              "px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer",
              isSelected
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};
