import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { json, route, ApiError, body } from '@/lib/api';
import { enqueueOutbound, processQueue } from '@/lib/whatsapp/queue';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  /** manually-typed message I want to send without AI */
  text: z.string().min(1).max(4000),
  /** simulate an incoming message instead of sending */
  simulateInbound: z.boolean().optional(),
  queueOnly: z.boolean().optional(),
});

/**
 * POST /api/conversations/:id/messages
 *
 * Two ways to write into a thread by hand:
 *   simulateInbound: true → record it as if the contact sent it
 *   otherwise             → queue + deliver it as an outbound message
 */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const input = schema.parse(await body(req));

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: { contact: true },
  });
  if (!conversation) throw new ApiError('Conversation not found', 404);

  if (input.simulateInbound) {
    const message = await prisma.message.create({
      data: {
        conversationId: id,
        direction: 'inbound',
        sender: 'contact',
        body: input.text,
        status: 'received',
        waMessageId: `sim.manual.${Date.now()}.${Math.random().toString(36).slice(2, 7)}`,
        rawPayload: JSON.stringify({ simulated: true, manual: true }),
      },
    });
    await prisma.conversation.update({
      where: { id },
      data: { lastMessageAt: new Date(), lastMessagePreview: input.text.slice(0, 140), unreadCount: { increment: 1 } },
    });
    return json({ ok: true, message: { id: message.id, direction: 'inbound', body: message.body } });
  }

  const queued = await enqueueOutbound({
    conversationId: id,
    to: conversation.contact.phoneNumber,
    body: input.text,
    replyId: null,
  });

  const drain = input.queueOnly ? { processed: 0, sent: 0, failed: 0, results: [] } : await processQueue(3);
  const outbound = await prisma.outboundMessage.findUnique({ where: { id: queued.id } });

  return json({
    ok: outbound?.status === 'sent' || outbound?.status === 'queued',
    outbound: {
      id: queued.id,
      status: outbound?.status ?? 'queued',
      mode: outbound?.mode ?? 'simulated',
      waMessageId: outbound?.waMessageId ?? null,
      lastError: outbound?.lastError ?? null,
    },
    queue: { processed: drain.processed, sent: drain.sent, failed: drain.failed },
  });
});

/** DELETE /api/conversations/:id/messages?messageId=... — remove one message. */
export const DELETE = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const messageId = req.nextUrl.searchParams.get('messageId');
  if (!messageId) throw new ApiError('messageId query parameter is required.', 422);
  const result = await prisma.message.deleteMany({ where: { id: messageId, conversationId: id } });
  if (!result.count) throw new ApiError('Message not found in this conversation.', 404);
  return json({ ok: true, deleted: result.count });
});
