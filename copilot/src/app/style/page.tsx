'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Field, Pill, Slider, Switch, Spinner, useToast } from '@/components/ui';
import { api } from '@/lib/client-api';

interface Profile {
  displayName: string;
  preferredLanguage: 'English' | 'Hindi' | 'Hinglish';
  typicalLength: 'very-short' | 'short' | 'medium' | 'long';
  formalityLevel: number;
  humorLevel: number;
  flirtinessLevel: number;
  confidenceLevel: number;
  emojiUsage: 'none' | 'rare' | 'moderate' | 'heavy';
  commonPhrases: string;
  avoidPhrases: string;
  interests: string;
  communicationPrefs: string;
  trainingSamples: string;
  trainingSampleCount: number;
  signature: string;
  updatedAt: string;
}

const PRESETS = {
  'Flirty & confident': { flirtinessLevel: 8, confidenceLevel: 9, humorLevel: 8, formalityLevel: 2, emojiUsage: 'moderate' as const },
  'Warm & grounded': { flirtinessLevel: 3, confidenceLevel: 6, humorLevel: 5, formalityLevel: 4, emojiUsage: 'moderate' as const },
  'Dry & witty': { flirtinessLevel: 4, confidenceLevel: 8, humorLevel: 9, formalityLevel: 3, emojiUsage: 'rare' as const },
  'Short & unbothered': { flirtinessLevel: 5, confidenceLevel: 8, humorLevel: 6, formalityLevel: 2, emojiUsage: 'none' as const },
};

