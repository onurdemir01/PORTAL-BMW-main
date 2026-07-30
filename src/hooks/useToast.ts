import { useState, useCallback } from "react";

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  exiting?: boolean;
}

let idCounter = 0;

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t))
    );
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 280);
  }, []);

  const add = useCallback(
    (type: ToastType, message: string, duration = 3500) => {
      const id = `toast-${++idCounter}`;
      setToasts((prev) => [...prev, { id, type, message }]);
      setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss]
  );

  const toast = {
    success: (msg: string, dur?: number) => add("success", msg, dur),
    error:   (msg: string, dur?: number) => add("error",   msg, dur),
    info:    (msg: string, dur?: number) => add("info",    msg, dur),
    warning: (msg: string, dur?: number) => add("warning", msg, dur),
  };

  return { toasts, toast, dismiss };
}

// Singleton store for global toast access
type ToastFn = {
  success: (msg: string, dur?: number) => void;
  error:   (msg: string, dur?: number) => void;
  info:    (msg: string, dur?: number) => void;
  warning: (msg: string, dur?: number) => void;
};

let _globalToast: ToastFn | null = null;

export function setGlobalToast(fn: ToastFn) {
  _globalToast = fn;
}

export const toast: ToastFn = {
  success: (msg, dur) => _globalToast?.success(msg, dur),
  error:   (msg, dur) => _globalToast?.error(msg, dur),
  info:    (msg, dur) => _globalToast?.info(msg, dur),
  warning: (msg, dur) => _globalToast?.warning(msg, dur),
};
