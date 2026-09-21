import { NextRequest } from 'next/server';
import { json, route, body } from '@/lib/api';
import { processQueue, queueStats } from '@/lib/whatsapp/queue';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** GET /api/whatsapp/queue — outbound queue contents + counters. */
export const GET = route(async () => {
  const [items, stats] = await Promise.all([
    prisma.outboundMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { conversation: { include: { contact: true } } },
    }),
    queueStats(),
  ]);

  return json({
    ok: true,
    stats,
    items: items.map((i) => ({
      id: i.id,
      to: i.to,
      contactName: i.conversation.contact.name,
      conversationId: i.conversationId,
      body: i.body,
      mode: i.mode,
      status: i.status,
      attempts: i.attempts,
      lastError: i.lastError,
      replyId: i.replyId,
      sentAt: i.sentAt?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
      scheduledAt: i.scheduledAt?.toISOString() ?? null,
    })),
  });
});

/**
 * POST /api/whatsapp/queue
 * Drains due messages. Wire this to a cron/worker in production; the UI also
 * calls it after every approval so the demo feels instant.
 */
export const POST = route(async (req: NextRequest) => {
  const { limit } = (await body(req).catch(() => ({}))) as { limit?: number };
  const result = await processQueue(Math.min(50, Math.max(1, limit ?? 10)));
  return json({ ok: true, ...result, stats: await queueStats() });
});
