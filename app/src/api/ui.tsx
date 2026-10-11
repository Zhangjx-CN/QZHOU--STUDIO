import React, { createContext, useCallback, useContext, useState } from "react";

// ---------- 状态徽章 ----------
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    enabled: { cls: "on", label: "● ENABLED" },
    disabled: { cls: "off", label: "○ DISABLED" },
    deleted: { cls: "dead", label: "✕ DELETED" },
    draft: { cls: "off", label: "◇ DRAFT" },
    installed: { cls: "on", label: "◇ INSTALLED" },
  };
  const m = map[status] ?? { cls: "off", label: status.toUpperCase() };
  return (
    <span className={`badge ${m.cls}`}>
      <span className="dot" /> {m.label}
    </span>
  );
}

export function CatBadge({ cat }: { cat: string }) {
  return <span className="badge cat">#{cat}</span>;
}

// ---------- Toast ----------
const ToastCtx = createContext<(msg: string, kind?: "ok" | "err") => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [item, setItem] = useState<{ msg: string; kind: string; key: number } | null>(null);
  const show = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const key = Date.now();
    setItem({ msg, kind, key });
    setTimeout(() => setItem((cur) => (cur && cur.key === key ? null : cur)), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {item && <div className="toast" role={item.kind === "err" ? "alert" : "status"} style={{ borderColor: item.kind === "err" ? "var(--color-danger)" : "var(--color-brand)" }}>{item.msg}</div>}
    </ToastCtx.Provider>
  );
}

// ---------- 模态 ----------
export function Modal({ title, onClose, children, width, className }: { title: string; onClose: () => void; children: React.ReactNode; width?: number; className?: string }) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className={`modal ${className ?? ""}`.trim()} style={width ? { width } : undefined} onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

// ---------- 空态 ----------
export function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
