'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, AiStatus } from '@/lib/client-api';
import { Dot, Spinner, useToast } from '@/components/ui';

/* ------------------------------------------------------------------ status */
interface StatusCtx {
  status: AiStatus | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setAutoSend: (value: boolean) => Promise<void>;
  whatsapp: { mode: string; liveReady: boolean; queue: { queued: number } } | null;
}
const Ctx = createContext<StatusCtx>({
  status: null,
  loading: true,
  refresh: async () => {},
  setAutoSend: async () => {},
  whatsapp: null,
});

export const useCopilot = () => useContext(Ctx);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [whatsapp, setWhatsapp] = useState<StatusCtx['whatsapp']>(null);
  const [loading, setLoading] = useState(true);
  const { push } = useToast();

  const refresh = useCallback(async () => {
    const [ai, wa] = await Promise.all([api.get<AiStatus>('/api/ai/status'), api.get<{ mode: string; liveReady: boolean; queue: { queued: number } }>('/api/whatsapp/status')]);
    if (ai.ok) setStatus(ai.data as AiStatus);
    if (wa.ok) setWhatsapp(wa.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30000);
    return () => clearInterval(t);
  }, [refresh]);

  const setAutoSend = useCallback(
    async (value: boolean) => {
      const res = await api.put<{ settings: { autoSend: boolean } }>('/api/ai/settings', { autoSend: value });
      if (!res.ok) {
        push({ kind: 'err', title: 'Could not switch mode', message: res.data.error });
        return;
      }
      push({
        kind: value ? 'warn' : 'ok',
        title: value ? 'Autopilot enabled' : 'Copilot mode',
        message: value
          ? 'Generated messages will be sent automatically to contacts. Switch back any time.'
          : 'Every reply waits for your approval before it goes out. Safe default.',
      });
      await refresh();
    },
    [push, refresh],
  );

  const autopilot = Boolean(status?.mode === 'autopilot');

  const nav = [
    { href: '/', label: 'Dashboard', icon: iconGrid },
    { href: '/chat', label: 'Chat', icon: iconChat },
    { href: '/memory', label: 'Memory', icon: iconBrain },
    { href: '/style', label: 'My style', icon: iconPalette },
    { href: '/settings', label: 'Settings', icon: iconCog },
  ];

  return (
    <Ctx.Provider value={{ status, loading, refresh, setAutoSend, whatsapp }}>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark">CC</div>
            <div className="brand-text">
              <strong>Conversation Copilot</strong>
              <span>private · local-first</span>
            </div>
          </div>

          {nav.map((n) => {
            const active = n.href === '/' ? pathname === '/' : pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={`nav-item ${active ? 'active' : ''}`}>
                {n.icon()}
                {n.label}
              </Link>
            );
          })}

          <div className="nav-spacer" />

          <div className="card tight" style={{ padding: 12 }}>
            <div className="row between" style={{ marginBottom: 8 }}>
              <span className="tiny" style={{ fontWeight: 700, letterSpacing: 0.6, color: 'var(--muted-2)' }}>
                WHATSAPP
              </span>
              <span className={`pill ${whatsapp?.mode === 'live' ? 'warn' : 'info'}`} style={{ padding: '2px 8px', fontSize: 10.5 }}>
                {whatsapp?.mode === 'live' ? 'LIVE' : 'SIMULATED'}
              </span>
            </div>
            <div className="tiny muted">
              {whatsapp?.mode === 'live'
                ? 'Sending through the WhatsApp Cloud API.'
                : 'Messages are recorded locally. Nothing leaves this machine.'}
            </div>
            {whatsapp?.queue && whatsapp.queue.queued > 0 ? (
              <div className="tiny mt-8" style={{ color: 'var(--warn)' }}>
                {whatsapp.queue.queued} message(s) queued
              </div>
            ) : null}
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <div>
              <h1>Conversation Copilot</h1>
              <div className="sub">
                {autopilot ? 'Autopilot — drafting and sending for you' : 'Copilot — you approve every message'}
              </div>
            </div>

            <div className="topbar-right">
              <ModeToggle autopilot={autopilot} busy={loading} onChange={setAutoSend} />
              <StatusPill status={status} loading={loading} />
            </div>
          </header>

          {children}
        </div>
      </div>
    </Ctx.Provider>
  );
}

function ModeToggle({ autopilot, busy, onChange }: { autopilot: boolean; busy: boolean; onChange: (v: boolean) => Promise<void> }) {
  const [pending, setPending] = useState(false);
  return (
    <div className="tabs" role="tablist" aria-label="Reply mode" title="Copilot suggests, Autopilot sends">
      <button
        className={`tab ${!autopilot ? 'active' : ''}`}
        disabled={pending || busy}
        onClick={async () => {
          if (autopilot) {
            setPending(true);
            await onChange(false);
            setPending(false);
          }
        }}
      >
        ✋ Copilot
      </button>
      <button
        className={`tab ${autopilot ? 'active' : ''}`}
        disabled={pending || busy}
        onClick={async () => {
          if (!autopilot) {
            setPending(true);
            await onChange(true);
            setPending(false);
          }
        }}
        style={autopilot ? { background: 'rgba(240,178,50,0.18)', color: '#ffe3ab' } : undefined}
      >
        {pending ? <Spinner /> : '⚡'} Autopilot
      </button>
    </div>
  );
}

