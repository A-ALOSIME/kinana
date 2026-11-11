export type NotificationKind = "success" | "warning" | "error";

export const NOTIFICATION_DURATIONS_MS: Record<NotificationKind, number> = {
  success: 4000,
  warning: 6000,
  error: 8000,
};

export interface NotificationTimerApi {
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
}

export interface ShowNotificationOptions {
  /** Override timeout in ms, or `null` to keep an actionable error visible until dismissed manually. */
  durationMs?: number | null;
}

/**
 * Reusable notification lifecycle controller supporting auto-dismiss timers,
 * manual dismissal, timer reset on replacement, and token checks preventing stale timers
 * from closing newer notifications.
 */
export class TimedNotificationController<T extends { type: NotificationKind }> {
  private current: (T & { id: number }) | null = null;
  private nextId = 0;
  private timerId: ReturnType<typeof globalThis.setTimeout> | null = null;
  private readonly listeners = new Set<(val: (T & { id: number }) | null) => void>();
  private readonly timers: NotificationTimerApi;

  constructor(
    timers: NotificationTimerApi = {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    }
  ) {
    this.timers = timers;
  }

  get snapshot(): (T & { id: number }) | null {
    return this.current;
  }

  subscribe(listener: (val: (T & { id: number }) | null) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  clearActiveTimer(): void {
    if (this.timerId !== null) {
      this.timers.clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.current);
    }
  }

  show(payload: T, options?: ShowNotificationOptions): number {
    this.clearActiveTimer();
    const id = ++this.nextId;
    this.current = { ...payload, id };
    this.emit();

    const duration =
      options && "durationMs" in options
        ? options.durationMs
        : NOTIFICATION_DURATIONS_MS[payload.type];

    if (typeof duration === "number" && duration > 0) {
      this.timerId = this.timers.setTimeout(() => {
        this.dismiss(id);
      }, duration);
    }

    return id;
  }

  dismiss(expectedId?: number): boolean {
    if (expectedId !== undefined && this.current?.id !== expectedId) {
      return false;
    }
    this.clearActiveTimer();
    if (this.current === null) {
      return false;
    }
    this.current = null;
    this.emit();
    return true;
  }

  dispose(): void {
    this.clearActiveTimer();
    this.listeners.clear();
  }
}
