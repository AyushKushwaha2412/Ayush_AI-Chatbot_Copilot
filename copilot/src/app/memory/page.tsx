'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Avatar, Button, Card, Empty, Field, Pill, Spinner, timeAgo, useToast } from '@/components/ui';
import { api } from '@/lib/client-api';

interface ConversationRow {
  id: string;
  contact: { id: string; name: string; phoneNumber: string; avatarColor: string; tags: string };
  counts: { messages: number; memories: number; drafts: number };
  lastMessageAt: string;
  autoSendOverride: boolean | null;
}

interface Memory {
  id: string;
  conversationId: string;
  kind: string;
  label: string | null;
  value: string;
  importance: number;
  pinned: boolean;
  source: string;
  createdAt: string;
}

const KIND_TONE: Record<string, 'violet' | 'info' | 'warn' | 'bad' | 'ok' | 'default'> = {
  fact: 'info',
  preference: 'violet',
  important_date: 'warn',
  taboo: 'bad',
  note: 'ok',
  summary: 'default',
};

export default function MemoryPage() {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'user' | 'ai'>('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newKind, setNewKind] = useState('fact');
  const { push } = useToast();

  const loadConversations = useCallback(async () => {
    const res = await api.get<{ conversations: ConversationRow[] }>('/api/conversations');
    if (!res.ok) return;
    setConversations(res.data.conversations ?? []);
    setLoading(false);
    return res.data.conversations ?? [];
  }, []);

  const loadMemories = useCallback(async (id: string) => {
    const res = await api.get<{ memories: Memory[] }>(`/api/conversations/${id}/memory`);
    if (res.ok) setMemories(res.data.memories ?? []);
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (activeId) void loadMemories(activeId);
  }, [activeId, loadMemories]);

  const totalMemories = useMemo(() => conversations.reduce((a, c) => a + c.counts.memories, 0), [conversations]);

  const filtered = useMemo(
    () =>
      memories.filter((m) => {
        if (filter !== 'all' && m.source !== filter) return false;
        if (!query.trim()) return true;
        const q = query.toLowerCase();
        return m.value.toLowerCase().includes(q) || (m.label ?? '').toLowerCase().includes(q) || m.kind.includes(q);
      }),
    [memories, filter, query],
  );

  const remove = async (id: string) => {
    const res = await api.del(`/api/memory/${id}`);
    if (!res.ok) {
      push({ kind: 'err', title: 'Delete failed', message: res.data.error });
      return;
    }
    setMemories((prev) => prev.filter((m) => m.id !== id));
    push({ kind: 'ok', title: 'Forgotten' });
  };

  const update = async (id: string, patch: Partial<Memory>) => {
    const res = await api.patch(`/api/memory/${id}`, patch);
    if (!res.ok) {
      push({ kind: 'err', title: 'Update failed', message: res.data.error });
      return;
    }
    setMemories((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  const add = async () => {
    if (!activeId || !newValue.trim()) return;
    const res = await api.post(`/api/conversations/${activeId}/memory`, {
      kind: newKind,
      value: newValue.trim(),
      importance: 4,
      pinned: newKind === 'taboo' || newKind === 'important_date',
    });
    if (!res.ok) {
      push({ kind: 'err', title: 'Could not save', message: res.data.error });
      return;
    }
    setNewValue('');
    await loadMemories(activeId);
    push({ kind: 'ok', title: 'Fact stored', message: 'It will be used in every future draft for this contact.' });
  };

  const active = conversations.find((c) => c.id === activeId);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Conversation memory</h2>
          <p>
            What the copilot remembers for each person — facts you entered plus durable details it inferred. Everything is
            visible, editable and deletable.
          </p>
        </div>
        <div className="spacer" />
        <Pill tone={totalMemories ? 'ok' : 'warn'}>{totalMemories} facts stored</Pill>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '300px minmax(0,1fr)', alignItems: 'start' }}>
        <Card className="tight" style={{ padding: 10 }}>
          <div className="card-title" style={{ padding: '4px 6px' }}>Contacts</div>
          {loading ? <div className="skeleton" style={{ height: 120 }} /> : null}
          {!loading && conversations.length === 0 ? (
            <Empty icon="🧠" title="Nothing to remember yet" hint="Start a conversation first." action={<Link href="/chat" className="btn sm primary">Open chat</Link>} />
          ) : null}
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`conv-row ${activeId === c.id ? 'active' : ''}`}
              style={{ borderRadius: 10, borderLeft: 'none' }}
              onClick={() => setActiveId(c.id)}
            >
              <Avatar name={c.contact.name} color={c.contact.avatarColor} size={34} />
              <div className="conv-meta">
                <div className="row1">
                  <span className="name" style={{ fontSize: 13.5 }}>{c.contact.name}</span>
                  <span className="mini-badge accent" style={{ marginLeft: 'auto' }}>{c.counts.memories}</span>
                </div>
                <div className="preview tiny">{c.counts.messages} messages · {c.counts.drafts} drafts</div>
              </div>
            </div>
          ))}
        </Card>

        <div>
          {!active ? (
            <Card>
              <Empty icon="🧠" title="Pick a contact" hint="Their stored facts, preferences and things to avoid will appear here." />
            </Card>
          ) : (
            <>
              <Card className="mb-14">
                <div className="row between mb-14">
                  <div className="row" style={{ gap: 11 }}>
                    <Avatar name={active.contact.name} color={active.contact.avatarColor} />
                    <div>
                      <div style={{ fontWeight: 650 }}>{active.contact.name}</div>
                      <div className="tiny muted">
                        +{active.contact.phoneNumber} · last active {timeAgo(active.lastMessageAt)}
                        {active.autoSendOverride === true ? ' · autopilot' : active.autoSendOverride === false ? ' · needs approval' : ''}
                      </div>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <Link href="/chat" className="btn sm">Open chat</Link>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        if (!confirm(`Clear all memory for ${active.contact.name}?`)) return;
                        const res = await api.del<{ deleted: number }>(`/api/conversations/${active.id}/memory`);
                        if (res.ok) {
                          setMemories([]);
                          await loadConversations();
                          push({ kind: 'ok', title: 'Memory cleared', message: `${res.data.deleted} items removed.` });
                        }
                      }}
                    >
                      Clear memory
                    </Button>
                  </div>
                </div>

                <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <input type="search" placeholder="Search facts…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 300 }} />
                  <div className="tabs">
                    {(['all', 'user', 'ai'] as const).map((f) => (
                      <button key={f} className={`tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
                        {f === 'all' ? 'All' : f === 'user' ? 'I added' : 'AI learned'}
                      </button>
                    ))}
                  </div>
                  <div className="spacer grow" />
                  <span className="tiny muted">{filtered.length} shown</span>
                </div>
              </Card>

              <Card className="mb-14 tight">
                <div className="row" style={{ gap: 9, alignItems: 'flex-end' }}>
                  <div style={{ width: 170 }}>
                    <Field label="Kind">
                      <select value={newKind} onChange={(e) => setNewKind(e.target.value)}>
                        <option value="fact">Fact</option>
                        <option value="preference">Preference</option>
                        <option value="important_date">Important date</option>
                        <option value="taboo">Do not mention</option>
                        <option value="note">Note</option>
                      </select>
                    </Field>
                  </div>
                  <div style={{ flex: 1 }}>
                    <Field label="Something the copilot should always know">
                      <input
                        type="text"
                        placeholder="e.g. She is allergic to peanuts. Never suggest that restaurant."
                        value={newValue}
                        onChange={(e) => setNewValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && add()}
                      />
                    </Field>
                  </div>
                  <Button variant="primary" onClick={add} disabled={!newValue.trim()} style={{ marginBottom: 14 }}>
                    + Remember
                  </Button>
                </div>
              </Card>

              {filtered.length === 0 ? (
                <Card><Empty icon="🗒" title="No facts here" hint="Add one above, or they will accumulate automatically as you chat." /></Card>
              ) : (
                <div className="grid cols-2">
                  {filtered.map((m) => (
                    <div className={`mem-item ${m.pinned ? 'pinned' : ''}`} key={m.id} style={{ marginBottom: 0 }}>
                      <div className="mem-head">
                        <span className={`mem-kind ${m.kind}`}>{m.kind.replace('_', ' ')}</span>
                        {m.label ? <span className="tiny muted">{m.label}</span> : null}
                        <span className="tiny muted" style={{ marginLeft: 'auto' }}>{'★'.repeat(m.importance)}</span>
                      </div>

                      {editing === m.id ? (
                        <textarea value={draftValue} onChange={(e) => setDraftValue(e.target.value)} style={{ minHeight: 70 }} autoFocus />
                      ) : (
                        <div className="mem-value">{m.value}</div>
                      )}

                      <div className="mem-foot">
                        <Pill tone={KIND_TONE[m.kind] ?? 'default'}>{m.source === 'ai' ? 'learned by AI' : 'added by you'}</Pill>
                        <span className="tiny">{timeAgo(m.createdAt)}</span>
                        <div className="grow" />
                        <div className="row" style={{ gap: 2 }}>
                          <button className="btn ghost sm" title={m.pinned ? 'Unpin' : 'Pin'} onClick={() => update(m.id, { pinned: !m.pinned })}>
                            {m.pinned ? '📌' : '📍'}
                          </button>
                          {editing === m.id ? (
                            <>
                              <button
                                className="btn ghost sm"
                                onClick={async () => {
                                  await update(m.id, { value: draftValue });
                                  setEditing(null);
                                }}
                              >
                                ✓
                              </button>
                              <button className="btn ghost sm" onClick={() => setEditing(null)}>✕</button>
                            </>
                          ) : (
                            <button
                              className="btn ghost sm"
                              onClick={() => {
                                setEditing(m.id);
                                setDraftValue(m.value);
                              }}
                            >
                              ✎
                            </button>
                          )}
                          <button className="btn ghost sm" title="Forget this" onClick={() => remove(m.id)}>🗑</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <Card className="mt-14">
                <div className="row between">
                  <div>
                    <div className="card-title mb-0">Bulk privacy actions</div>
                    <div className="small muted mt-8">
                      Delete memory for every contact, or wipe all conversation data. Per-chat controls live in the chat side panel.
                    </div>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <Button
                      size="sm"
                      onClick={async () => {
                        if (!confirm('Delete memory for ALL contacts?')) return;
                        const res = await api.post<{ deleted: Record<string, number> }>('/api/privacy/purge', { scope: 'memory' });
                        if (res.ok) {
                          setMemories([]);
                          await loadConversations();
                          push({ kind: 'warn', title: 'All memory deleted', message: `${res.data.deleted.memory} items removed.` });
                        }
                      }}
                    >
                      Delete all memory
                    </Button>
                    <Link href="/settings" className="btn sm">More in Settings</Link>
                  </div>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
