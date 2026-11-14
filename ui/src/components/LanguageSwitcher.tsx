import * as React from "react";
import { Check, ChevronDown, Languages, Search } from "lucide-react";
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

const ENGLISH_LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  ar: "Arabic",
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  "pt-BR": "Portuguese (Brazil)",
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  ja: "Japanese",
  ko: "Korean",
  ru: "Russian",
  fa: "Persian Farsi",
  tr: "Turkish",
  it: "Italian",
  id: "Indonesian",
  hi: "Hindi",
  vi: "Vietnamese",
  pl: "Polish",
  uk: "Ukrainian",
  ur: "Urdu",
  th: "Thai",
  he: "Hebrew",
};

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({
  variant = "minimal",
  className,
  onLanguageChanged,
}) => {
  const { t, i18n } = useTranslation();
  const activeLang = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language);

  const [isOpen, setIsOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [highlightedIndex, setHighlightedIndex] = React.useState(0);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const listboxRef = React.useRef<HTMLDivElement>(null);

  const currentOption =
    SUPPORTED_LANGUAGES.find((opt) => opt.code === activeLang) ?? SUPPORTED_LANGUAGES[0];

  const filteredLanguages = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return SUPPORTED_LANGUAGES;
    return SUPPORTED_LANGUAGES.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        opt.code.toLowerCase().includes(q) ||
        (ENGLISH_LANGUAGE_NAMES[opt.code]?.toLowerCase().includes(q) ?? false)
    );
  }, [searchQuery]);

  React.useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      const currentIndex = SUPPORTED_LANGUAGES.findIndex((l) => l.code === activeLang);
      setHighlightedIndex(currentIndex >= 0 ? currentIndex : 0);
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [isOpen, activeLang]);

  React.useEffect(() => {
    setHighlightedIndex(0);
  }, [searchQuery]);

  React.useEffect(() => {
    if (isOpen && listboxRef.current) {
      const activeEl = listboxRef.current.querySelector<HTMLElement>('[data-highlighted="true"]');
      activeEl?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex, isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [isOpen]);

  const handleSelect = async (lang: SupportedLanguage) => {
    setIsOpen(false);
    setSearchQuery("");
    triggerRef.current?.focus();
    if (lang === activeLang) return;
    await changeAppLanguage(lang);
    onLanguageChanged?.(lang);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filteredLanguages.length > 0) {
        setHighlightedIndex((prev) => (prev + 1) % filteredLanguages.length);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filteredLanguages.length > 0) {
        setHighlightedIndex(
          (prev) => (prev - 1 + filteredLanguages.length) % filteredLanguages.length
        );
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredLanguages[highlightedIndex]) {
        void handleSelect(filteredLanguages[highlightedIndex].code);
      }
    } else if (e.key === "Tab") {
      setIsOpen(false);
    }
  };

  const renderDropdownList = (alignmentClass: string) => (
    <div
      className={cn(
        "absolute mt-2 z-50 w-72 max-h-84 bg-card/95 border border-border/80 rounded-2xl shadow-2xl backdrop-blur-xl p-2 flex flex-col focus:outline-none animate-in fade-in-0 zoom-in-95 duration-100",
        alignmentClass
      )}
    >
      {/* Search Input */}
      <div className="relative mb-2 shrink-0">
        <Search
          className="w-4 h-4 text-muted-foreground absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
          aria-hidden="true"
        />
        <input
          ref={searchInputRef}
          type="text"
          data-language-search="input"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("language.label")}
          className="w-full bg-muted/60 border border-border/60 rounded-xl ps-8 pe-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Language Options List */}
      <div
        ref={listboxRef}
        role="listbox"
        aria-label={t("language.switchAriaLabel")}
        className="overflow-y-auto max-h-56 space-y-0.5 pe-0.5"
      >
        {filteredLanguages.length === 0 ? (
          <div className="py-4 text-center text-xs text-muted-foreground">
            {t("services.noSearchResultsTitle")}
          </div>
        ) : (
          filteredLanguages.map((opt, idx) => {
            const isSelected = activeLang === opt.code;
            const isHighlighted = idx === highlightedIndex;
            return (
              <button
                key={opt.code}
                type="button"
                role="option"
                data-language-option={opt.code}
                data-highlighted={isHighlighted}
                aria-selected={isSelected}
                onClick={() => void handleSelect(opt.code)}
                onMouseEnter={() => setHighlightedIndex(idx)}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs cursor-pointer transition-colors text-start",
                  isSelected
                    ? "bg-primary text-primary-foreground font-bold shadow-xs"
                    : isHighlighted
                    ? "bg-muted text-foreground"
                    : "text-foreground hover:bg-muted/60"
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
          })
        )}
      </div>
    </div>
  );

  if (variant === "settings") {
    return (
      <div
        className={cn(
          "p-6 rounded-2xl bg-muted/40 border border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4",
          className
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Languages className="w-6 h-6 text-primary shrink-0" aria-hidden="true" />
          <div className="min-w-0 text-start">
            <h4 className="text-lg font-bold text-foreground">
              {t("language.sectionTitle")}
            </h4>
            <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
              {t("language.sectionDescription")}
            </p>
          </div>
        </div>

        <div ref={containerRef} className="relative inline-block shrink-0 self-start sm:self-auto">
          <button
            ref={triggerRef}
            type="button"
            data-language-switcher="trigger"
            data-language-settings="trigger"
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-label={t("language.switchAriaLabel")}
            onClick={() => setIsOpen((prev) => !prev)}
            onKeyDown={handleKeyDown}
            className="h-11 px-4 rounded-xl border border-border/70 bg-card/90 hover:bg-muted/70 text-foreground text-sm font-semibold flex items-center justify-between gap-3 min-w-[200px] sm:min-w-[240px] shadow-xs cursor-pointer transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Languages className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
              <span dir={currentOption.dir} className="truncate font-medium">
                {currentOption.label}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wider font-bold">
                {currentOption.code}
              </span>
              <ChevronDown
                className={cn(
                  "w-4 h-4 text-muted-foreground transition-transform duration-200",
                  isOpen && "rotate-180"
                )}
                aria-hidden="true"
              />
            </div>
          </button>

          {isOpen && renderDropdownList("top-full end-0 rtl:start-0 rtl:end-auto")}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn("relative inline-block", className)}>
      <button
        ref={triggerRef}
        type="button"
        data-language-switcher="trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={t("language.switchAriaLabel")}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        className="inline-flex items-center gap-2 bg-card/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-border/70 shadow-sm text-xs font-semibold text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
      >
        <Languages className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
        <span dir={currentOption.dir} className="truncate max-w-[110px]">
          {currentOption.label}
        </span>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted/70 text-muted-foreground uppercase tracking-wider font-bold">
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

      {isOpen && renderDropdownList("top-full left-0")}
    </div>
  );
};
