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
import { getDestructiveDialogArrowTarget } from "@/keyboard";

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
 * Uses Kinana's standard neutral outer dialog border (`border-border/80`) while reserving
 * destructive red styling for the trash badge and confirm action button.
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
  const deleteButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const cancelButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const confirmLockedRef = React.useRef(false);
  const [localSubmitting, setLocalSubmitting] = React.useState(false);

  const effectiveSubmitting = isSubmitting || localSubmitting;

  React.useEffect(() => {
    if (!open) {
      confirmLockedRef.current = false;
      setLocalSubmitting(false);
    }
  }, [open]);

  const handleConfirm = React.useCallback(async () => {
    if (effectiveSubmitting || confirmLockedRef.current) return;
    confirmLockedRef.current = true;
    setLocalSubmitting(true);
    try {
      await onConfirm();
    } finally {
      confirmLockedRef.current = false;
      setLocalSubmitting(false);
    }
  }, [effectiveSubmitting, onConfirm]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && (effectiveSubmitting || confirmLockedRef.current)) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        dir="rtl"
        onOpenAutoFocus={(e) => {
          previousFocusRef.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
          e.preventDefault();
          cancelButtonRef.current?.focus();
        }}
        onCloseAutoFocus={(e) => {
          const previousTarget = previousFocusRef.current;
          previousFocusRef.current = null;
          // Controlled Radix Dialog without <DialogTrigger> has context.triggerRef = null and
          // suppresses FocusScope's built-in restore, so restore explicitly to the trigger (or open parent dialog).
          e.preventDefault();
          if (
            previousTarget &&
            previousTarget.isConnected &&
            previousTarget !== document.body &&
            previousTarget !== document.documentElement
          ) {
            previousTarget.focus();
            return;
          }
          const underlyingDialog = document.querySelector<HTMLElement>(
            '[role="dialog"][data-state="open"]'
          );
          if (underlyingDialog) {
            const fallbackTarget = underlyingDialog.querySelector<HTMLElement>(
              'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            );
            (fallbackTarget ?? underlyingDialog).focus();
          }
        }}
        onKeyDown={(e) => {
          if (effectiveSubmitting || confirmLockedRef.current) return;
          const arrowTarget = getDestructiveDialogArrowTarget(e, e.target);
          if (!arrowTarget) return;
          const targetButton =
            arrowTarget === "delete"
              ? deleteButtonRef.current
              : cancelButtonRef.current;
          if (!targetButton || targetButton.disabled) return;
          e.preventDefault();
          targetButton.focus();
        }}
        onEscapeKeyDown={(e) => {
          if (effectiveSubmitting || confirmLockedRef.current) {
            e.preventDefault();
            return;
          }
          onCancel();
        }}
        onPointerDownOutside={(e) => {
          if (effectiveSubmitting || confirmLockedRef.current) {
            e.preventDefault();
          }
        }}
        className="w-[calc(100vw-2rem)] max-w-md p-6 sm:p-7 rounded-3xl bg-card border-2 border-border/80 shadow-2xl text-start gap-5"
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
            ref={deleteButtonRef}
            type="button"
            variant="destructive"
            disabled={effectiveSubmitting}
            onClick={handleConfirm}
            className="flex-1 min-h-11 px-4 rounded-xl text-sm font-bold gap-2 shadow-md ring-offset-card focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:ring-offset-1"
          >
            <Trash2 className="w-4 h-4 shrink-0" />
            <span className="truncate">{confirmLabel}</span>
          </Button>
          <Button
            ref={cancelButtonRef}
            type="button"
            variant="outline"
            disabled={effectiveSubmitting}
            onClick={() => {
              if (!effectiveSubmitting && !confirmLockedRef.current) {
                onCancel();
              }
            }}
            className="flex-1 min-h-11 px-4 rounded-xl text-sm font-bold border-border/80 ring-offset-card focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:ring-offset-1"
          >
            <span>{cancelLabel}</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
