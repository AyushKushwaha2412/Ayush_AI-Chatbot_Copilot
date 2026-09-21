'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useCopilot } from '@/components/AppShell';
import { Avatar, Button, Card, Dot, Empty, Pill, Spinner, Switch, timeAgo, useToast, numberFmt } from '@/components/ui';
import { api } from '@/lib/client-api';

interface Dashboard {
  totals: {
    conversations: number; contacts: number; messages: number; inbound: number; outbound: number;
    drafts: number; approved: number; sent: number; memories: number; pendingDrafts: number; approvalRate: number;
  };
  usage: {
    requests: number; promptTokens: number; completionTokens: number; totalTokens: number;
    avgLatencyMs: number; fallbackRate: number; byProvider: { provider: string; count: number }[];
  };
  localAi: {
    status: string; connected: boolean; provider: string; model: string; message: string;
    configuredProvider: string; fallbackEnabled: boolean; endpoint: string | null; latencyMs: number | null;
  };
  mode: 'copilot' | 'autopilot';
  autoSend: boolean;
  whatsapp: { mode: string; liveReady: boolean; notes: string[]; webhookUrlHint: string };
  queue: { queued: number; sending: number; sent: number; failed: number; cancelled: number };
  series: { day: string; drafts: number; messages: number; tokens: number }[];
  recentConversations: {
    id: string; contactName: string; avatarColor: string; preview: string | null; lastMessageAt: string;
    messages: number; drafts: number; autoSendOverride: boolean | null;
  }[];
  recentUsage: { id: string; provider: string; model: string; totalTokens: number; latencyMs: number; fallbackUsed: boolean; success: boolean; createdAt: string }[];
  topContacts: { contactId: string; name: string; conversations: number }[];
}

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [probe, setProbe] = useState<Record<string, unknown> | null>(null);
  const { setAutoSend } = useCopilot();
  const { push } = useToast();

  const load = useCallback(async () => {
    const res = await api.get<Dashboard>('/api/dashboard');
    if (res.ok) setData(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 25000);
    return () => clearInterval(t);
  }, [load]);

  const seed = async () => {
    const res = await api.post('/api/demo/seed', {});
    if (!res.ok) {
      push({ kind: 'err', title: 'Could not load demo data', message: res.data.error });
      return;
    }
    push({ kind: 'ok', title: 'Demo data loaded', message: 'Four conversations, memory and history are ready in Chat.' });
    await load();
  };

  const testConnection = async () => {
    setTesting(true);
    const res = await api.post<Record<string, unknown>>('/api/ai/status/test', {});
    setProbe(res.data);
    setTesting(false);
    const rt = (res.data as { roundTrip?: { success?: boolean; error?: string; provider?: string; latencyMs?: number } }).roundTrip;
    if (rt?.success) push({ kind: 'ok', title: 'Model responded', message: `${rt.provider} · ${rt.latencyMs}ms` });
    else push({ kind: 'err', title: 'Connection failed', message: rt?.error ?? 'See the raw response below.' });
  };

  if (loading && !data) {
    return (
      <div className="page">
        <div className="grid cols-4">
          {[0, 1, 2, 3].map((i) => <div className="skeleton" key={i} style={{ height: 108 }} />)}
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="page"><Empty icon="⚠️" title="Could not load the dashboard" hint="Check that the dev server is running." /></div>;
  }

  const empty = data.totals.conversations === 0 && data.totals.messages === 0;
  const maxSeries = Math.max(1, ...data.series.map((s) => Math.max(s.drafts, s.messages)));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Dashboard</h2>
          <p>
            Everything the copilot has drafted, sent and remembered. Drafts are suggestions until you approve them —
            unless Autopilot is on.
          </p>
        </div>
        <div className="spacer" />
        <Button onClick={load} size="sm">↻ Refresh</Button>
        {empty ? <Button size="sm" variant="primary" onClick={seed}>Load demo data</Button> : null}
        <Link href="/chat" className="btn primary sm">Open chat workspace →</Link>
      </div>

      {empty ? (
        <Card className="mb-14">
          <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 26 }}>🚀</div>
            <div style={{ flex: 1, minWidth: 260 }}>
              <strong>Start here</strong>
              <div className="small muted mt-8">
                1. Load the demo data (or add a conversation in Chat) → 2. open <b>My style</b> and describe how you text →
                3. hit <b>Draft replies</b> and approve one. If Ollama is not running, the built-in offline drafter takes over
                so you can still see the entire flow.
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Button variant="primary" onClick={seed}>Load demo data</Button>
              <Link href="/style" className="btn">Set my style</Link>
            </div>
          </div>
        </Card>
      ) : null}

      {/* ------------------------------------------------------------- stats */}
      <div className="grid cols-6 mb-14">
        <Card className="tight"><div className="stat"><span className="k">Conversations</span><span className="v">{data.totals.conversations}</span><span className="d">{data.totals.contacts} contacts</span></div></Card>
        <Card className="tight"><div className="stat"><span className="k">Replies drafted</span><span className="v">{numberFmt(data.totals.drafts)}</span><span className="d">{data.totals.pendingDrafts} awaiting decision</span></div></Card>
        <Card className="tight"><div className="stat"><span className="k">Approved</span><span className="v">{data.totals.approved}</span><span className="d">{data.totals.approvalRate}% of drafts</span></div></Card>
        <Card className="tight"><div className="stat"><span className="k">Messages</span><span className="v">{numberFmt(data.totals.messages)}</span><span className="d">{data.totals.inbound} in · {data.totals.outbound} out</span></div></Card>
        <Card className="tight"><div className="stat"><span className="k">AI requests</span><span className="v">{data.usage.requests}</span><span className="d">{data.usage.avgLatencyMs}ms avg</span></div></Card>
        <Card className="tight"><div className="stat"><span className="k">Tokens used</span><span className="v">{numberFmt(data.usage.totalTokens)}</span><span className="d">{data.usage.fallbackRate}% fallback</span></div></Card>
      </div>

      <div className="grid cols-3 mb-14">
        {/* -------------------------------------------------------- local ai */}
        <Card>
          <div className="row between mb-14">
            <div className="card-title mb-0">Local AI status</div>
            <Pill tone={data.localAi.connected ? 'ok' : 'bad'}>
              <Dot tone={data.localAi.connected ? 'ok' : 'bad'} />
              {data.localAi.status}
            </Pill>
          </div>

          <div className="row between small" style={{ marginBottom: 6 }}>
            <span className="muted">Active provider</span>
            <span className="mono">{data.localAi.provider}</span>
          </div>
          <div className="row between small" style={{ marginBottom: 6 }}>
            <span className="muted">Model</span>
            <span className="mono">{data.localAi.model}</span>
          </div>
          <div className="row between small" style={{ marginBottom: 6 }}>
            <span className="muted">Endpoint</span>
            <span className="mono tiny">{data.localAi.endpoint ?? 'no network needed'}</span>
          </div>
          <div className="row between small" style={{ marginBottom: 10 }}>
            <span className="muted">Configured</span>
            <span className="mono">{data.localAi.configuredProvider}</span>
          </div>

          <div className="small muted" style={{ minHeight: 40 }}>{data.localAi.message}</div>

          <div className="row mt-14" style={{ gap: 8 }}>
            <Button size="sm" variant="primary" onClick={testConnection} loading={testing}>Test connection</Button>
            <Link href="/settings" className="btn sm">Configure</Link>
          </div>

          {data.localAi.fallbackEnabled ? (
            <div className="tiny muted mt-14">
              Fallback enabled: if the provider is unreachable, the built-in offline drafter writes the drafts so the
              workflow keeps working.
            </div>
          ) : null}

          {probe ? <div className="code-block mt-14" style={{ maxHeight: 150, overflow: 'auto' }}>{JSON.stringify(probe, null, 2)}</div> : null}
        </Card>

        {/* ----------------------------------------------------------- mode */}
        <Card>
          <div className="card-title">Reply mode</div>
          <div className="row between mb-14">
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{data.mode === 'autopilot' ? '⚡ Autopilot' : '✋ Copilot'}</div>
              <div className="small muted mt-8">
                {data.mode === 'autopilot'
                  ? 'Incoming messages are answered automatically with the top suggestion.'
                  : 'Nothing is ever sent until you approve a draft. This is the safe default.'}
              </div>
            </div>
            <Switch
              checked={data.autoSend}
              onChange={async (v) => {
                await setAutoSend(v);
                await load();
              }}
              label=""
            />
          </div>

          <div className="tabs mb-14">
            <span className={`tab ${data.mode === 'copilot' ? 'active' : ''}`}>Suggests replies</span>
            <span className={`tab ${data.mode === 'autopilot' ? 'active' : ''}`}>Talks by itself</span>
          </div>

          <div className="small muted">
            Per-chat overrides win over this global switch — set them in the chat’s right panel.
          </div>

          <hr className="sep" />
          <div className="card-title">Memory</div>
          <div className="row between small">
            <span className="muted">Stored facts</span>
            <span className="mono">{data.totals.memories}</span>
          </div>
          <Link href="/memory" className="btn sm mt-8" style={{ width: '100%' }}>Review & delete memory</Link>
        </Card>

        {/* ------------------------------------------------------- whatsapp */}
        <Card>
          <div className="row between mb-14">
            <div className="card-title mb-0">WhatsApp integration</div>
            <Pill tone={data.whatsapp.mode === 'live' ? 'warn' : 'info'}>{data.whatsapp.mode.toUpperCase()}</Pill>
          </div>

          <div className="row between small" style={{ marginBottom: 6 }}>
            <span className="muted">Cloud API</span>
            <span className="mono">{data.whatsapp.liveReady ? 'credentials ready' : 'not configured'}</span>
          </div>
          <div className="row between small" style={{ marginBottom: 6 }}>
            <span className="muted">Webhook</span>
            <span className="mono tiny">POST {data.whatsapp.webhookUrlHint}</span>
          </div>

          <hr className="sep" />
          <div className="card-title">Outbound queue</div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {[
              ['queued', data.queue.queued, 'warn'],
              ['sent', data.queue.sent, 'ok'],
              ['failed', data.queue.failed, 'bad'],
              ['sending', data.queue.sending, 'info'],
            ].map(([k, v, tone]) => (
              <div key={k as string} className="center" style={{ flexDirection: 'column' }}>
                <div style={{ fontSize: 19, fontWeight: 700 }}>{v as number}</div>
                <div className="tiny muted">{k as string}</div>
              </div>
            ))}
          </div>

          <div className="small muted mt-14">{data.whatsapp.notes[0]}</div>
          <Link href="/settings#whatsapp" className="btn sm mt-14" style={{ width: '100%' }}>Integration setup</Link>
        </Card>
      </div>

      {/* ------------------------------------------------------------ series */}
      <Card className="mb-14">
        <div className="row between mb-14">
          <div className="card-title mb-0">Last 14 days</div>
          <div className="row" style={{ gap: 12 }}>
            <span className="tiny muted"><span style={{ color: 'var(--accent)' }}>■</span> drafts</span>
            <span className="tiny muted"><span style={{ color: 'var(--info)' }}>■</span> messages</span>
          </div>
        </div>
        <div className="row" style={{ alignItems: 'flex-end', gap: 6, height: 130 }}>
          {data.series.map((s) => (
            <div key={s.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }} title={`${s.day}: ${s.drafts} drafts, ${s.messages} messages`}>
              <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 100, width: '100%', justifyContent: 'center' }}>
                <div style={{ width: '42%', height: `${(s.drafts / maxSeries) * 100}%`, minHeight: s.drafts ? 4 : 1, background: 'linear-gradient(180deg, var(--accent), var(--accent-2))', borderRadius: 3 }} />
                <div style={{ width: '42%', height: `${(s.messages / maxSeries) * 100}%`, minHeight: s.messages ? 4 : 1, background: 'linear-gradient(180deg, var(--info), #2b7fa8)', borderRadius: 3, opacity: 0.9 }} />
              </div>
              <span className="tiny muted" style={{ fontSize: 9.5 }}>{s.day.slice(8)}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid cols-2">
        {/* ----------------------------------------------- recent activity */}
        <Card>
          <div className="row between mb-14">
            <div className="card-title mb-0">Recent conversations</div>
            <Link href="/chat" className="btn ghost sm">Open all →</Link>
          </div>
          {data.recentConversations.length === 0 ? (
            <div className="small muted">No conversations yet.</div>
          ) : (
            data.recentConversations.map((c) => (
              <div className="row" key={c.id} style={{ padding: '9px 0', borderBottom: '1px solid rgba(34,52,61,0.6)' }}>
                <Avatar name={c.contactName} color={c.avatarColor} size={34} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <strong style={{ fontSize: 13.5 }}>{c.contactName}</strong>
                    {c.autoSendOverride === true ? <span className="mini-badge accent">autopilot</span> : null}
                    <span className="tiny muted" style={{ marginLeft: 'auto' }}>{timeAgo(c.lastMessageAt)}</span>
                  </div>
                  <div className="tiny muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 380 }}>
                    {c.preview ?? 'No messages yet'}
                  </div>
                </div>
                <div className="row" style={{ gap: 5 }}>
                  <span className="mini-badge">{c.messages} msg</span>
                  <span className="mini-badge accent">{c.drafts} drafts</span>
                </div>
              </div>
            ))
          )}
        </Card>

        {/* -------------------------------------------------- usage table */}
        <Card>
          <div className="card-title">AI usage log</div>
          {data.recentUsage.length === 0 ? (
            <div className="small muted">No AI calls yet. Draft a reply to see usage here.</div>
          ) : (
            <table className="data">
              <thead>
                <tr><th>Provider</th><th>Model</th><th>Tokens</th><th>Latency</th><th>When</th></tr>
              </thead>
              <tbody>
                {data.recentUsage.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <Pill tone={u.fallbackUsed ? 'warn' : 'ok'}>{u.provider}</Pill>
                    </td>
                    <td className="mono tiny">{u.model}</td>
                    <td className="mono">{u.totalTokens}</td>
                    <td className="mono">{u.latencyMs}ms</td>
                    <td className="tiny muted">{timeAgo(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data.usage.byProvider.length ? (
            <div className="row wrap mt-14" style={{ gap: 7 }}>
              {data.usage.byProvider.map((p) => (
                <Pill key={p.provider}>{p.provider}: {p.count}</Pill>
              ))}
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
