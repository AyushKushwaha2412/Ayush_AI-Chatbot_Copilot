import { prisma } from '@/lib/db';
import { generateReplies, ensureSettings } from '@/lib/ai/reply-service';
import { enqueueOutbound, processQueue } from './queue';
import { normalizePhone } from './normalize';
import { NormalizedInboundMessage } from './types';

const PALETTE = ['#25D366', '#34B7F1', '#8E7CFF', '#FF7A59', '#FFC145', '#4ADE80', '#F472B6'];

export interface IngestResult {
  conversationId: string;
  contactId: string;
  contactName: string;
  messageId: string;
  duplicated: boolean;
  autoPilot: boolean;
  drafted: number;
  autoSentReplyId?: string;
  outboundId?: string;
  generated?: Awaited<ReturnType<typeof generateReplies>>;
}

/**
 * Single entry point for every inbound message, regardless of source
 * (Cloud API webhook, simulation endpoint, or a future bridge).
 *
 * Pipeline: normalize → upsert contact → upsert conversation → store message
 * → (if Autopilot) generate → auto-approve top suggestion → queue → send.
 */
export async function ingestInbound(msg: NormalizedInboundMessage): Promise<IngestResult> {
  const phone = normalizePhone(msg.from);
  const name = msg.profileName?.trim() || phone;

  const contact = await prisma.contact.upsert({
    where: { phoneNumber: phone },
    update: { name, waId: phone },
    create: {
      name,
      phoneNumber: phone,
      waId: phone,
      avatarColor: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    },
  });

  let conversation = await prisma.conversation.findFirst({
    where: { contactId: contact.id, status: 'active' },
    orderBy: { lastMessageAt: 'desc' },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { contactId: contact.id, title: `Chat with ${contact.name}` },
    });
  }

  // idempotency: WhatsApp retries webhooks aggressively
  const existing = await prisma.message.findUnique({ where: { waMessageId: msg.waMessageId } });
  if (existing) {
    return {
      conversationId: conversation.id,
      contactId: contact.id,
      contactName: contact.name,
      messageId: existing.id,
      duplicated: true,
      autoPilot: false,
      drafted: 0,
    };
  }

  const stored = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'inbound',
      sender: 'contact',
      body: msg.text,
      mediaType: msg.type,
      waMessageId: msg.waMessageId,
      status: 'received',
      rawPayload: JSON.stringify(msg.raw).slice(0, 4000),
      createdAt: msg.timestamp,
    },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: msg.timestamp,
      lastMessagePreview: msg.text.slice(0, 140),
      unreadCount: { increment: 1 },
    },
  });

  const settings = await ensureSettings();
  const autoPilot =
    conversation.autoSendOverride === null || conversation.autoSendOverride === undefined
      ? settings.autoSend
      : conversation.autoSendOverride;

  const base: IngestResult = {
    conversationId: conversation.id,
    contactId: contact.id,
    contactName: contact.name,
    messageId: stored.id,
    duplicated: false,
    autoPilot,
    drafted: 0,
  };

  if (!autoPilot) return base;

  // ---- Autopilot: draft, auto-approve the top suggestion, queue, send ----
  try {
    const generated = await generateReplies({
      conversationId: conversation.id,
      incoming: msg.text,
      sourceMessageId: stored.id,
    });
    base.generated = generated;
    base.drafted = generated.replies.length;

    const top =
      generated.replies.find((r) => r.style === 'suggested') ?? generated.replies[0];
    if (!top) return base;

    await prisma.generatedReply.update({ where: { id: top.id }, data: { status: 'approved', approvedAt: new Date() } });

    const queued = await enqueueOutbound({
      conversationId: conversation.id,
      to: phone,
      body: top.body,
      replyId: top.id,
    });
    base.outboundId = queued.id;

    const drain = await processQueue(5);
    if (drain.sent > 0) base.autoSentReplyId = top.id;
    return base;
  } catch (err) {
    // Never lose the inbound message because the model was unavailable.
    console.error('[ingest] autopilot failed:', (err as Error).message);
    return base;
  }
}

/** Records a status callback (sent / delivered / read / failed) on the message. */
export async function applyStatusUpdate(waMessageId: string, status: string, error?: string) {
  const message = await prisma.message.findUnique({ where: { waMessageId } });
  if (message) {
    await prisma.message.update({
      where: { id: message.id },
      data: { status: status === 'failed' ? 'failed' : status },
    });
  }
  const outbound = await prisma.outboundMessage.findFirst({ where: { waMessageId } });
  if (outbound && status === 'failed') {
    await prisma.outboundMessage.update({
      where: { id: outbound.id },
      data: { lastError: error ?? 'delivery failed' },
    });
  }
}
