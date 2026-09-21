'use client';

import { useEffect, useState } from 'react';
import { Button, Spinner, useToast } from '@/components/ui';
import { api, ReplyOption } from '@/lib/client-api';

interface Props {
  reply: ReplyOption;
  /** approve = queue + send (or hand to Autopilot) */
  onApprove: (reply: ReplyOption, editedBody?: string) => Promise<void>;
  onRegenerate: (reply: ReplyOption) => Promise<void>;
  onDiscard: (reply: ReplyOption) => Promise<void>;
  disabled?: boolean;
}

/**
 * One draft. Implements the four required actions — Edit, Regenerate, Copy,
 * Approve — plus discard, so nothing is ever sent without a decision.
 */
export function ReplyCard({ reply, onApprove, onRegenerate, onDiscard, disabled }: Props) {
  const [body, setBody] = useState(reply.body);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'approve' | 'regen' | 'save' | null>(null);
  const [copied, setCopied] = useState(false);
  const { push } = useToast();

  useEffect(() => setBody(reply.body), [reply.body, reply.id]);

  const dirty = body.trim() !== reply.body.trim();
  const sent = reply.status === 'sent';
  const approved = reply.status === 'approved';

  const save = async () => {
    setBusy('save');
    const res = await api.patch<{ ok: boolean }>(`/api/replies/${reply.id}`, { action: 'edit', body });
    setBusy(null);
    if (!res.ok) {
      push({ kind: 'err', title: 'Could not save edit', message: res.data.error });
      return;
    }
    setEditing(false);
    push({ kind: 'ok', title: 'Edit saved', message: 'The draft is updated — send it when you are ready.' });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      push({ kind: 'err', title: 'Clipboard blocked', message: 'Select the text and copy manually.' });
    }
  };

  const approve = async () => {
    setBusy('approve');
    try {
      await onApprove(reply, dirty ? body : undefined);
    } finally {
      setBusy(null);
    }
  };

  const regen = async () => {
    setBusy('regen');
    try {
      await onRegenerate(reply);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`reply-card ${reply.style}`}>
      <div className="head">
        <span className={`style-chip s-${reply.style}`}>{reply.label}</span>
        {reply.style === 'suggested' ? <span className="tiny muted">best pick</span> : null}
        {sent ? <span className="pill ok" style={{ marginLeft: 'auto', fontSize: 10.5, padding: '2px 8px' }}>sent</span> : null}
        {!sent && approved ? <span className="pill info" style={{ marginLeft: 'auto', fontSize: 10.5, padding: '2px 8px' }}>approved</span> : null}
      </div>

      {editing ? (
        <textarea value={body} onChange={(e) => setBody(e.target.value)} autoFocus />
      ) : (
        <div className="body">{body}</div>
      )}

      <div className="actions">
        {editing ? (
          <>
            <Button size="sm" variant="primary" loading={busy === 'save'} onClick={save} disabled={!body.trim()}>
              Save edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setBody(reply.body);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="primary" onClick={approve} loading={busy === 'approve'} disabled={disabled || sent}>
              {sent ? 'Sent' : '✓ Approve & send'}
            </Button>
            <Button size="sm" onClick={() => setEditing(true)} disabled={disabled}>
              ✎ Edit
            </Button>
            <Button size="sm" onClick={regen} loading={busy === 'regen'} disabled={disabled} title="Ask the model for a different angle">
              ↻ Regenerate
            </Button>
            <Button size="sm" onClick={copy} disabled={disabled}>
              {copied ? '✓ Copied' : '⧉ Copy'}
            </Button>
            {!sent ? (
              <Button size="sm" variant="ghost" onClick={() => onDiscard(reply)} disabled={disabled} title="Throw this draft away">
                ✕
              </Button>
            ) : null}
          </>
        )}
      </div>

      {dirty && !editing ? (
        <div className="tiny muted row" style={{ gap: 6 }}>
          <Spinner size={10} /> edited — approving will send your version
        </div>
      ) : null}
    </div>
  );
}
