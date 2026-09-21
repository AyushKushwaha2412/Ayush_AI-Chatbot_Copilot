'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useCopilot } from '@/components/AppShell';
import { Button, Card, Field, Pill, Switch, Slider, timeAgo, useToast, Spinner } from '@/components/ui';
import { api } from '@/lib/client-api';

interface Settings {
  provider: 'ollama' | 'openai' | 'mock' | 'auto';
  fallbackEnabled: boolean;
  ollamaBaseUrl: string;
  ollamaModel: string;
  openaiBaseUrl: string;
  openaiModel: string;
  openaiApiKeySet: boolean;
  openaiApiKeyMasked: string | null;
  openaiApiKeyFromEnv: boolean;
  temperature: number;
  maxTokens: number;
  suggestionCount: number;
  requestTimeoutMs: number;
  systemPromptExtra: string;
  autoSend: boolean;
  updatedAt: string;
}

interface WhatsAppStatus {
  mode: string;
  liveReady: boolean;
  credentialsPresent: { phoneNumberId: boolean; accessToken: boolean; appSecret: boolean; verifyToken: boolean };
  webhookUrlHint: string;
  graphBase: string;
  notes: string[];
  queue: { queued: number; sending: number; sent: number; failed: number; cancelled: number };
  counts: { inbound: number; outbound: number; webhookEvents: number };
  liveCheck: { ok: boolean; message: string } | null;
  recentEvents: { id: string; eventType: string; signatureValid: boolean | null; processed: boolean; createdAt: string }[];
}

