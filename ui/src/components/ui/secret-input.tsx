import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface SecretInputProps
  extends Omit<React.ComponentProps<"input">, "type"> {
  revealed: boolean;
  onToggleReveal: () => void;
  revealLabel?: string;
  hideLabel?: string;
  buttonSize?: "default" | "lg";
  centered?: boolean;
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
      codeStyleWhenFilled = false,
      filledTrackingClass,
      value,
      disabled,
      style,
      ...props
    },
    ref
  ) => {
    const hasValue =
      value !== undefined && value !== null && String(value).length > 0;
    const isLarge = buttonSize === "lg";
    const toggleLabel = revealed ? hideLabel : revealLabel;

    return (
      <div className="relative flex w-full items-center">
        <Input
          ref={ref}
          type={revealed ? "text" : "password"}
          value={value}
          disabled={disabled}
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
                ? "px-14 text-center"
                : "px-12 text-center"
              : isLarge
                ? "rtl:pl-14 rtl:pr-4 ltr:pr-14 ltr:pl-4"
                : "rtl:pl-12 rtl:pr-4 ltr:pr-12 ltr:pl-4",
            codeStyleWhenFilled && hasValue ? "font-mono" : "font-sans",
            hasValue && filledTrackingClass
              ? filledTrackingClass
              : "tracking-normal",
            className
          )}
          {...props}
        />
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
