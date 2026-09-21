import { prisma } from '@/lib/db';
import { sendTextMessage } from './client';
import { getWhatsAppConfig } from './config';
import { normalizePhone } from './normalize';
import { QueueStats } from './types';

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 3000, 15000];

let draining = false;

/**
 * Outbound message queue.
 *
 * Every approved reply goes through here — whether it was manually approved
 * or sent automatically by Autopilot. Keeping the write path uniform means
 * retries, backoff, audit history and the simulated/live switch live in one
 * place, and swapping to a real broker later is a drop-in change.
 */
export async function enqueueOutbound(opts: {
  conversationId: string;
  to: string;
  body: string;
  replyId?: string | null;
  scheduledAt?: Date;
}): Promise<{ id: string; status: string; mode: string }> {
  const cfg = getWhatsAppConfig();
  const row = await prisma.outboundMessage.create({
    data: {
      conversationId: opts.conversationId,
      replyId: opts.replyId ?? null,
      to: normalizePhone(opts.to),
      body: opts.body,
      mode: cfg.mode,
      status: 'queued',
      scheduledAt: opts.scheduledAt ?? new Date(),
    },
  });
  return { id: row.id, status: row.status, mode: row.mode };
}

/** Attempt to deliver every due queued message. Safe to call concurrently. */
export async function processQueue(limit = 10): Promise<{
  processed: number;
  sent: number;
  failed: number;
  results: { id: string; status: string; error?: string; simulated?: boolean }[];
}> {
  if (draining) return { processed: 0, sent: 0, failed: 0, results: [] };
  draining = true;

  const results: { id: string; status: string; error?: string; simulated?: boolean }[] = [];
  let sent = 0;
  let failed = 0;

  try {
    const due = await prisma.outboundMessage.findMany({
      where: { status: 'queued', scheduledAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    for (const item of due) {
      await prisma.outboundMessage.update({ where: { id: item.id }, data: { status: 'sending' } });

      const outcome = await sendTextMessage({ to: item.to, body: item.body });

      if (outcome.ok) {
        await prisma.outboundMessage.update({
          where: { id: item.id },
          data: {
            status: 'sent',
            sentAt: new Date(),
            attempts: item.attempts + 1,
            waMessageId: outcome.waMessageId ?? null,
            lastError: null,
          },
        });

        // record the sent text in the conversation timeline
        const conversation = await prisma.conversation.findUnique({ where: { id: item.conversationId } });
        const alreadyLogged = item.waMessageId
          ? await prisma.message.findFirst({ where: { waMessageId: item.waMessageId } })
          : null;

        if (conversation && !alreadyLogged) {
          await prisma.message.create({
            data: {
              conversationId: item.conversationId,
              direction: 'outbound',
              sender: item.replyId ? 'ai' : 'me',
              body: item.body,
              waMessageId: outcome.waMessageId ?? `local.${item.id}`,
              status: outcome.simulated ? 'sent' : 'sent',
              isAiDrafted: Boolean(item.replyId),
              rawPayload: JSON.stringify({ mode: outcome.mode, simulated: Boolean(outcome.simulated) }),
            },
          });
          await prisma.conversation.update({
            where: { id: item.conversationId },
            data: { lastMessageAt: new Date(), lastMessagePreview: item.body.slice(0, 140) },
          });
        }

        if (item.replyId) {
          await prisma.generatedReply.updateMany({
            where: { id: item.replyId },
            data: { status: 'sent', sentAt: new Date(), autoSent: true },
          });
        }

        results.push({ id: item.id, status: 'sent', simulated: outcome.simulated });
        sent++;
      } else {
        const attempts = item.attempts + 1;
        const willRetry = attempts < MAX_ATTEMPTS;
        await prisma.outboundMessage.update({
          where: { id: item.id },
          data: {
            status: willRetry ? 'queued' : 'failed',
            attempts,
            lastError: outcome.error ?? 'unknown error',
            scheduledAt: willRetry ? new Date(Date.now() + BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)]) : null,
          },
        });
        if (!willRetry) {
          await prisma.generatedReply.updateMany({
            where: { id: item.replyId ?? '__none__' },
            data: { status: 'draft' },
          });
          failed++;
        }
        results.push({ id: item.id, status: willRetry ? 'queued-retry' : 'failed', error: outcome.error });
      }
    }
  } finally {
    draining = false;
  }

  return { processed: results.length, sent, failed, results };
}

export async function queueStats(): Promise<QueueStats> {
  const [grouped, oldest] = await Promise.all([
    prisma.outboundMessage.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.outboundMessage.findFirst({
      where: { status: 'queued' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  ]);

  const counts: Record<string, number> = {};
  for (const g of grouped) counts[g.status] = g._count._all;

  return {
    queued: counts.queued ?? 0,
    sending: counts.sending ?? 0,
    sent: counts.sent ?? 0,
    failed: counts.failed ?? 0,
    cancelled: counts.cancelled ?? 0,
    oldestQueuedAt: oldest?.createdAt.toISOString() ?? null,
  };
}

/** Cancel a queued message before it goes out. */
export async function cancelOutbound(id: string): Promise<boolean> {
  const row = await prisma.outboundMessage.findUnique({ where: { id } });
  if (!row || row.status !== 'queued') return false;
  await prisma.outboundMessage.update({ where: { id }, data: { status: 'cancelled' } });
  return true;
}

/** Retry a failed message immediately. */
export async function retryOutbound(id: string): Promise<boolean> {
  const row = await prisma.outboundMessage.findUnique({ where: { id } });
  if (!row || row.status === 'sent') return false;
  await prisma.outboundMessage.update({
    where: { id },
    data: { status: 'queued', scheduledAt: new Date(), lastError: null },
  });
  await processQueue(1);
  return true;
}
