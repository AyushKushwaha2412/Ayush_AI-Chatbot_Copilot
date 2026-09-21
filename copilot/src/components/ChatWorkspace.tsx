'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCopilot } from '@/components/AppShell';
import { ReplyCard } from '@/components/ReplyCard';
import { Avatar, Button, Empty, Pill, Spinner, Switch, clockTime, dayLabel, timeAgo, useToast } from '@/components/ui';
import { api, GenerateResponse, ReplyOption } from '@/lib/client-api';

interface ConversationSummary {
  id: string;
  title: string | null;
  contact: { id: string; name: string; phoneNumber: string; avatarColor: string; tags: string };
  lastMessageAt: string;
  lastMessagePreview: string | null;
  lastMessageDirection: string | null;
  unreadCount: number;
  autoSendOverride: boolean | null;
  counts: { messages: number; drafts: number; memories: number; queued: number };
}

interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  sender: string;
  body: string;
  status: string;
  isAiDrafted: boolean;
  createdAt: string;
}

interface Memory {
  id: string;
  kind: string;
  label: string | null;
  value: string;
  importance: number;
  pinned: boolean;
  source: string;
  createdAt: string;
}

interface Detail {
  mode: 'copilot' | 'autopilot';
  globalAutoSend: boolean;
  conversation: { id: string; title: string | null; autoSendOverride: boolean | null; toneOverride: string | null; lastMessageAt: string };
  contact: { id: string; name: string; phoneNumber: string; avatarColor: string; tags: string; notes: string | null; isFavorite: boolean };
  messages: Message[];
  memories: Memory[];
  drafts: { id: string; style: string; body: string; originalBody: string; status: string; provider: string; model: string; latencyMs: number; createdAt: string }[];
  outbound: { id: string; body: string; mode: string; status: string; lastError: string | null; createdAt: string }[];
}

const STYLE_ORDER = ['suggested', 'casual', 'warm', 'playful', 'short'];
const STYLE_LABEL: Record<string, string> = {
  suggested: 'Suggested',
  casual: 'Casual',
  warm: 'Warm & friendly',
  playful: 'Playful',
  short: 'Short',
  custom: 'Custom',
};