export default function StylePage() {
  const [p, setP] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ prompt: string; contact?: string; chars: number; approxTokens: number } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importMine, setImportMine] = useState(true);
  const { push } = useToast();

  const load = useCallback(async () => {
    const res = await api.get<{ profile: Profile }>('/api/style');
    if (res.ok) setP(res.data.profile);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch?: Partial<Profile>) => {
    if (!p) return;
    setSaving(true);
    const res = await api.put<{ profile: Profile }>('/api/style', { ...p, ...patch });
    setSaving(false);
    if (!res.ok) {
      push({ kind: 'err', title: 'Save failed', message: res.data.error });
      return;
    }
    setP(res.data.profile);
  };

  const loadPreview = async () => {
    setShowPreview(true);
    const res = await api.get<{ prompt: string; contact?: string; chars: number; approxTokens: number }>('/api/style/preview');
    if (res.ok) setPreview(res.data);
  };

  /** Paste a WhatsApp export and extract only *your* lines as writing samples. */
  const importSamples = async () => {
    const lines = importText.split('\n');
    const mine: string[] = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      // WhatsApp export formats: "[12/03/24, 9:41:07 PM] Name: message" or "12/03/24, 21:41 - Name: message"
      const m = line.match(/^\[?[\d/.]+,\s*[\d:apm\s.]+\]?\s*[-–]?\s*([^:]{1,40}):\s*(.+)$/i);
      if (m) {
        const speaker = m[1].trim().toLowerCase();
        const text = m[2].trim();
        const isMe = importMine ? speaker === (p?.displayName || 'me').toLowerCase() || /^me$|^you$/.test(speaker) : /^me$|^you$/.test(speaker);
        if ((importMine && isMe) || (!importMine && !isMe)) mine.push(text);
      } else if (!/^[\d/.]+,\s*[\d:]+/.test(line) && !line.startsWith('‎')) {
        mine.push(line); // raw pasted messages with no export formatting
      }
    }
    const cleaned = [...new Set(mine)]
      .filter((l) => l.length > 1 && l.length < 220 && !/^(<Media omitted>|image omitted|audio omitted|sticker omitted)$/i.test(l))
      .slice(0, 200);

    if (!cleaned.length) {
      push({ kind: 'warn', title: 'Nothing to import', message: 'Paste a WhatsApp export or plain lines of your own messages.' });
      return;
    }
    const merged = [p?.trainingSamples ?? '', ...cleaned].filter(Boolean).join('\n').split('\n').slice(0, 200).join('\n');
    await save({ trainingSamples: merged });
    setImportOpen(false);
    setImportText('');
    push({ kind: 'ok', title: `${cleaned.length} samples imported`, message: 'The model now has your real phrasing to imitate.' });
  };

  if (!p) {
    return <div className="page"><div className="skeleton" style={{ height: 420 }} /></div>;
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>My style profile</h2>
          <p>
            This is the personality the copilot writes with. It is injected into every system prompt — the more honest this
            is, the less the drafts sound like a robot.
          </p>
        </div>
        <div className="spacer" />
        {saving ? <Pill tone="info"><Spinner size={11} /> saving…</Pill> : <Pill tone="ok">saved</Pill>}
        <Button size="sm" onClick={loadPreview}>👁 See what the AI sees</Button>
        <Button size="sm" variant="primary" onClick={() => save()} loading={saving}>Save profile</Button>
      </div>

      {showPreview ? (
        <Card className="mb-14">
          <div className="row between mb-8">
            <div className="card-title mb-0">System prompt preview {preview?.contact ? `· ${preview.contact}` : ''}</div>
            <div className="row" style={{ gap: 8 }}>
              {preview ? <span className="tiny muted">{preview.chars} chars ≈ {preview.approxTokens} tokens</span> : <Spinner />}
              <Button size="sm" variant="ghost" onClick={() => setShowPreview(false)}>✕</Button>
            </div>
          </div>
          <div className="code-block" style={{ maxHeight: 340, overflow: 'auto' }}>{preview?.prompt ?? 'Building…'}</div>
          <div className="tiny muted mt-8">
            This is exactly what gets sent to your configured provider along with the incoming message. Nothing else about
            you leaves the server.
          </div>
        </Card>
      ) : null}

      <div className="grid cols-2">
        <Card>
          <div className="card-title">Language & rhythm</div>

          <Field label="Preferred language">
            <select value={p.preferredLanguage} onChange={(e) => save({ preferredLanguage: e.target.value as Profile['preferredLanguage'] })}>
              <option value="English">English</option>
              <option value="Hindi">Hindi (Devanagari)</option>
              <option value="Hinglish">Hinglish (Roman-script Hindi + English)</option>
            </select>
          </Field>

          <Field label="Typical message length">
            <select value={p.typicalLength} onChange={(e) => save({ typicalLength: e.target.value as Profile['typicalLength'] })}>
              <option value="very-short">Very short — one line, few words</option>
              <option value="short">Short — one or two lines</option>
              <option value="medium">Medium — a couple of sentences</option>
              <option value="long">Long — I actually write paragraphs</option>
            </select>
          </Field>

          <Field label="Emoji usage">
            <select value={p.emojiUsage} onChange={(e) => save({ emojiUsage: e.target.value as Profile['emojiUsage'] })}>
              <option value="none">None — I never use emojis</option>
              <option value="rare">Rare — occasionally, one max</option>
              <option value="moderate">Moderate — where it adds feeling</option>
              <option value="heavy">Heavy — emojis are punctuation for me</option>
            </select>
          </Field>

          <Field label="How I sign off (optional)">
            <input
              type="text"
              value={p.signature}
              placeholder="e.g. — A, or a nickname only close people use"
              onChange={(e) => setP({ ...p, signature: e.target.value })}
              onBlur={() => save({ signature: p.signature })}
            />
          </Field>

          <hr className="sep" />
          <div className="card-title">Vibe presets</div>
          <div className="row wrap" style={{ gap: 8 }}>
            {Object.entries(PRESETS).map(([name, preset]) => (
              <Button key={name} size="sm" onClick={() => save(preset)}>{name}</Button>
            ))}
          </div>
          <div className="tiny muted mt-8">Tap a preset to jump the dials, then fine-tune below.</div>
        </Card>

        <Card>
          <div className="card-title">Tone dials</div>
          <Slider
            label="Formality"
            value={p.formalityLevel}
            min={1}
            max={10}
            ticks={['slang', 'casual', 'relaxed', 'polite', 'formal']}
            onChange={(v) => setP({ ...p, formalityLevel: v })}
          />
          <Slider
            label="Humour"
            value={p.humorLevel}
            min={1}
            max={10}
            ticks={['serious', 'dry', 'some', 'witty', 'funny']}
            onChange={(v) => setP({ ...p, humorLevel: v })}
          />
          <Slider
            label="Flirtiness"
            value={p.flirtinessLevel}
            min={1}
            max={10}
            ticks={['platonic', 'friendly', 'teasing', 'flirty', 'openly flirty']}
            onChange={(v) => setP({ ...p, flirtinessLevel: v })}
          />
          <Slider
            label="Confidence"
            value={p.confidenceLevel}
            min={1}
            max={10}
            ticks={['hesitant', 'gentle', 'balanced', 'assertive', 'bold']}
            onChange={(v) => setP({ ...p, confidenceLevel: v })}
          />
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" variant="primary" onClick={() => save({
              formalityLevel: p.formalityLevel,
              humorLevel: p.humorLevel,
              flirtinessLevel: p.flirtinessLevel,
              confidenceLevel: p.confidenceLevel,
            })} loading={saving}>
              Save dials
            </Button>
            <span className="tiny muted">Confidence removes hedging words; flirtiness adds teasing and warmth.</span>
          </div>
        </Card>

        <Card>
          <div className="card-title">Phrases & boundaries</div>
          <Field label="Phrases I actually use" hint="One per line. Used as a palette — never all at once.">
            <textarea
              value={p.commonPhrases}
              placeholder={'bhai ye scene kya hai\nhaan chal\nI am in for anything\ndekhte hain'}
              onChange={(e) => setP({ ...p, commonPhrases: e.target.value })}
              onBlur={() => save({ commonPhrases: p.commonPhrases })}
              style={{ minHeight: 110 }}
            />
          </Field>
          <Field label="Things I should avoid saying" hint="Hard constraint — the model is told never to use these.">
            <textarea
              value={p.avoidPhrases}
              placeholder={'I hope this message finds you well\nkindly\nAs an AI language model\nbrb'}
              onChange={(e) => setP({ ...p, avoidPhrases: e.target.value })}
              onBlur={() => save({ avoidPhrases: p.avoidPhrases })}
              style={{ minHeight: 110 }}
            />
          </Field>
          <Field label="My interests" hint="The model bridges to these when it fits naturally.">
            <textarea
              value={p.interests}
              placeholder={'climbing\nfilm photography\nindie music\nstreet food'}
              onChange={(e) => setP({ ...p, interests: e.target.value })}
              onBlur={() => save({ interests: p.interests })}
              style={{ minHeight: 90 }}
            />
          </Field>
        </Card>

        <Card>
          <div className="card-title">Communication preferences</div>
          <Field label="Rules the copilot must follow" hint="One per line. These become explicit instructions in the system prompt.">
            <textarea
              value={p.communicationPrefs}
              placeholder={'Keep replies under 15 words\nNever double text\nOne question max per reply\nMatch their energy'}
              onChange={(e) => setP({ ...p, communicationPrefs: e.target.value })}
              onBlur={() => save({ communicationPrefs: p.communicationPrefs })}
              style={{ minHeight: 130 }}
            />
          </Field>

          <hr className="sep" />
          <div className="row between mb-8">
            <div className="card-title mb-0">My conversation data (training samples)</div>
            <Pill tone={p.trainingSampleCount ? 'ok' : 'warn'}>{p.trainingSampleCount} samples</Pill>
          </div>
          <div className="small muted mb-8">
            Paste real messages you have sent. The model learns your actual rhythm, slang and sentence length from these —
            far more effective than any slider.
          </div>
          <textarea
            value={p.trainingSamples}
            placeholder={'haan chal, dekhte hain kya hota hai\nok that’s actually a good idea, when?\nyou say that like it’s a bad thing 😏'}
            onChange={(e) => setP({ ...p, trainingSamples: e.target.value })}
            onBlur={() => save({ trainingSamples: p.trainingSamples })}
            style={{ minHeight: 150 }}
          />
          <div className="row mt-8" style={{ gap: 8 }}>
            <Button size="sm" variant="primary" onClick={() => save({ trainingSamples: p.trainingSamples })} loading={saving}>
              Save samples
            </Button>
            <Button size="sm" onClick={() => setImportOpen((o) => !o)}>📥 Import from chat export</Button>
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                if (!confirm('Delete all training samples?')) return;
                const res = await api.del<{ profile: Profile }>('/api/style');
                if (res.ok) {
                  setP(res.data.profile);
                  push({ kind: 'ok', title: 'Samples cleared' });
                }
              }}
            >
              Clear
            </Button>
          </div>

          {importOpen ? (
            <div className="card tight mt-14" style={{ background: 'var(--panel-2)' }}>
              <div className="row between mb-8">
                <strong className="small">Paste a WhatsApp export</strong>
                <label className="switch">
                  <input type="checkbox" checked={importMine} onChange={(e) => setImportMine(e.target.checked)} />
                  <span className="track" />
                  <span className="lbl tiny">{importMine ? 'my messages' : 'their messages'}</span>
                </label>
              </div>
              <div className="tiny muted mb-8">
                In WhatsApp: open a chat → ⋮ → More → Export chat → without media. Paste the text here. Lines are parsed
                and de-duplicated; media placeholders are dropped.
              </div>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={'[12/03/24, 9:41:07 PM] Me: haan chal\n[12/03/24, 9:41:30 PM] Aisha: ok 10am\n…paste hundreds of lines…'}
                style={{ minHeight: 160, fontFamily: 'var(--mono)', fontSize: 12 }}
              />
              <div className="row mt-8" style={{ gap: 8 }}>
                <Button size="sm" variant="primary" onClick={importSamples}>Extract & add</Button>
                <Button size="sm" variant="ghost" onClick={() => setImportOpen(false)}>Cancel</Button>
              </div>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