function StatusPill({ status, loading }: { status: AiStatus | null; loading: boolean }) {
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [probe, setProbe] = useState<Record<string, unknown> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { push } = useToast();

  // close on outside click / Escape so the popover never traps the view
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const tone = status?.connected ? 'ok' : status?.status === 'disconnected' ? 'bad' : 'warn';
  const label = status?.connected
    ? `${status.activeProvider === 'ollama' ? 'Local AI' : status.activeProvider === 'openai' ? 'Remote AI' : 'Offline drafter'}`
    : 'AI offline';

  const runTest = async () => {
    setTesting(true);
    const res = await api.post<Record<string, unknown>>('/api/ai/status/test', {});
    setProbe(res.data);
    setTesting(false);
    const rt = (res.data as { roundTrip?: { success?: boolean; provider?: string; latencyMs?: number; error?: string } }).roundTrip;
    if (rt?.success) {
      push({ kind: 'ok', title: 'Connection OK', message: `${rt.provider} responded in ${rt.latencyMs}ms.` });
    } else {
      push({ kind: 'err', title: 'Connection failed', message: rt?.error ?? (res.data.error as string) ?? 'Unknown error' });
    }
  };

  return (
    <div style={{ position: 'relative' }} ref={wrapRef}>
      <button className={`pill ${tone}`} onClick={() => setOpen((o) => !o)} style={{ cursor: 'pointer' }} title="AI provider status">
        {loading ? <Spinner size={11} /> : <Dot tone={tone} />}
        {label}
        <span className="muted" style={{ fontWeight: 500 }}>{status?.model ?? ''}</span>
      </button>

      {open ? (
        <div className="card" style={{ position: 'absolute', right: 0, top: 40, width: 380, zIndex: 60, boxShadow: 'var(--shadow)' }}>
          <div className="row between mb-8">
            <strong style={{ fontSize: 14 }}>AI provider</strong>
            <button className="btn ghost sm" onClick={() => setOpen(false)}>✕</button>
          </div>

          <div className="row" style={{ gap: 8, marginBottom: 10 }}>
            <Dot tone={tone} />
            <span className="small" style={{ fontWeight: 600 }}>
              {status?.status?.toUpperCase() ?? 'UNKNOWN'}
            </span>
            <span className="pill" style={{ marginLeft: 'auto', fontSize: 11 }}>{status?.configuredProvider ?? '—'}</span>
          </div>

          <div className="small muted" style={{ lineHeight: 1.55 }}>{status?.message}</div>

          <div className="mt-14">
            <div className="row between tiny" style={{ marginBottom: 4 }}>
              <span className="muted">Model</span>
              <span className="mono">{status?.model}</span>
            </div>
            <div className="row between tiny" style={{ marginBottom: 4 }}>
              <span className="muted">Endpoint</span>
              <span className="mono">{status?.endpoint ?? 'local'}</span>
            </div>
            <div className="row between tiny">
              <span className="muted">Fallback</span>
              <span className="mono">{status?.fallbackEnabled ? 'enabled (offline drafter)' : 'disabled'}</span>
            </div>
          </div>

          {status?.fallback ? (
            <div className="mt-14 small" style={{ color: 'var(--warn)' }}>
              ⤷ Will fall back to: {status.fallback.provider} — {status.fallback.message}
            </div>
          ) : null}

          {probe ? (
            <div className="code-block mt-14" style={{ maxHeight: 190, overflow: 'auto' }}>
              {JSON.stringify(probe, null, 2)}
            </div>
          ) : null}

          <div className="row mt-14" style={{ gap: 8 }}>
            <button className="btn primary sm" onClick={runTest} disabled={testing}>
              {testing ? <Spinner /> : null} Test connection
            </button>
            <Link href="/settings" className="btn sm" onClick={() => setOpen(false)}>Configure</Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------- icons */
function iconGrid() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
      <rect x="3" y="3" width="7" height="7" rx="1.6" /><rect x="14" y="3" width="7" height="7" rx="1.6" />
      <rect x="3" y="14" width="7" height="7" rx="1.6" /><rect x="14" y="14" width="7" height="7" rx="1.6" />
    </svg>
  );
}
function iconChat() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
      <path d="M21 12a8 8 0 0 1-11.6 7.2L4 21l1.8-5.4A8 8 0 1 1 21 12z" />
    </svg>
  );
}
function iconBrain() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
      <path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8V15a3 3 0 0 0 4 2.8V20h4v-2.2A3 3 0 0 0 17 15v-2.2A3 3 0 0 0 16 7a3 3 0 0 0-3-3H9z" />
      <path d="M12 4v16" />
    </svg>
  );
}
function iconPalette() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
      <path d="M12 21a9 9 0 1 1 9-9c0 2.5-2 3-3.5 3H16a2 2 0 0 0-1.4 3.4A2 2 0 0 1 12 21z" />
      <circle cx="8" cy="10" r="1.2" fill="currentColor" /><circle cx="12" cy="7.5" r="1.2" fill="currentColor" />
    </svg>
  );
}
function iconCog() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.4M12 18.8v2.4M4.3 7.4l2 1.2M17.7 15.4l2 1.2M4.3 16.6l2-1.2M17.7 8.6l2-1.2" />
    </svg>
  );
}
