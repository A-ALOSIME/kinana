import { useCallback, useEffect, useRef, useState } from "react";
import {
  TimedNotificationController,
  type NotificationKind,
  type ShowNotificationOptions,
} from "./notifications";

/**
 * React hook wrapping `TimedNotificationController` with automatic timer cleanup on unmount
 * and stable `show` / `dismiss` callbacks.
 */
export function useTimedNotification<T extends { type: NotificationKind }>() {
  const controllerRef = useRef<TimedNotificationController<T> | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new TimedNotificationController<T>();
  }

  const [value, setValue] = useState<(T & { id: number }) | null>(null);

  useEffect(() => {
    const controller = controllerRef.current!;
    setValue(controller.snapshot);
    const unsubscribe = controller.subscribe(setValue);
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, []);

  const show = useCallback((payload: T, options?: ShowNotificationOptions) => {
    return controllerRef.current!.show(payload, options);
  }, []);

  const dismiss = useCallback((expectedId?: number) => {
    return controllerRef.current!.dismiss(expectedId);
  }, []);

  return { value, show, dismiss };
}
