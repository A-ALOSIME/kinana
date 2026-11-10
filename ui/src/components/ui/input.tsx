import * as React from "react";

import { cn } from "@/lib/utils";
import { PlaceholderOverlay } from "@/components/ui/placeholder-overlay";
import {
  extractHorizontalPaddingClasses,
  extractTextSizeClasses,
} from "@/lib/input-classes";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  (
    {
      className,
      type,
      placeholder,
      value,
      defaultValue,
      disabled,
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

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (value === undefined) {
        setUncontrolledHasValue(e.target.value.length > 0);
      }
      onChange?.(e);
    };

    const useOverlay = Boolean(placeholder) && type !== "file" && type !== "date";
    const inputElement = (
      <input
        type={type}
        value={value}
        defaultValue={defaultValue}
        disabled={disabled}
        placeholder={useOverlay ? undefined : placeholder}
        aria-placeholder={
          useOverlay ? placeholder : props["aria-placeholder"]
        }
        onChange={handleChange}
        className={cn(
          "block min-h-10 w-full rounded-md border border-input bg-background px-4 py-1 text-sm text-start tracking-normal ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className,
          !/\bleading-/.test(className || "") && "leading-[2]"
        )}
        ref={ref}
        {...props}
      />
    );

    if (!useOverlay) {
      return inputElement;
    }

    const sizeClasses = extractTextSizeClasses(className);
    const paddingClasses = extractHorizontalPaddingClasses(className);
    const isCentered = Boolean(className && /\btext-center\b/.test(className));

    return (
      <div className="relative flex w-full items-center">
        {inputElement}
        {!hasValue && placeholder && (
          <PlaceholderOverlay
            placeholder={placeholder}
            sizeClasses={sizeClasses}
            paddingClasses={paddingClasses}
            centered={isCentered}
            disabled={disabled}
            strikeThrough={Boolean(className?.includes("line-through"))}
          />
        )}
      </div>
    );
  }
);
Input.displayName = "Input";

export { Input };
