import * as React from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

export interface FormLabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
  centered?: boolean;
  inline?: boolean;
}

const FormLabel = React.forwardRef<HTMLLabelElement, FormLabelProps>(
  (
    {
      className,
      children,
      required = false,
      centered = false,
      inline = false,
      ...props
    },
    ref
  ) => {
    const { t } = useTranslation();
    return (
      <label
        ref={ref}
        className={cn(
          "text-base font-bold text-foreground leading-snug tracking-normal",
          inline
            ? "inline-flex items-center gap-1.5 text-start"
            : centered
              ? "flex items-center justify-center gap-1.5 text-center mb-2"
              : "flex items-center gap-1.5 text-start mb-1.5",
          className
        )}
        {...props}
      >
        <span>{children}</span>
        {required && (
          <>
            <span
              aria-hidden="true"
              className="text-red-400 font-bold text-sm leading-none select-none shrink-0"
            >
              *
            </span>
            <span className="sr-only"> {t("formLabel.requiredSr")}</span>
          </>
        )}
      </label>
    );
  }
);
FormLabel.displayName = "FormLabel";

export { FormLabel };
