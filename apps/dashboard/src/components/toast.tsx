'use client';

import { useEffect, useState } from 'react';

export type ToastVariant = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

type Listener = (toasts: Toast[]) => void;

// Minimal global toast store so toast() can be called from anywhere (no lib).
const store: { toasts: Toast[]; listeners: Set<Listener> } = {
  toasts: [],
  listeners: new Set(),
};

function emit() {
  for (const l of store.listeners) l(store.toasts);
}

function dismiss(id: string) {
  store.toasts = store.toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(input: { title: string; description?: string; variant?: ToastVariant }) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const t: Toast = { id, title: input.title, description: input.description, variant: input.variant ?? 'info' };
  store.toasts = [...store.toasts, t];
  emit();
  // Auto-dismiss after a while; errors linger a bit longer.
  setTimeout(() => dismiss(id), t.variant === 'error' ? 8000 : 5000);
}

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: 'border-green-300 bg-green-50 text-green-800 dark:border-green-900/60 dark:bg-green-950/40 dark:text-green-300',
  error: 'border-red-300 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300',
  info: 'border-[var(--border)] bg-[var(--background)] text-[var(--foreground)]',
};

/** Fixed-corner container that renders the active toasts. Mount once globally. */
export function ToastViewport() {
  const [toasts, setToasts] = useState<Toast[]>(store.toasts);

  useEffect(() => {
    const listener: Listener = (next) => setToasts([...next]);
    store.listeners.add(listener);
    setToasts([...store.toasts]);
    return () => {
      store.listeners.delete(listener);
    };
  }, []);

  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto flex items-start justify-between gap-3 rounded-lg border p-3 shadow-lg ${VARIANT_STYLES[t.variant]}`}
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{t.title}</p>
            {t.description ? <p className="mt-0.5 text-xs opacity-90">{t.description}</p> : null}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
            className="shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
