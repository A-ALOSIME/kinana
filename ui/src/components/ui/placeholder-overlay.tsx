import * as React from "react";

import { cn } from "@/lib/utils";
export {
  extractHorizontalPaddingClasses,
  extractTextSizeClasses,
} from "@/lib/input-classes";

export interface PlaceholderOverlayProps {
  placeholder: string;
  sizeClasses?: string;
  paddingClasses?: string;
  centered?: boolean;
  disabled?: boolean;
  strikeThrough?: boolean;
}

export const PlaceholderOverlay: React.FC<PlaceholderOverlayProps> = ({
  placeholder,
  sizeClasses = "text-sm",
  paddingClasses = "px-4",
  centered = false,
  disabled = false,
  strikeThrough = false,
}) => {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none select-none absolute inset-0 flex items-center text-muted-foreground font-sans font-normal tracking-normal",
        sizeClasses,
        centered ? "justify-center text-center" : "justify-start text-start",
        paddingClasses,
        disabled && "opacity-50",
        strikeThrough && "line-through"
      )}
    >
      <span
        dir="auto"
        style={{ lineHeight: 2.15 }}
        className="block max-w-full truncate pt-0.5 pb-1.5"
      >
        {placeholder}
      </span>
    </span>
  );
};
