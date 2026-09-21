'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/* ------------------------------------------------------------------ toasts */
type ToastKind = 'ok' | 'err' | 'warn' | 'info';
interface Toast { id: number; kind: ToastKind; title: string; message?: string }
interface ToastCtx { push: (t: Omit<Toast, 'id'>) => void }

const ToastContext = createContext<ToastCtx>({ push: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), t.kind === 'err' ? 9000 : 5200);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'info' ? '' : t.kind}`}>
            <span style={{ fontSize: 15 }}>{t.kind === 'ok' ? '✅' : t.kind === 'err' ? '⚠️' : t.kind === 'warn' ? '🟡' : 'ℹ️'}</span>
            <div>
              <strong>{t.title}</strong>
              {t.message ? <div className="msg">{t.message}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/* --------------------------------------------------------------- primitives */
export function Card({ children, className = '', style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return <div className={`card ${className}`} style={style}>{children}</div>;
}

export function Button({
  children,
  variant = 'default',
  size,
  loading,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm';
  loading?: boolean;
}) {
  return (
    <button
      {...rest}
      className={`btn ${variant === 'default' ? '' : variant} ${size === 'sm' ? 'sm' : ''} ${className}`}
      disabled={rest.disabled || loading}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner({ size = 13 }: { size?: number }) {
  return (
    <svg className="spin" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      <span className="lbl">{label}</span>
    </label>
  );
}

export function Slider({
  label, value, onChange, min = 1, max = 10, ticks,
}: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; ticks?: string[] }) {
  const idx = Math.min((ticks?.length ?? 1) - 1, Math.max(0, Math.round(((value - min) / (max - min)) * ((ticks?.length ?? 1) - 1))));
  return (
    <div className="field" style={{ marginBottom: 12 }}>
      <label>
        {label} <span className="mono" style={{ color: 'var(--accent)' }}>{value}</span>
        {ticks?.length ? <span className="hint" style={{ marginLeft: 'auto' }}>{ticks[idx]}</span> : null}
      </label>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export function Pill({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'ok' | 'warn' | 'bad' | 'info' | 'violet' }) {
  return <span className={`pill ${tone === 'default' ? '' : tone}`}>{children}</span>;
}

export function Dot({ tone }: { tone: 'ok' | 'warn' | 'bad' | 'idle' }) {
  return <span className={`dot ${tone === 'idle' ? '' : tone}`} />;
}

export function Avatar({ name, color, size = 42 }: { name: string; color?: string; size?: number }) {
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(140deg, ${color ?? '#25d366'}, ${shade(color ?? '#25d366', -28)})`,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        fontWeight: 700,
        color: '#04140d',
        flex: 'none',
      }}
    >
      {initials(name)}
    </div>
  );
}

export function Empty({ icon, title, hint, action }: { icon: string; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <strong style={{ color: 'var(--text)' }}>{title}</strong>
      {hint ? <span className="small" style={{ maxWidth: 420 }}>{hint}</span> : null}
      {action}
    </div>
  );
}

export function Health({ value }: { value: number }) {
  const tone = value >= 70 ? 'var(--accent)' : value >= 40 ? 'var(--warn)' : 'var(--danger)';
  return (
    <div className="bar" style={{ marginTop: 4 }}>
      <span style={{ width: `${Math.min(100, value)}%`, background: tone }} />
    </div>
  );
}

/* -------------------------------------------------------------- utilities */
export function initials(name: string): string {
  const parts = (name || '?').trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export function shade(hex: string, amt: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp((num >> 16) + amt);
  const g = clamp(((num >> 8) & 0x00ff) + amt);
  const b = clamp((num & 0x0000ff) + amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function timeAgo(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 45) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function clockTime(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function dayLabel(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yesterday())) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function yesterday() { return new Date(Date.now() - 86400000); }

export function useAutoRefresh(fn: () => void | Promise<void>, ms: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => void fn(), ms);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, enabled]);
}

export function numberFmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}
