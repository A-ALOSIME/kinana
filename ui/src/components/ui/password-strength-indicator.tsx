import * as React from "react";

import { cn } from "@/lib/utils";
import {
  evaluatePasswordStrength,
  type PasswordStrengthLevel,
} from "@/passwordValidation";

export interface PasswordStrengthIndicatorProps {
  password: string;
  className?: string;
}

const SEGMENT_TONES: Record<Exclude<PasswordStrengthLevel, 0>, string> = {
  1: "bg-zinc-400/80",
  2: "bg-amber-400/75",
  3: "bg-emerald-500/75",
  4: "bg-emerald-400",
};

const LABEL_TONES: Record<Exclude<PasswordStrengthLevel, 0>, string> = {
  1: "text-zinc-300",
  2: "text-amber-300",
  3: "text-emerald-300",
  4: "text-emerald-300 font-bold",
};

export const PasswordStrengthIndicator: React.FC<PasswordStrengthIndicatorProps> = ({
  password,
  className,
}) => {
  const { level, label } = evaluatePasswordStrength(password);

  return (
    <div
      className={cn("space-y-1.5 pt-1", className)}
      data-strength-level={level}
      aria-live="polite"
    >
      <div className="grid grid-cols-4 gap-1.5" role="presentation">
        {[1, 2, 3, 4].map((segment) => {
          const isActive = level > 0 && segment <= level;
          const activeClass =
            level > 0 ? SEGMENT_TONES[level as Exclude<PasswordStrengthLevel, 0>] : "";
          return (
            <span
              key={segment}
              className={cn(
                "h-1.5 rounded-full transition-colors duration-200",
                isActive ? activeClass : "bg-muted"
              )}
            />
          );
        })}
      </div>

      <div className="flex items-center justify-between text-xs min-h-[1.25rem] leading-relaxed">
        <span className="text-muted-foreground">قوة كلمة المرور</span>
        <span
          className={cn(
            "font-medium transition-colors duration-200",
            level > 0
              ? LABEL_TONES[level as Exclude<PasswordStrengthLevel, 0>]
              : "text-muted-foreground/70"
          )}
        >
          {level > 0 ? label : "—"}
        </span>
      </div>
    </div>
  );
};