export function ChatWorkspace({ demoRequested }: { demoRequested?: boolean }) {
  const { status, refresh: refreshStatus } = useCopilot();
  const { push } = useToast();

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [query, setQuery] = useState('');
  const [replies, setReplies] = useState<ReplyOption[]>([]);
  const [meta, setMeta] = useState<GenerateResponse['meta'] | null>(null);
  const [read, setRead] = useState<{ intent: string; read: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [steer, setSteer] = useState('');
  const [composer, setComposer] = useState('');
  const [simulateMode, setSimulateMode] = useState(true);
  const [sending, setSending] = useState(false);
  const [memoryText, setMemoryText] = useState('');
  const [memoryKind, setMemoryKind] = useState('fact');
  const [showHistory, setShowHistory] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newOpening, setNewOpening] = useState('');

  const threadRef = useRef<HTMLDivElement>(null);
  const bootstrapped = useRef(false);

  /* ---------------------------------------------------------- data loading */
  const loadConversations = useCallback(async () => {
    const res = await api.get<{ conversations: ConversationSummary[] }>(
      `/api/conversations${query ? `?q=${encodeURIComponent(query)}` : ''}`,
    );
    if (!res.ok) return;
    setConversations(res.data.conversations ?? []);
    return res.data.conversations ?? [];
  }, [query]);

  const loadDetail = useCallback(async (id: string) => {
    const res = await api.get<Detail>(`/api/conversations/${id}`);
    if (!res.ok) {
      push({ kind: 'err', title: 'Could not load conversation', message: res.data.error });
      return;
    }
    setDetail(res.data);
  }, [push]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (activeId || bootstrapped.current || !conversations.length) return;
    bootstrapped.current = true;
    setActiveId(conversations[0].id);
  }, [conversations, activeId]);

  useEffect(() => {
    if (!activeId) return;
    setReplies([]);
    setMeta(null);
    setRead(null);
    void loadDetail(activeId);
  }, [activeId, loadDetail]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [detail?.messages.length, replies.length]);

  /* -------------------------------------------------------------- actions */
  const generate = useCallback(
    async (opts: { regenerate?: boolean; onlyStyle?: string; steer?: string; incoming?: string } = {}) => {
      if (!activeId) return;
      setGenerating(true);
      try {
        const res = await api.post<GenerateResponse>('/api/ai/reply', {
          conversationId: activeId,
          regenerate: opts.regenerate,
          onlyStyle: opts.onlyStyle,
          steer: opts.steer,
          incoming: opts.incoming,
        });
        if (!res.ok) {
          push({ kind: 'err', title: 'Drafting failed', message: res.data.error });
          return;
        }
        const data = res.data;
        setReplies((prev) => {
          if (opts.onlyStyle) {
            return [...prev.filter((r) => r.style !== opts.onlyStyle), ...data.replies].sort(
              (a, b) => STYLE_ORDER.indexOf(a.style) - STYLE_ORDER.indexOf(b.style),
            );
          }
          return data.replies;
        });
        setMeta(data.meta);
        setRead({ intent: data.intent, read: data.read });
        if (data.meta.warnings?.length) {
          push({ kind: 'warn', title: 'Drafted with a warning', message: data.meta.warnings[0] });
        } else {
          push({
            kind: 'ok',
            title: `${data.replies.length} drafts ready`,
            message: `${data.meta.provider} · ${data.meta.model} · ${data.meta.latencyMs}ms`,
          });
        }
        await loadDetail(activeId);
      } finally {
        setGenerating(false);
      }
    },
    [activeId, loadDetail, push],
  );

  const approve = useCallback(
    async (reply: ReplyOption, editedBody?: string) => {
      const res = await api.patch<{ outbound: { status: string; mode: string; lastError?: string | null }; queue: { sent: number; failed: number } }>(
        `/api/replies/${reply.id}`,
        { action: 'approve', body: editedBody },
      );
      if (!res.ok) {
        push({ kind: 'err', title: 'Send failed', message: res.data.error });
        return;
      }
      const { outbound } = res.data;
      if (outbound.status === 'sent') {
        push({
          kind: 'ok',
          title: outbound.mode === 'live' ? 'Sent on WhatsApp' : 'Queued & delivered (simulated)',
          message: outbound.mode === 'live' ? 'Message delivered through the Cloud API.' : 'Simulation mode — nothing left this machine.',
        });
      } else if (outbound.status === 'queued') {
        push({ kind: 'warn', title: 'Queued for retry', message: outbound.lastError ?? 'Will retry automatically.' });
      } else {
        push({ kind: 'err', title: 'Delivery failed', message: outbound.lastError ?? 'Check WhatsApp settings.' });
      }
      if (activeId) await loadDetail(activeId);
      await loadConversations();
      void refreshStatus();
    },
    [activeId, loadConversations, loadDetail, push, refreshStatus],
  );

  const regenerate = useCallback(
    async (reply: ReplyOption) => {
      await api.patch(`/api/replies/${reply.id}`, { action: 'regenerate' });
      await generate({ regenerate: true, onlyStyle: reply.style });
    },
    [generate],
  );

  const discard = useCallback(
    async (reply: ReplyOption) => {
      await api.patch(`/api/replies/${reply.id}`, { action: 'discard' });
      setReplies((prev) => prev.filter((r) => r.id !== reply.id));
    },
    [],
  );

  const sendComposer = useCallback(async () => {
    if (!activeId || !composer.trim()) return;
    setSending(true);
    try {
      if (simulateMode) {
        const res = await api.post<{ mode: string; generated?: GenerateResponse }>('/api/whatsapp/simulate', {
          from: detail?.contact.phoneNumber,
          profileName: detail?.contact.name,
          text: composer.trim(),
          forceCopilot: !(detail?.mode === 'autopilot'),
        });
        if (!res.ok) {
          push({ kind: 'err', title: 'Could not record message', message: res.data.error });
          return;
        }
        setComposer('');
        const generated = res.data.generated;
        if (generated) {
          setReplies(generated.replies);
          setMeta(generated.meta);
          setRead({ intent: generated.intent, read: generated.read });
          push({
            kind: 'warn',
            title: 'Autopilot replied automatically',
            message: `Sent: "${generated.replies[0]?.body?.slice(0, 60) ?? ''}"`,
          });
        } else {
          void generate({ incoming: composer.trim() });
        }
        await loadDetail(activeId);
        await loadConversations();
      } else {
        const res = await api.post<{ outbound: { status: string; mode: string; lastError?: string | null } }>(
          `/api/conversations/${activeId}/messages`,
          { text: composer.trim() },
        );
        if (!res.ok) {
          push({ kind: 'err', title: 'Send failed', message: res.data.error });
          return;
        }
        setComposer('');
        push({
          kind: res.data.outbound.status === 'sent' ? 'ok' : 'warn',
          title: res.data.outbound.status === 'sent' ? 'Message sent' : 'Queued',
          message: res.data.outbound.mode === 'live' ? 'Delivered via Cloud API.' : 'Simulated locally.',
        });
        await loadDetail(activeId);
        await loadConversations();
      }
    } finally {
      setSending(false);
    }
  }, [activeId, composer, detail, generate, loadConversations, loadDetail, push, simulateMode]);

  const addMemory = useCallback(async () => {
    if (!activeId || !memoryText.trim()) return;
    const res = await api.post(`/api/conversations/${activeId}/memory`, {
      kind: memoryKind,
      value: memoryText.trim(),
      importance: 4,
      pinned: memoryKind === 'taboo' || memoryKind === 'important_date',
    });
    if (!res.ok) {
      push({ kind: 'err', title: 'Could not save memory', message: res.data.error });
      return;
    }
    setMemoryText('');
    await loadDetail(activeId);
    push({ kind: 'ok', title: 'Remembered', message: 'The AI will use this in every future draft for this contact.' });
  }, [activeId, loadDetail, memoryKind, memoryText, push]);

  const deleteMemory = useCallback(
    async (id: string) => {
      const res = await api.del(`/api/memory/${id}`);
      if (!res.ok) {
        push({ kind: 'err', title: 'Delete failed', message: res.data.error });
        return;
      }
      if (activeId) await loadDetail(activeId);
    },
    [activeId, loadDetail, push],
  );

  const clearScope = useCallback(
    async (scope: 'messages' | 'memory' | 'drafts' | 'all') => {
      if (!activeId) return;
      const labels: Record<string, string> = {
        messages: 'Delete the full message history for this chat?',
        memory: 'Clear every stored fact about this contact?',
        drafts: 'Delete all generated drafts for this chat?',
        all: 'Wipe this chat completely — messages, memory and drafts?',
      };
      if (!confirm(labels[scope])) return;
      const res = await api.post<{ removed: Record<string, number> }>(`/api/conversations/${activeId}/clear`, { scope });
      if (!res.ok) {
        push({ kind: 'err', title: 'Clear failed', message: res.data.error });
        return;
      }
      setReplies([]);
      await loadDetail(activeId);
      await loadConversations();
      push({ kind: 'ok', title: 'Cleared', message: Object.entries(res.data.removed).map(([k, v]) => `${v} ${k}`).join(', ') });
    },
    [activeId, loadConversations, loadDetail, push],
  );

  const deleteConversation = useCallback(async () => {
    if (!activeId || !confirm('Delete this conversation permanently? Messages, memory and drafts go with it.')) return;
    const res = await api.del(`/api/conversations/${activeId}?contact=0`);
    if (!res.ok) {
      push({ kind: 'err', title: 'Delete failed', message: res.data.error });
      return;
    }
    setActiveId(null);
    setDetail(null);
    bootstrapped.current = false;
    await loadConversations();
    push({ kind: 'ok', title: 'Conversation deleted' });
  }, [activeId, loadConversations, push]);

  const setConvMode = useCallback(
    async (autoSend: boolean | null) => {
      if (!activeId) return;
      const res = await api.patch(`/api/conversations/${activeId}`, { autoSendOverride: autoSend });
      if (!res.ok) {
        push({ kind: 'err', title: 'Could not change mode', message: res.data.error });
        return;
      }
      await loadDetail(activeId);
      await loadConversations();
      push({
        kind: autoSend === true ? 'warn' : 'ok',
        title: autoSend === true ? 'This chat is on Autopilot' : autoSend === false ? 'This chat waits for approval' : 'Following global mode',
      });
    },
    [activeId, loadConversations, loadDetail, push],
  );

  const startConversation = useCallback(async () => {
    if (!newPhone.trim() || !newName.trim()) {
      push({ kind: 'err', title: 'Name and phone number are required' });
      return;
    }
    const res = await api.post<{ conversation: { id: string } }>('/api/conversations', {
      name: newName.trim(),
      phoneNumber: newPhone.trim(),
      openingMessage: newOpening.trim() || undefined,
    });
    if (!res.ok) {
      push({ kind: 'err', title: 'Could not start chat', message: res.data.error });
      return;
    }
    setCreating(false);
    setNewName('');
    setNewPhone('');
    setNewOpening('');
    bootstrapped.current = false;
    await loadConversations();
    setActiveId(res.data.conversation.id);
    push({ kind: 'ok', title: 'Conversation started' });
  }, [loadConversations, newName, newOpening, newPhone, push]);

  const loadDemo = useCallback(async () => {
    const res = await api.post('/api/demo/seed', {});
    if (!res.ok) {
      push({ kind: 'err', title: 'Demo data failed', message: res.data.error });
      return;
    }
    bootstrapped.current = false;
    await loadConversations();
    await refreshStatus();
    push({ kind: 'ok', title: 'Demo data loaded', message: 'Four conversations with memory and history are ready.' });
  }, [loadConversations, push, refreshStatus]);

  useEffect(() => {
    if (demoRequested && !bootstrapped.current) void loadDemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoRequested]);

  const draftCards: ReplyOption[] = useMemo(() => {
    if (replies.length) return replies;
    const latest = detail?.drafts ?? [];
    const byStyle = new Map<string, ReplyOption>();
    for (const d of latest) {
      if (!byStyle.has(d.style) && d.status === 'draft') {
        byStyle.set(d.style, {
          id: d.id,
          style: d.style,
          label: STYLE_LABEL[d.style] ?? d.style,
          body: d.body,
          provider: d.provider,
          model: d.model,
          latencyMs: d.latencyMs,
          status: d.status,
          autoSent: false,
          createdAt: d.createdAt,
        });
      }
    }
    return STYLE_ORDER.filter((s) => byStyle.has(s)).map((s) => byStyle.get(s)!);
  }, [detail?.drafts, replies]);

  const autopilotHere = detail ? detail.mode === 'autopilot' : Boolean(status?.mode === 'autopilot');

  const grouped = useMemo(() => {
    const map = new Map<string, Message[]>();
    for (const m of detail?.messages ?? []) {
      const key = dayLabel(m.createdAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return [...map.entries()];
  }, [detail?.messages]);

  /* ---------------------------------------------------------------- render */
  return (
    <div className="chat-layout">
      {/* ------------------------------------------------------------ list */}
      <aside className="chat-list">
        <div className="chat-head">
          <div className="row">
            <input
              type="search"
              placeholder="Search name, number, message"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" variant="primary" onClick={() => setCreating((c) => !c)} style={{ flex: 1 }}>
              + New chat
            </Button>
            <Button size="sm" onClick={loadDemo} title="Load fictional conversations, memory and history">
              Demo data
            </Button>
          </div>
          {creating ? (
            <div className="card tight" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input type="text" placeholder="Contact name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <input type="text" placeholder="Phone (digits, with country code)" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
              <input type="text" placeholder="Optional: last message they sent" value={newOpening} onChange={(e) => setNewOpening(e.target.value)} />
              <div className="row">
                <Button size="sm" variant="primary" onClick={startConversation}>Start</Button>
                <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
              </div>
            </div>
          ) : null}
        </div>

        <div>
          {conversations.length === 0 ? (
            <Empty
              icon="💬"
              title="No conversations yet"
              hint="Load the demo data to explore, or start a chat with a phone number."
              action={<Button variant="primary" size="sm" onClick={loadDemo}>Load demo data</Button>}
            />
          ) : null}

          {conversations.map((c) => (
            <div
              key={c.id}
              className={`conv-row ${activeId === c.id ? 'active' : ''}`}
              onClick={() => setActiveId(c.id)}
            >
              <Avatar name={c.contact.name} color={c.contact.avatarColor} />
              <div className="conv-meta">
                <div className="row1">
                  <span className="name">{c.contact.name}</span>
                  <span className="time">{timeAgo(c.lastMessageAt)}</span>
                </div>
                <div className="preview">
                  {c.lastMessageDirection === 'outbound' ? 'You: ' : ''}
                  {c.lastMessagePreview ?? 'No messages yet'}
                </div>
                <div className="conv-badges">
                  {c.counts.drafts > 0 ? <span className="mini-badge accent">{c.counts.drafts} drafts</span> : null}
                  {c.counts.memories > 0 ? <span className="mini-badge">{c.counts.memories} facts</span> : null}
                  {c.counts.queued > 0 ? <span className="mini-badge accent">{c.counts.queued} queued</span> : null}
                  {c.autoSendOverride === true ? <span className="mini-badge accent">autopilot</span> : null}
                  {c.autoSendOverride === false ? <span className="mini-badge">approval</span> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* ---------------------------------------------------------- thread */}
      <section className="chat-center">
        {!detail ? (
          <Empty icon="👈" title="Pick a conversation" hint="Select a chat on the left, or load the demo data to see the whole flow." />
        ) : (
          <>
            <div className="chat-head" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar name={detail.contact.name} color={detail.contact.avatarColor} size={40} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 650, fontSize: 15 }}>{detail.contact.name}</div>
                <div className="tiny muted">
                  +{detail.contact.phoneNumber}
                  {detail.contact.tags ? ` · ${detail.contact.tags}` : ''}
                  {detail.contact.notes ? ' · notes saved' : ''}
                </div>
              </div>
              <div className="row" style={{ marginLeft: 'auto', gap: 8 }}>
                <Pill tone={autopilotHere ? 'warn' : 'ok'}>
                  {autopilotHere ? '⚡ Autopilot here' : '✋ Approve here'}
                </Pill>
                <Button size="sm" onClick={() => generate({})} loading={generating}>
                  ✨ Draft replies
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowHistory((s) => !s)}>
                  {showHistory ? 'Hide' : 'History'}
                </Button>
              </div>
            </div>

            <div className="thread scroll" ref={threadRef}>
              {grouped.length === 0 ? (
                <Empty icon="✍️" title="No messages yet" hint="Simulate an incoming message below, then hit Draft replies." />
              ) : null}

              {grouped.map(([day, msgs]) => (
                <div key={day} style={{ display: 'contents' }}>
                  <div className="day-sep">{day}</div>
                  {msgs.map((m) => (
                    <div className={`bubble-row ${m.direction === 'outbound' ? 'out' : ''}`} key={m.id}>
                      <div className={`bubble ${m.direction === 'outbound' ? 'out' : 'in'}`}>
                        {m.body}
                        <div className="meta">
                          {m.isAiDrafted ? <span className="ai-tag">AI</span> : null}
                          <span>{clockTime(m.createdAt)}</span>
                          {m.direction === 'outbound' ? <span>{m.status === 'sent' || m.status === 'read' ? '✓✓' : '🕘'}</span> : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* --------------------------------------------------- reply deck */}
            <div className="reply-deck">
              <div className="reply-deck-head">
                <span className="title">
                  {draftCards.length ? `${draftCards.length} reply options` : 'Reply suggestions'}
                </span>
                {meta ? (
                  <>
                    <Pill tone={meta.fallbackUsed ? 'warn' : 'ok'}>
                      {meta.provider} · {meta.model}
                    </Pill>
                    <span className="tiny muted">{meta.latencyMs}ms · {meta.usage.totalTokens} tokens</span>
                  </>
                ) : detail.drafts?.length ? (
                  <span className="tiny muted">previously generated — regenerate for fresh options</span>
                ) : null}
                <div className="grow" />
                {read?.read ? (
                  <span className="tiny muted" title="What the AI thinks they mean">
                    🧠 {read.read}
                  </span>
                ) : null}
                <Button size="sm" onClick={() => generate({ regenerate: true })} loading={generating}>
                  ↻ Regenerate all
                </Button>
              </div>

              {generating && !draftCards.length ? (
                <div className="reply-grid">
                  {STYLE_ORDER.map((s) => (
                    <div className="reply-card" key={s}>
                      <div className="head">
                        <span className={`style-chip s-${s}`}>{STYLE_LABEL[s]}</span>
                      </div>
                      <div className="skeleton" style={{ height: 14, width: '90%' }} />
                      <div className="skeleton" style={{ height: 14, width: '70%' }} />
                      <div className="skeleton" style={{ height: 14, width: '40%' }} />
                    </div>
                  ))}
                </div>
              ) : draftCards.length ? (
                <div className="reply-grid">
                  {draftCards.map((r) => (
                    <ReplyCard
                      key={r.id}
                      reply={r}
                      onApprove={approve}
                      onRegenerate={regenerate}
                      onDiscard={discard}
                      disabled={generating}
                    />
                  ))}
                </div>
              ) : (
                <Empty
                  icon="✨"
                  title="No drafts for this inbox message yet"
                  hint="Hit “Draft replies” to get a suggested, casual, warm, playful and short option."
                />
              )}

              {/* -------------------------------------------- custom generator */}
              <div className="row mt-14" style={{ gap: 8, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <input
                    type="text"
                    placeholder="Custom request — e.g. “reply but make it more flirty” or “tell her I can't make it tonight”"
                    value={steer}
                    onChange={(e) => setSteer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && steer.trim()) void generate({ steer: steer.trim() });
                    }}
                  />
                </div>
                <Button variant="primary" size="sm" disabled={!steer.trim()} loading={generating} onClick={() => generate({ steer: steer.trim() })}>
                  ✨ Generate custom
                </Button>
              </div>

              {showHistory ? (
                <div className="mt-14">
                  <div className="card-title">Recent drafts in this chat</div>
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Style</th>
                        <th>Message</th>
                        <th>Status</th>
                        <th>Model</th>
                        <th>When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.drafts.slice(0, 12).map((d) => (
                        <tr key={d.id}>
                          <td><span className={`style-chip s-${d.style}`}>{STYLE_LABEL[d.style] ?? d.style}</span></td>
                          <td>{d.body}</td>
                          <td>
                            <Pill tone={d.status === 'sent' ? 'ok' : d.status === 'discarded' ? 'bad' : 'info'}>{d.status}</Pill>
                          </td>
                          <td className="mono tiny">{d.model}</td>
                          <td className="tiny muted">{timeAgo(d.createdAt)}</td>
                        </tr>
                      ))}
                      {detail.drafts.length === 0 ? (
                        <tr><td colSpan={5} className="muted small">No drafts yet.</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>

            {/* ------------------------------------------------------ composer */}
            <div className="composer">
              <div className="row" style={{ marginBottom: 9, gap: 14, flexWrap: 'wrap' }}>
                <div className="tabs" style={{ padding: 3 }}>
                  <button className={`tab ${simulateMode ? 'active' : ''}`} onClick={() => setSimulateMode(true)} style={{ fontSize: 12, padding: '5px 11px' }}>
                    Incoming (simulate)
                  </button>
                  <button className={`tab ${!simulateMode ? 'active' : ''}`} onClick={() => setSimulateMode(false)} style={{ fontSize: 12, padding: '5px 11px' }}>
                    Send as me
                  </button>
                </div>
                <span className="tiny muted">
                  {simulateMode
                    ? 'Pretends the contact texted you, then the copilot may reply on its own.'
                    : 'Sends this exact text out through the outbound queue.'}
                </span>
                <div className="grow" />
                <span className="tiny muted">
                  {autopilotHere ? '⚡ Autopilot will answer automatically' : '✋ You approve each reply'}
                </span>
              </div>
              <div className="row" style={{ alignItems: 'flex-end', gap: 9 }}>
                <textarea
                  placeholder={simulateMode ? `Type what ${detail.contact.name} would say…` : 'Type your message…'}
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void sendComposer();
                    }
                  }}
                  style={{ minHeight: 46 }}
                />
                <Button variant="primary" loading={sending} onClick={sendComposer} disabled={!composer.trim()}>
                  {simulateMode ? '⇢ Simulate' : '➤ Send'}
                </Button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* ---------------------------------------------------------- memory */}
      <aside className="chat-memory scroll">
        {detail ? (
          <div style={{ padding: 16 }}>
            <div className="card-title">Conversation memory</div>
            <div className="tiny muted mb-14">
              Facts the AI always keeps in mind for {detail.contact.name}. Everything here is editable and deletable.
            </div>

            <div className="card tight mb-14">
              <div className="tiny muted mb-8">MODE FOR THIS CHAT</div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button className={`tab ${detail.conversation.autoSendOverride === false ? 'active' : ''}`} onClick={() => setConvMode(false)}>
                  ✋ Approve
                </button>
                <button className={`tab ${detail.conversation.autoSendOverride === true ? 'active' : ''}`} onClick={() => setConvMode(true)}>
                  ⚡ Autopilot
                </button>
                <button className={`tab ${detail.conversation.autoSendOverride === null ? 'active' : ''}`} onClick={() => setConvMode(null)}>
                  Follow global
                </button>
              </div>
            </div>

            <div className="card tight mb-14">
              <div className="tiny muted mb-8">ADD A FACT</div>
              <select value={memoryKind} onChange={(e) => setMemoryKind(e.target.value)} style={{ marginBottom: 8 }}>
                <option value="fact">Fact</option>
                <option value="preference">Preference</option>
                <option value="important_date">Important date</option>
                <option value="taboo">Do not mention</option>
                <option value="note">Note</option>
              </select>
              <textarea
                placeholder="e.g. She is vegetarian and hates surprise plans"
                value={memoryText}
                onChange={(e) => setMemoryText(e.target.value)}
                style={{ minHeight: 62 }}
              />
              <Button size="sm" variant="primary" className="mt-8" onClick={addMemory} disabled={!memoryText.trim()}>
                + Remember this
              </Button>
            </div>

            {detail.memories.length === 0 ? (
              <div className="small muted">No memory stored yet.</div>
            ) : (
              detail.memories.map((m) => (
                <div className={`mem-item ${m.pinned ? 'pinned' : ''}`} key={m.id}>
                  <div className="mem-head">
                    <span className={`mem-kind ${m.kind}`}>{m.kind.replace('_', ' ')}</span>
                    {m.label ? <span className="tiny muted">{m.label}</span> : null}
                    <span className="tiny muted" style={{ marginLeft: 'auto' }}>{'★'.repeat(m.importance)}</span>
                  </div>
                  <div className="mem-value">{m.value}</div>
                  <div className="mem-foot">
                    <span className={m.source === 'ai' ? 'pill violet' : 'pill'} style={{ padding: '1px 7px', fontSize: 10 }}>
                      {m.source === 'ai' ? 'learned by AI' : 'added by you'}
                    </span>
                    <div className="grow" />
                    <button className="btn ghost sm" onClick={() => deleteMemory(m.id)} title="Forget this">
                      🗑
                    </button>
                  </div>
                </div>
              ))
            )}

            <hr className="sep" />
            <div className="card-title">Privacy controls</div>
            <div className="grid" style={{ gap: 7 }}>
              <Button size="sm" onClick={() => clearScope('memory')}>🧠 Clear memory only</Button>
              <Button size="sm" onClick={() => clearScope('drafts')}>🗒 Delete drafts</Button>
              <Button size="sm" onClick={() => clearScope('messages')}>💬 Delete message history</Button>
              <Button size="sm" variant="danger" onClick={() => clearScope('all')}>🧨 Wipe this chat (keep contact)</Button>
              <Button size="sm" variant="danger" onClick={deleteConversation}>🗑 Delete conversation</Button>
            </div>

            {detail.outbound.some((o) => o.status !== 'sent') ? (
              <>
                <hr className="sep" />
                <div className="card-title">Outbound queue</div>
                {detail.outbound
                  .filter((o) => o.status !== 'sent')
                  .map((o) => (
                    <div className="mem-item" key={o.id}>
                      <div className="row between">
                        <span className="pill warn" style={{ fontSize: 10.5 }}>{o.status}</span>
                        <span className="tiny muted">{timeAgo(o.createdAt)}</span>
                      </div>
                      <div className="mem-value mt-8">{o.body}</div>
                      {o.lastError ? <div className="tiny" style={{ color: 'var(--danger)' }}>{o.lastError}</div> : null}
                    </div>
                  ))}
              </>
            ) : null}
          </div>
        ) : (
          <div style={{ padding: 16 }}>
            <div className="card-title">Memory</div>
            <div className="small muted">Select a conversation to see what the copilot remembers.</div>
          </div>
        )}
      </aside>
    </div>
  );
}
