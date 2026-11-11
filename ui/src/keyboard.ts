export interface KeyboardShortcutContext {
  unlocked: boolean;
  selectionMode: boolean;
  selectedCount: number;
  hasOpenDialog: boolean;
  target: EventTarget | null;
}

export interface KeyboardEventLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  defaultPrevented?: boolean;
  target?: EventTarget | null;
  currentTarget?: EventTarget | null;
}

interface ElementLike {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
  closest?: (selector: string) => unknown;
}

export function isEditableTarget(target: EventTarget | null | undefined): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as ElementLike;
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (el.isContentEditable) {
    return true;
  }
  if (typeof el.getAttribute === "function") {
    const role = el.getAttribute("role");
    const contentEditable = el.getAttribute("contenteditable");
    if (role === "textbox" || (contentEditable !== null && contentEditable !== "false")) {
      return true;
    }
  }
  if (typeof el.closest === "function") {
    if (el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]')) {
      return true;
    }
  }
  return false;
}

function isKeyA(e: KeyboardEventLike): boolean {
  return e.code === "KeyA" || e.key.toLowerCase() === "a";
}

export function shouldHandleSelectAllShortcut(
  e: KeyboardEventLike,
  ctx: KeyboardShortcutContext
): boolean {
  if (!ctx.unlocked || !ctx.selectionMode || ctx.hasOpenDialog) return false;
  if (e.defaultPrevented || e.altKey || e.shiftKey) return false;
  if (!(e.ctrlKey || e.metaKey)) return false;
  if (isEditableTarget(ctx.target)) return false;
  return isKeyA(e);
}

export function shouldHandleDeleteSelectionShortcut(
  e: KeyboardEventLike,
  ctx: KeyboardShortcutContext
): boolean {
  if (!ctx.unlocked || !ctx.selectionMode || ctx.selectedCount <= 0 || ctx.hasOpenDialog) {
    return false;
  }
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (isEditableTarget(ctx.target)) return false;
  return e.key === "Delete";
}

export function shouldHandleSelectionEscape(
  e: KeyboardEventLike,
  ctx: KeyboardShortcutContext
): boolean {
  if (!ctx.unlocked || !ctx.selectionMode || ctx.hasOpenDialog) return false;
  if (e.defaultPrevented) return false;
  return e.key === "Escape";
}

export function getZoomActionFromKeyboardEvent(
  e: KeyboardEventLike
): "in" | "out" | "reset" | null {
  if (e.defaultPrevented || e.altKey) return null;
  if (!(e.ctrlKey || e.metaKey)) return null;
  if (e.key === "=" || e.key === "+" || e.code === "Equal" || e.code === "NumpadAdd") {
    return "in";
  }
  if (e.key === "-" || e.code === "Minus" || e.code === "NumpadSubtract") {
    return "out";
  }
  if (e.key === "0" || e.code === "Digit0" || e.code === "Numpad0") {
    return "reset";
  }
  return null;
}

export function shouldActivateServiceCard(e: KeyboardEventLike): boolean {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key !== "Enter" && e.key !== " ") return false;
  if (e.target && e.currentTarget && e.target !== e.currentTarget) return false;
  return true;
}

export type DestructiveDialogArrowTarget = "delete" | "cancel";

/**
 * Resolves visual arrow navigation inside the RTL destructive confirmation dialog
 * (Delete on the right, Cancel on the left), strictly ignoring modified or editable events.
 */
export function getDestructiveDialogArrowTarget(
  e: KeyboardEventLike,
  target?: EventTarget | null
): DestructiveDialogArrowTarget | null {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) {
    return null;
  }
  if (isEditableTarget(target ?? e.target)) {
    return null;
  }
  if (e.key === "ArrowRight") {
    return "delete";
  }
  if (e.key === "ArrowLeft") {
    return "cancel";
  }
  return null;
}

/**
 * Returns true when a Ctrl+A / Cmd+A event targets non-editable application UI
 * (such as open dialogs or main service containers) where browser native Select All
 * would otherwise highlight unrelated UI text. Editable controls always remain exempt.
 */
export function shouldPreventNativeSelectAll(
  e: KeyboardEventLike,
  target?: EventTarget | null
): boolean {
  if (e.defaultPrevented || e.altKey || e.shiftKey) return false;
  if (!(e.ctrlKey || e.metaKey)) return false;
  if (isEditableTarget(target ?? e.target)) return false;
  return isKeyA(e);
}

/**
 * Clears any existing non-editable document text selection (e.g. before entering selection mode
 * or opening dialogs), strictly preserving active text selections inside editable fields.
 */
export function clearNonEditableDocumentSelection(doc?: Document | null): boolean {
  const d = doc ?? (typeof document !== "undefined" ? document : null);
  if (!d) return false;
  if (isEditableTarget(d.activeElement)) return false;
  const sel = d.defaultView?.getSelection?.() ?? (typeof window !== "undefined" ? window.getSelection?.() : null);
  if (!sel || sel.rangeCount === 0) return false;
  const resolveElement = (node: Node | null | undefined): EventTarget | null =>
    node ? (node.nodeType === 1 ? node : node.parentElement) : null;
  if (
    isEditableTarget(resolveElement(sel.anchorNode)) ||
    isEditableTarget(resolveElement(sel.focusNode))
  ) {
    return false;
  }
  sel.removeAllRanges();
  return true;
}
