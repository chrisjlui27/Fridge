import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

type Toast = {
  id: number;
  message: string;
  tone: "info" | "error" | "success";
  action?: { label: string; onClick: () => void };
};

type ToastApi = {
  show: (message: string, opts?: { tone?: Toast["tone"]; action?: Toast["action"]; ms?: number }) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const t = useContext(ToastContext);
  if (!t) throw new Error("useToast outside ToastProvider");
  return t;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const show = useCallback<ToastApi["show"]>(
    (message, opts = {}) => {
      const id = nextId.current++;
      setToasts((ts) => [...ts.slice(-2), { id, message, tone: opts.tone ?? "info", action: opts.action }]);
      window.setTimeout(() => dismiss(id), opts.ms ?? (opts.action ? 8000 : 4000));
    },
    [dismiss],
  );
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <span>{t.message}</span>
            {t.action && (
              <button
                className="btn small ghost"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
