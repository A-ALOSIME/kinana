import * as React from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface DestructiveConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  isSubmitting?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Standardized dark-themed RTL destructive confirmation modal.
 * Visual action order is strictly consistent in RTL:
 *   Delete button on the right, Cancel button immediately beside it on the left.
 * Cancel receives safe initial focus so pressing Enter accidentally never triggers deletion.
 */
export const DestructiveConfirmDialog: React.FC<DestructiveConfirmDialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "إلغاء",
  isSubmitting = false,
  onConfirm,
  onCancel,
}) => {
  const cancelButtonRef = React.useRef<HTMLButtonElement | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isSubmitting) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        dir="rtl"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          cancelButtonRef.current?.focus();
        }}
        onEscapeKeyDown={(e) => {
          if (isSubmitting) {
            e.preventDefault();
            return;
          }
          onCancel();
        }}
        onPointerDownOutside={(e) => {
          if (isSubmitting) {
            e.preventDefault();
          }
        }}
        className="w-[calc(100vw-2rem)] max-w-md p-6 sm:p-7 rounded-3xl bg-card border-2 border-destructive/45 shadow-2xl text-start gap-5"
      >
        <DialogHeader className="text-start pe-8 space-y-2.5">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-destructive/15 border border-destructive/35 flex items-center justify-center text-destructive shrink-0 mt-0.5">
              <Trash2 className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <DialogTitle className="text-xl font-black font-thamaniah text-foreground leading-normal py-0.5">
                {title}
              </DialogTitle>
              <DialogDescription className="text-sm font-medium text-muted-foreground leading-relaxed [overflow-wrap:anywhere]">
                {description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Explicit RTL row: DOM child 1 (Delete) renders on the right; DOM child 2 (Cancel) renders immediately beside it on the left */}
        <div
          dir="rtl"
          className="flex flex-row items-center gap-3 pt-4 border-t border-border/60 w-full"
        >
          <Button
            type="button"
            variant="destructive"
            disabled={isSubmitting}
            onClick={() => {
              if (!isSubmitting) {
                onConfirm();
              }
            }}
            className="flex-1 min-h-11 px-4 rounded-xl text-sm font-bold gap-2 shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Trash2 className="w-4 h-4 shrink-0" />
            <span className="truncate">{confirmLabel}</span>
          </Button>
          <Button
            ref={cancelButtonRef}
            type="button"
            variant="outline"
            disabled={isSubmitting}
            onClick={onCancel}
            className="flex-1 min-h-11 px-4 rounded-xl text-sm font-bold border-border/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span>{cancelLabel}</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
