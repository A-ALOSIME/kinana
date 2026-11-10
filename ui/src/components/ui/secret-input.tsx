import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PlaceholderOverlay } from "@/components/ui/placeholder-overlay";
import { extractTextSizeClasses } from "@/lib/input-classes";

export interface SecretInputProps
  extends Omit<React.ComponentProps<"input">, "type"> {
  revealed: boolean;
  onToggleReveal: () => void;
  revealLabel?: string;
  hideLabel?: string;
  buttonSize?: "default" | "lg";
  centered?: boolean;
  /**
   * Controls placeholder horizontal alignment independently of `centered`
   * so long Arabic guidance placeholders can align to start while short
   * numeric values center cleanly once entered.
   */
  centeredPlaceholder?: boolean;
  /**
   * Apply monospace font and LTR text flow strictly when input has a value,
   * preserving natural Arabic shaping and RTL alignment for Arabic placeholders.
   */
  codeStyleWhenFilled?: boolean;
  /**
   * Extra tracking utility applied only when a value is entered (never on empty Arabic placeholders).
   */
  filledTrackingClass?: string;
  /**
   * Renders safe masked bullet glyphs when a secret already exists in the vault during Edit
   * without preloading or exposing the stored plaintext secret in input state.
   */
  storedSecretMask?: boolean;
  /**
   * Transient read-only/preview stored value fetched strictly on demand via explicit reveal.
   * Never submitted directly as a replacement value until the user types new characters.
   */
  revealedStoredValue?: string | null;
}

const STORED_SECRET_BULLETS = "••••••••••••";

const SecretInput = React.forwardRef<HTMLInputElement, SecretInputProps>(
  (
    {
      className,
      revealed,
      onToggleReveal,
      revealLabel = "إظهار القيمة",
      hideLabel = "إخفاء القيمة",
      buttonSize = "default",
      centered = false,
      centeredPlaceholder,
      codeStyleWhenFilled = false,
      filledTrackingClass,
      storedSecretMask = false,
      revealedStoredValue = null,
      autoComplete = "new-password",
      value,
      defaultValue,
      placeholder,
      disabled,
      required,
      style,
      onChange,
      ...props
    },
    ref
  ) => {
    const [uncontrolledHasValue, setUncontrolledHasValue] = React.useState(
      () =>
        defaultValue !== undefined &&
        defaultValue !== null &&
        String(defaultValue).length > 0
    );

    const typedHasValue =
      value !== undefined
        ? value !== null && String(value).length > 0
        : uncontrolledHasValue;

    const showingRevealedStored =
      !typedHasValue &&
      revealed &&
      revealedStoredValue !== null &&
      revealedStoredValue !== undefined;

    const effectiveValue =
      showingRevealedStored ? revealedStoredValue : value;

    const hasValue = typedHasValue || showingRevealedStored;
    const showStoredDotsOverlay = storedSecretMask && !hasValue;

    const isLarge = buttonSize === "lg";
    const toggleLabel = revealed ? hideLabel : revealLabel;
    const alignCenteredPlaceholder = centeredPlaceholder ?? centered;
    const sizeClasses = extractTextSizeClasses(className);
    const hasStrikeThrough = Boolean(className?.includes("line-through"));
    const paddingClasses = alignCenteredPlaceholder
      ? isLarge
        ? "px-16"
        : "px-14"
      : isLarge
        ? "rtl:pr-4 rtl:pl-16 ltr:pl-4 ltr:pr-16"
        : "rtl:pr-4 rtl:pl-14 ltr:pl-4 ltr:pr-14";

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (showingRevealedStored) {
        // User started replacing the revealed stored secret; avoid editing the fetched string directly
        // unless backspace/typing changes it, or let controlled caller clear revealed state and capture input.
      }
      if (value === undefined) {
        setUncontrolledHasValue(e.target.value.length > 0);
      }
      onChange?.(e);
    };

    return (
      <div className="relative flex w-full items-center">
        <Input
          ref={ref}
          type={revealed ? "text" : "password"}
          autoComplete={autoComplete}
          value={effectiveValue}
          defaultValue={defaultValue}
          disabled={disabled}
          required={required}
          aria-required={required ? "true" : props["aria-required"]}
          aria-placeholder={placeholder}
          onChange={handleChange}
          style={{
            ...(codeStyleWhenFilled && hasValue
              ? {
                  direction: "ltr" as const,
                  textAlign: centered ? ("center" as const) : ("right" as const),
                }
              : {}),
            ...style,
          }}
          className={cn(
            isLarge ? "min-h-16" : "min-h-12",
            centered
              ? isLarge
                ? "px-16 text-center"
                : "px-14 text-center"
              : isLarge
                ? "rtl:pl-16 rtl:pr-4 ltr:pr-16 ltr:pl-4"
                : "rtl:pl-14 rtl:pr-4 ltr:pr-14 ltr:pl-4",
            codeStyleWhenFilled && hasValue ? "font-mono" : "font-sans",
            hasValue && filledTrackingClass
              ? filledTrackingClass
              : "tracking-normal",
            className
          )}
          {...props}
        />

        {showStoredDotsOverlay ? (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none select-none absolute inset-0 flex items-center text-foreground/70 font-sans font-normal text-lg tracking-[0.2em]",
              alignCenteredPlaceholder ? "justify-center text-center" : "justify-start text-start",
              paddingClasses,
              disabled && "opacity-50",
              hasStrikeThrough && "line-through"
            )}
          >
            {STORED_SECRET_BULLETS}
          </span>
        ) : (
          !hasValue &&
          placeholder && (
            <PlaceholderOverlay
              placeholder={placeholder}
              sizeClasses={sizeClasses}
              paddingClasses={paddingClasses}
              centered={alignCenteredPlaceholder}
              disabled={disabled}
              strikeThrough={hasStrikeThrough}
            />
          )
        )}

        <Button
          type="button"
          variant="ghost"
          size={isLarge ? "icon" : "sm"}
          disabled={disabled}
          onClick={onToggleReveal}
          aria-label={toggleLabel}
          aria-pressed={revealed}
          title={toggleLabel}
          className={cn(
            "absolute top-1/2 -translate-y-1/2 p-0 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-lg",
            isLarge
              ? "h-10 w-10 rtl:left-3 ltr:right-3"
              : "h-8 w-8 rtl:left-2.5 ltr:right-2.5"
          )}
        >
          {revealed ? (
            <EyeOff className={isLarge ? "w-5 h-5" : "w-4 h-4"} />
          ) : (
            <Eye className={isLarge ? "w-5 h-5" : "w-4 h-4"} />
          )}
        </Button>
      </div>
    );
  }
);
SecretInput.displayName = "SecretInput";

export { SecretInput };
