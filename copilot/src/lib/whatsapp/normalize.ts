import { NormalizedWebhook, NormalizedInboundMessage, NormalizedStatusUpdate } from './types';

/**
 * Message normalization layer.
 *
 * Meta's Cloud API nests everything under entry[].changes[].value. This
 * module flattens that into our internal shape so route handlers, the queue
 * and the UI never depend on vendor JSON.
 */
export function normalizeWebhook(payload: unknown): NormalizedWebhook {
  const out: NormalizedWebhook = {
    source: 'whatsapp',
    messages: [],
    statuses: [],
    eventType: 'unknown',
  };

  const body = payload as {
    object?: string;
    entry?: {
      id?: string;
      changes?: {
        field?: string;
        value?: {
          metadata?: { phone_number_id?: string; display_phone_number?: string };
          contacts?: { profile?: { name?: string }; wa_id?: string }[];
          messages?: Record<string, unknown>[];
          statuses?: Record<string, unknown>[];
        };
      }[];
    }[];
  };

  if (!body?.entry) return out;
  out.eventType = body.object ?? 'unknown';

  for (const entry of body.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;
      out.phoneNumberId = value.metadata?.phone_number_id ?? out.phoneNumberId;

      const contactNames = new Map<string, string>();
      for (const c of value.contacts ?? []) {
        if (c.wa_id) contactNames.set(c.wa_id, c.profile?.name ?? c.wa_id);
      }

      for (const msg of value.messages ?? []) {
        const normalized = normalizeMessage(msg, contactNames);
        if (normalized) out.messages.push(normalized);
      }

      for (const st of value.statuses ?? []) {
        const normalized = normalizeStatus(st);
        if (normalized) out.statuses.push(normalized);
      }
    }
  }

  if (out.messages.length && out.statuses.length) out.eventType = 'messages+statuses';
  else if (out.messages.length) out.eventType = 'messages';
  else if (out.statuses.length) out.eventType = 'statuses';

  return out;
}

function normalizeMessage(
  msg: Record<string, unknown>,
  contactNames: Map<string, string>,
): NormalizedInboundMessage | null {
  const from = String(msg.from ?? '');
  if (!from) return null;

  const type = String(msg.type ?? 'unsupported');
  const supported = ['text', 'image', 'audio', 'video', 'document', 'sticker', 'location'];
  const kind = (supported.includes(type) ? type : 'unsupported') as NormalizedInboundMessage['type'];

  let text = '';
  let mediaId: string | undefined;
  let mediaUrl: string | undefined;

  if (type === 'text') {
    text = String((msg.text as { body?: string } | undefined)?.body ?? '');
  } else if (type === 'button') {
    text = String((msg.button as { text?: string } | undefined)?.text ?? '');
  } else if (type === 'interactive') {
    const interactive = msg.interactive as
      | { button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } }
      | undefined;
    text =
      interactive?.button_reply?.title ??
      interactive?.list_reply?.title ??
      '';
  } else if (type === 'location') {
    const loc = msg.location as { latitude?: number; longitude?: number; name?: string } | undefined;
    text = `📍 Shared location${loc?.name ? `: ${loc.name}` : ''} (${loc?.latitude ?? '?'}, ${loc?.longitude ?? '?'})`;
  } else if (type === 'reaction') {
    const r = msg.reaction as { emoji?: string; message_id?: string } | undefined;
    text = `${r?.emoji ?? '👍'} (reaction)`;
  } else if (type === 'image' || type === 'audio' || type === 'video' || type === 'document' || type === 'sticker') {
    const media = msg[type] as { id?: string; link?: string; caption?: string; filename?: string } | undefined;
    mediaId = media?.id;
    mediaUrl = media?.link;
    text =
      media?.caption ||
      (type === 'document' ? `📄 ${media?.filename ?? 'Document'}` : `[${type}]`);
  }

  const ts = Number(msg.timestamp ?? 0);

  return {
    waMessageId: String(msg.id ?? `sim-${Date.now()}`),
    from,
    profileName: contactNames.get(from),
    type: kind,
    text,
    mediaId,
    mediaUrl,
    timestamp: ts ? new Date(ts * 1000) : new Date(),
    interactiveReplyId:
      (msg.interactive as { button_reply?: { id?: string } } | undefined)?.button_reply?.id ??
      undefined,
    raw: msg,
  };
}

function normalizeStatus(st: Record<string, unknown>): NormalizedStatusUpdate | null {
  const waMessageId = String(st.id ?? '');
  if (!waMessageId) return null;
  const ts = Number(st.timestamp ?? 0);
  const errors = st.errors as { title?: string; message?: string }[] | undefined;
  return {
    waMessageId,
    status: String(st.status ?? 'sent') as NormalizedStatusUpdate['status'],
    recipient: String(st.recipient_id ?? ''),
    timestamp: ts ? new Date(ts * 1000) : new Date(),
    error: errors?.length ? errors.map((e) => e.title ?? e.message).join(', ') : undefined,
  };
}

/** Phone → digits only, so "+91 98765 43210" and "919876543210" match. */
export function normalizePhone(input: string): string {
  return (input || '').replace(/[^\d]/g, '');
}

/** Pretty-print for display. */
export function formatPhone(digits: string): string {
  const d = normalizePhone(digits);
  if (d.length > 10) return `+${d.slice(0, d.length - 10)} ${d.slice(-10, -5)} ${d.slice(-5)}`;
  return `+${d}`;
}
