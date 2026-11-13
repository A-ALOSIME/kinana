import * as React from "react";
import { Check, ChevronDown, Languages } from "lucide-react";
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

  const [isOpen, setIsOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  const currentOption =
    SUPPORTED_LANGUAGES.find((opt) => opt.code === activeLang) ?? SUPPORTED_LANGUAGES[0];

  React.useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = async (lang: SupportedLanguage) => {
    setIsOpen(false);
    if (lang === activeLang) return;
    await changeAppLanguage(lang);
    onLanguageChanged?.(lang);
  };

  if (variant === "settings") {
    return (
      <div
        className={cn(
          "p-6 rounded-2xl bg-muted/40 border border-border/60 flex flex-col gap-4",
          className
        )}
      >
        <div className="flex items-center gap-3">
          <Languages className="w-6 h-6 text-primary shrink-0" aria-hidden="true" />
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
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 w-full mt-2"
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
                  "flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-sm transition-all cursor-pointer text-start",
                  isSelected
                    ? "bg-primary text-primary-foreground border-primary shadow-sm font-bold"
                    : "bg-background/80 hover:bg-muted/70 text-foreground border-border/60 hover:border-border font-medium"
                )}
              >
                <span dir={opt.dir} className="truncate mr-2 ml-2">
                  {opt.label}
                </span>
                <span
                  className={cn(
                    "text-[10px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0",
                    isSelected
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {opt.code}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className={cn("relative inline-block", className)}>
      <button
        type="button"
        data-language-switcher="trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={t("language.switchAriaLabel")}
        onClick={() => setIsOpen((prev) => !prev)}
        className="inline-flex items-center gap-2 bg-card/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-border/70 shadow-sm text-xs font-semibold text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
      >
        <Languages className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
        <span dir={currentOption.dir} className="truncate max-w-[100px]">
          {currentOption.label}
        </span>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted/70 text-muted-foreground uppercase tracking-wider">
          {currentOption.code}
        </span>
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label={t("language.switchAriaLabel")}
          className="absolute top-full end-0 mt-2 z-50 w-64 max-h-80 overflow-y-auto bg-card/95 border border-border/80 rounded-2xl shadow-2xl backdrop-blur-xl p-1.5 focus:outline-none"
        >
          {SUPPORTED_LANGUAGES.map((opt) => {
            const isSelected = activeLang === opt.code;
            return (
              <button
                key={opt.code}
                type="button"
                role="option"
                data-language-option={opt.code}
                aria-selected={isSelected}
                onClick={() => void handleSelect(opt.code)}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium cursor-pointer transition-colors mb-0.5 last:mb-0",
                  isSelected
                    ? "bg-primary text-primary-foreground font-bold shadow-xs"
                    : "text-foreground hover:bg-muted/70"
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isSelected ? (
                    <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <span className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <span dir={opt.dir} className="truncate">
                    {opt.label}
                  </span>
                </div>
                <span
                  className={cn(
                    "text-[10px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0",
                    isSelected
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {opt.code}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
