import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

function extractTextSizeClasses(className?: string): string {
  if (!className) return "text-sm";
  const matches = className.match(
    /\b(?:[a-z]+:)?text-(?:xs|sm|base|lg|xl|2xl|3xl)\b/g
  );
  return matches && matches.length > 0 ? matches.join(" ") : "text-sm";
}

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
}

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

    const hasValue =
      value !== undefined
        ? value !== null && String(value).length > 0
        : uncontrolledHasValue;

    const isLarge = buttonSize === "lg";
    const toggleLabel = revealed ? hideLabel : revealLabel;
    const alignCenteredPlaceholder = centeredPlaceholder ?? centered;
    const sizeClasses = extractTextSizeClasses(className);
    const hasStrikeThrough = Boolean(className?.includes("line-through"));

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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
          value={value}
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
            isLarge ? "h-16" : "h-12",
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

        {!hasValue && placeholder && (
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none select-none absolute inset-y-0 flex items-center text-muted-foreground font-sans font-normal tracking-normal overflow-hidden",
              sizeClasses,
              "leading-[1.7]",
              disabled && "opacity-50",
              hasStrikeThrough && "line-through",
              alignCenteredPlaceholder
                ? isLarge
                  ? "inset-x-16 justify-center text-center"
                  : "inset-x-14 justify-center text-center"
                : isLarge
                  ? "rtl:right-4 rtl:left-16 ltr:left-4 ltr:right-16 justify-start text-start"
                  : "rtl:right-4 rtl:left-14 ltr:left-4 ltr:right-14 justify-start text-start"
            )}
          >
            <span
              dir="auto"
              style={{ lineHeight: 1.7 }}
              className="block max-w-full truncate py-1"
            >
              {placeholder}
            </span>
          </span>
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