export default function SettingsPage() {
  const { refresh } = useCopilot();
  const { push } = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [wa, setWa] = useState<WhatsAppStatus | null>(null);
  const [queue, setQueue] = useState<{ id: string; to: string; contactName: string; body: string; status: string; mode: string; attempts: number; lastError: string | null; createdAt: string }[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<{ id: string; family?: string | null }[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [checking, setChecking] = useState(false);
  const [tab, setTab] = useState<'ai' | 'whatsapp' | 'security'>('ai');

  const load = useCallback(async () => {
    const [sRes, wRes, qRes] = await Promise.all([
      api.get<{ settings: Settings }>('/api/ai/settings'),
      api.get<WhatsAppStatus>('/api/whatsapp/status'),
      api.get<{ items: typeof queue }>('/api/whatsapp/queue'),
    ]);
    if (sRes.ok) setS(sRes.data.settings);
    if (wRes.ok) setWa(wRes.data);
    if (qRes.ok) setQueue(qRes.data.items ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: Partial<Settings> & { openaiApiKey?: string }) => {
    setSaving(true);
    const res = await api.put<{ settings: Settings }>('/api/ai/settings', patch);
    setSaving(false);
    if (!res.ok) {
      push({ kind: 'err', title: 'Save failed', message: res.data.error });
      return false;
    }
    setS(res.data.settings);
    await refresh();
    return true;
  };

  const loadModels = async () => {
    if (!s) return;
    setLoadingModels(true);
    const res = await api.post<{ models: { id: string }[]; message: string }>('/api/ai/settings', {
      provider: s.provider === 'auto' ? 'ollama' : s.provider,
      baseUrl: s.provider === 'openai' ? s.openaiBaseUrl : s.ollamaBaseUrl,
    });
    setModels(res.data.models ?? []);
    setLoadingModels(false);
    push({
      kind: res.data.models?.length ? 'ok' : 'warn',
      title: res.data.models?.length ? `${res.data.models.length} models found` : 'No models found',
      message: res.data.message,
    });
  };

  const testWhatsApp = async () => {
    setChecking(true);
    const res = await api.get<WhatsAppStatus>('/api/whatsapp/status?test=1');
    setChecking(false);
    if (res.ok) {
      setWa(res.data);
      const check = res.data.liveCheck;
      push({
        kind: check?.ok ? 'ok' : 'warn',
        title: check?.ok ? 'WhatsApp connected' : 'WhatsApp not live',
        message: check?.message,
      });
    }
  };

  const drainQueue = async () => {
    const res = await api.post<{ sent: number; failed: number }>('/api/whatsapp/queue', { limit: 25 });
    if (res.ok) {
      push({ kind: 'ok', title: 'Queue processed', message: `${res.data.sent} sent · ${res.data.failed} failed` });
      await load();
    }
  };

  const cancel = async (id: string) => {
    const res = await api.post(`/api/whatsapp/queue/${id}`, { action: 'cancel' });
    if (res.ok) {
      push({ kind: 'ok', title: 'Message cancelled' });
      await load();
    } else {
      push({ kind: 'err', title: 'Could not cancel', message: res.data.error });
    }
  };

  const retry = async (id: string) => {
    const res = await api.post(`/api/whatsapp/queue/${id}`, { action: 'retry' });
    if (res.ok) {
      push({ kind: 'ok', title: 'Retry queued' });
      await load();
    } else {
      push({ kind: 'err', title: 'Could not retry', message: res.data.error });
    }
  };

  if (!s) {
    return <div className="page"><div className="skeleton" style={{ height: 300 }} /></div>;
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>Settings</h2>
          <p>
            Provider configuration, WhatsApp integration and privacy controls. Credentials are stored server-side and are
            never sent to the browser.
          </p>
        </div>
        <div className="spacer" />
        {saving ? <Pill tone="info"><Spinner size={11} /> saving…</Pill> : <Pill>saved {timeAgo(s.updatedAt)}</Pill>}
      </div>

      <div className="tabs mb-14">
        <button className={`tab ${tab === 'ai' ? 'active' : ''}`} onClick={() => setTab('ai')}>AI provider</button>
        <button className={`tab ${tab === 'whatsapp' ? 'active' : ''}`} onClick={() => setTab('whatsapp')}>WhatsApp</button>
        <button className={`tab ${tab === 'security' ? 'active' : ''}`} onClick={() => setTab('security')}>Security & privacy</button>
      </div>

      {tab === 'ai' ? (
        <div className="grid cols-2">
          <Card>
            <div className="card-title">Provider</div>

            <Field
              label="Which provider should draft replies?"
              hint="Ollama = fully local. Remote = any OpenAI-compatible endpoint. Auto = try remote first, then Ollama."
            >
              <select value={s.provider} onChange={(e) => void save({ provider: e.target.value as Settings['provider'] })}>
                <option value="ollama">Local — Ollama (recommended, private)</option>
                <option value="openai">Remote — OpenAI-compatible API</option>
                <option value="auto">Auto — remote if configured, else Ollama</option>
                <option value="mock">Built-in offline drafter (no model needed)</option>
              </select>
            </Field>

            <div className="row between mb-14">
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Fallback when unreachable</div>
                <div className="tiny muted">Keep drafting even if the model is offline (uses the offline drafter).</div>
              </div>
              <Switch checked={s.fallbackEnabled} onChange={(v) => void save({ fallbackEnabled: v })} label="" />
            </div>

            <div className="row between">
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>Global reply mode</div>
                <div className="tiny muted">
                  {s.autoSend ? 'Autopilot: sends the top suggestion automatically.' : 'Copilot: waits for your approval.'}
                </div>
              </div>
              <Switch checked={s.autoSend} onChange={(v) => void save({ autoSend: v })} label="" />
            </div>

            <hr className="sep" />
            <Field label="Extra house rules (appended to every system prompt)" hint="e.g. “Never use exclamation marks. Keep replies under 12 words.”">
              <textarea
                value={s.systemPromptExtra}
                onChange={(e) => setS({ ...s, systemPromptExtra: e.target.value })}
                onBlur={() => void save({ systemPromptExtra: s.systemPromptExtra })}
                placeholder="Optional rules the model must always follow"
              />
            </Field>
          </Card>

          <Card>
            <div className="card-title">Local — Ollama</div>
            <Field label="Endpoint (OpenAI-compatible base URL)">
              <input
                type="text"
                value={s.ollamaBaseUrl}
                onChange={(e) => setS({ ...s, ollamaBaseUrl: e.target.value })}
                onBlur={() => void save({ ollamaBaseUrl: s.ollamaBaseUrl })}
                placeholder="http://localhost:11434/v1"
              />
            </Field>
            <Field label="Model" hint="Default example: qwen3:8b. Pull it first with: ollama pull qwen3:8b">
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="text"
                  value={s.ollamaModel}
                  onChange={(e) => setS({ ...s, ollamaModel: e.target.value })}
                  onBlur={() => void save({ ollamaModel: s.ollamaModel })}
                  list="ollama-models"
                />
                <datalist id="ollama-models">
                  {models.map((m) => <option key={m.id} value={m.id} />)}
                </datalist>
                <Button size="sm" onClick={loadModels} loading={loadingModels}>List</Button>
              </div>
            </Field>

            <div className="code-block mb-14">
{`# run the local model server
ollama serve
ollama pull ${s.ollamaModel || 'qwen3:8b'}`}
            </div>

            <hr className="sep" />
            <div className="card-title">Remote — OpenAI-compatible</div>

            <Field label="Base URL" hint="OpenAI, Groq, OpenRouter, vLLM, LM Studio… anything that speaks /chat/completions.">
              <input
                type="text"
                value={s.openaiBaseUrl}
                onChange={(e) => setS({ ...s, openaiBaseUrl: e.target.value })}
                onBlur={() => void save({ openaiBaseUrl: s.openaiBaseUrl })}
              />
            </Field>

            <Field label="Model">
              <input
                type="text"
                value={s.openaiModel}
                onChange={(e) => setS({ ...s, openaiModel: e.target.value })}
                onBlur={() => void save({ openaiModel: s.openaiModel })}
                list="remote-models"
              />
              <datalist id="remote-models">{models.map((m) => <option key={m.id} value={m.id} />)}</datalist>
            </Field>

            <Field
              label="API key"
              hint={
                s.openaiApiKeySet
                  ? `A key is stored on the server (${s.openaiApiKeyMasked}). Type a new one to replace it, or clear and save to remove it.`
                  : s.openaiApiKeyFromEnv
                    ? 'Using OPENAI_API_KEY from the server environment.'
                    : 'Stored server-side only. Never exposed to the browser.'
              }
            >
              <div className="row" style={{ gap: 8 }}>
                <input
                  type="password"
                  value={apiKey}
                  placeholder={s.openaiApiKeySet ? '•••••••••••• (stored)' : 'sk-…'}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                />
                <Button
                  size="sm"
                  onClick={async () => {
                    const done = await save({ openaiApiKey: apiKey || '' });
                    if (done) {
                      setApiKey('');
                      push({ kind: 'ok', title: 'Credentials saved', message: 'Stored server-side; the browser never sees it again.' });
                    }
                  }}
                  loading={saving}
                >
                  Save
                </Button>
                <Button size="sm" variant="danger" onClick={async () => { await save({ openaiApiKey: '' }); push({ kind: 'ok', title: 'Key removed' }); }}>
                  Clear
                </Button>
              </div>
            </Field>

            <Pill tone={s.openaiApiKeySet ? 'ok' : 'warn'}>
              {s.openaiApiKeySet ? 'remote key configured' : 'no remote key — remote provider will refuse'}
            </Pill>
          </Card>

          <Card className="cols-2" style={{ gridColumn: '1 / -1' }}>
            <div className="card-title">Generation tuning</div>
            <div className="grid cols-4">
              <Slider label="Temperature" value={s.temperature} min={0} max={2} onChange={(v) => setS({ ...s, temperature: v })} />
              <Slider
                label="Max tokens"
                value={s.maxTokens}
                min={64}
                max={2000}
                ticks={['very short', 'short', 'medium', 'long', 'very long']}
                onChange={(v) => setS({ ...s, maxTokens: v })}
              />
              <Slider label="Reply options" value={s.suggestionCount} min={1} max={5} onChange={(v) => setS({ ...s, suggestionCount: v })} />
              <Slider
                label="Timeout (ms)"
                value={s.requestTimeoutMs}
                min={5000}
                max={180000}
                ticks={['5s', '45s', '90s', '150s', '3min']}
                onChange={(v) => setS({ ...s, requestTimeoutMs: v })}
              />
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Button variant="primary" size="sm" onClick={() => save({ temperature: s.temperature, maxTokens: s.maxTokens, suggestionCount: s.suggestionCount, requestTimeoutMs: s.requestTimeoutMs })} loading={saving}>
                Save tuning
              </Button>
              <span className="tiny muted">Higher temperature = more playful and unpredictable drafts. 0.85–1.0 works well for chat.</span>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === 'whatsapp' && wa ? (
        <div className="grid cols-2" id="whatsapp">
          <Card>
            <div className="row between mb-14">
              <div className="card-title mb-0">WhatsApp Business Cloud API</div>
              <Pill tone={wa.mode === 'live' ? 'warn' : 'info'}>{wa.mode.toUpperCase()}</Pill>
            </div>

            <div className="small muted mb-14">{wa.notes.join(' ')}</div>

            <table className="data mb-14">
              <tbody>
                <tr><td>Phone number ID</td><td><Pill tone={wa.credentialsPresent.phoneNumberId ? 'ok' : 'bad'}>{wa.credentialsPresent.phoneNumberId ? 'set' : 'missing'}</Pill></td></tr>
                <tr><td>Access token</td><td><Pill tone={wa.credentialsPresent.accessToken ? 'ok' : 'bad'}>{wa.credentialsPresent.accessToken ? 'set' : 'missing'}</Pill></td></tr>
                <tr><td>App secret (webhook signatures)</td><td><Pill tone={wa.credentialsPresent.appSecret ? 'ok' : 'warn'}>{wa.credentialsPresent.appSecret ? 'set' : 'not set'}</Pill></td></tr>
                <tr><td>Verify token</td><td><Pill tone="ok">{wa.credentialsPresent.verifyToken ? 'set' : 'default'}</Pill></td></tr>
              </tbody>
            </table>

            <div className="small muted mb-8">
              Set these in <span className="mono">.env</span> on the server, then restart:
            </div>
            <div className="code-block mb-14">
{`WHATSAPP_MODE="live"            # or "simulated"
WHATSAPP_PHONE_NUMBER_ID="..."
WHATSAPP_ACCESS_TOKEN="..."     # server-side only
WHATSAPP_VERIFY_TOKEN="copilot-verify-token"
WHATSAPP_APP_SECRET="..."       # enables signature checks
WHATSAPP_API_VERSION="v21.0"`}
            </div>

            <div className="row" style={{ gap: 8 }}>
              <Button size="sm" variant="primary" onClick={testWhatsApp} loading={checking}>Test credentials</Button>
              <Button size="sm" onClick={drainQueue}>Process queue now</Button>
            </div>

            {wa.liveCheck ? (
              <div className="mt-14 small" style={{ color: wa.liveCheck.ok ? 'var(--accent)' : 'var(--warn)' }}>
                {wa.liveCheck.message}
              </div>
            ) : null}
          </Card>

          <Card>
            <div className="card-title">Webhook & queue</div>
            <div className="grid cols-2 mb-14">
              <div>
                <div className="tiny muted">Webhook URL (paste into Meta)</div>
                <div className="code-block">{wa.webhookUrlHint}</div>
              </div>
              <div>
                <div className="tiny muted">Graph base</div>
                <div className="code-block">{wa.graphBase}</div>
              </div>
            </div>

            <div className="row wrap mb-14" style={{ gap: 7 }}>
              <Pill tone={wa.queue.queued ? 'warn' : 'ok'}>{wa.queue.queued} queued</Pill>
              <Pill tone="ok">{wa.queue.sent} sent</Pill>
              <Pill tone={wa.queue.failed ? 'bad' : 'ok'}>{wa.queue.failed} failed</Pill>
              <Pill>{wa.counts.inbound} inbound</Pill>
              <Pill>{wa.counts.outbound} outbound</Pill>
              <Pill>{wa.counts.webhookEvents} webhook events</Pill>
            </div>

            <div className="card-title">Outbound queue</div>
            {queue.length === 0 ? (
              <div className="small muted">Nothing queued. Approve a draft in Chat to see the pipeline.</div>
            ) : (
              <table className="data">
                <thead><tr><th>To</th><th>Message</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {queue.slice(0, 10).map((q) => (
                    <tr key={q.id}>
                      <td className="tiny">{q.contactName}</td>
                      <td className="tiny">{q.body.slice(0, 46)}{q.body.length > 46 ? '…' : ''}</td>
                      <td>
                        <Pill tone={q.status === 'sent' ? 'ok' : q.status === 'failed' ? 'bad' : 'warn'}>{q.status}</Pill>
                        {q.attempts > 1 ? <span className="tiny muted"> ×{q.attempts}</span> : null}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          {q.status === 'queued' ? <button className="btn ghost sm" onClick={() => cancel(q.id)}>✕</button> : null}
                          {q.status === 'failed' ? <button className="btn ghost sm" onClick={() => retry(q.id)}>↻</button> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <hr className="sep" />
            <div className="card-title">Recent webhook events</div>
            {wa.recentEvents.length === 0 ? (
              <div className="small muted">No webhook traffic yet.</div>
            ) : (
              wa.recentEvents.slice(0, 6).map((e) => (
                <div className="row between small" key={e.id} style={{ padding: '5px 0' }}>
                  <span className="mono tiny">{e.eventType}</span>
                  <span className="tiny muted">
                    {e.signatureValid === null ? 'unsigned' : e.signatureValid ? 'signature ok' : 'bad signature'} · {timeAgo(e.createdAt)}
                  </span>
                </div>
              ))
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'security' ? (
        <div className="grid cols-2">
          <Card>
            <div className="card-title">How your data is protected</div>
            <ul className="small muted" style={{ lineHeight: 1.8, paddingLeft: 18 }}>
              <li>Provider API keys live in the server env / SQLite file. Read endpoints return only <span className="mono">openaiApiKeySet</span> and a masked hint.</li>
              <li>All AI calls happen in Next.js route handlers. The browser never talks to Ollama or any remote provider directly.</li>
              <li>Inbound webhooks are verified with HMAC-SHA256 when <span className="mono">WHATSAPP_APP_SECRET</span> is set.</li>
              <li>Messages are idempotent by <span className="mono">waMessageId</span>, so provider retries cannot duplicate your threads.</li>
              <li>Simulation mode is the default: outbound messages are recorded locally and nothing leaves the machine.</li>
            </ul>

            <hr className="sep" />
            <div className="card-title">Optional access code</div>
            <div className="small muted mb-8">
              Set <span className="mono">APP_ACCESS_CODE</span> in <span className="mono">.env</span> to require a code before the
              UI will talk to the API. Useful if you ever expose this beyond localhost.
            </div>
            <div className="code-block">APP_ACCESS_CODE="choose-something-long"</div>
          </Card>

          <Card>
            <div className="card-title">Delete my data</div>
            <div className="small muted mb-14">
              Memory and conversations can be deleted per contact from the chat’s right panel, or in bulk here.
            </div>
            <div className="grid" style={{ gap: 8 }}>
              <Button
                size="sm"
                onClick={async () => {
                  const res = await api.post('/api/privacy/purge', { scope: 'memory' });
                  if (res.ok) push({ kind: 'ok', title: 'All memory cleared', message: `${(res.data as { deleted?: number }).deleted ?? 0} items removed.` });
                }}
              >
                🧠 Delete all stored memory (keep chats)
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  const res = await api.post('/api/privacy/purge', { scope: 'drafts' });
                  if (res.ok) push({ kind: 'ok', title: 'All drafts deleted', message: `${(res.data as { deleted?: number }).deleted ?? 0} drafts removed.` });
                }}
              >
                🗒 Delete every generated draft
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  const res = await api.post('/api/privacy/purge', { scope: 'messages' });
                  if (res.ok) push({ kind: 'warn', title: 'All messages deleted', message: `${(res.data as { deleted?: number }).deleted ?? 0} messages removed.` });
                }}
              >
                💬 Delete all messages (keep contacts)
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  if (!confirm('This deletes every conversation, message, memory and draft. The style profile and provider settings are kept. Continue?')) return;
                  const res = await api.post('/api/privacy/purge', { scope: 'everything' });
                  if (res.ok) push({ kind: 'warn', title: 'Everything deleted', message: 'Chat data wiped. Style profile preserved.' });
                }}
              >
                🧨 Wipe all conversation data
              </Button>
            </div>

            <hr className="sep" />
            <div className="card-title">Style training samples</div>
            <div className="small muted mb-8">Remove the past messages you fed in as writing samples.</div>
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                const res = await api.del('/api/style');
                if (res.ok) push({ kind: 'ok', title: 'Style samples cleared' });
              }}
            >
              Clear training samples
            </Button>
          </Card>

          <Card style={{ gridColumn: '1 / -1' }}>
            <div className="card-title">Provider architecture</div>
            <div className="code-block">
{`POST /api/ai/reply
   └─ resolve provider chain (ai_settings)
        ├─ OllamaProvider        → POST {base}/chat/completions   (default: http://localhost:11434/v1)
        ├─ OpenAICompatProvider  → POST {base}/chat/completions   (optional, key server-side)
        └─ MockProvider          → offline template drafter (fallback)

Inbound:  Meta Cloud API ─▶ POST /api/whatsapp/webhook
             normalize.ts → NormalizedInboundMessage → ingest.ts → messages table
             Autopilot? → generate → approve → queue → client.ts → Cloud API

Outbound: approve (UI) ─▶ outbound_message queue ─▶ client.ts ─▶ Cloud API
             mode=simulated → recorded locally, zero network egress`}
            </div>
            <div className="row mt-14" style={{ gap: 8 }}>
              <Link href="/style" className="btn sm">Tune my writing style</Link>
              <Link href="/chat" className="btn primary sm">Open chat workspace</Link>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
