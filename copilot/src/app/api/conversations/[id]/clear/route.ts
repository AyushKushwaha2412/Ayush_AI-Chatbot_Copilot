import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { json, route, ApiError, body } from '@/lib/api';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  scope: z.enum(['messages', 'memory', 'drafts', 'all']),
});

/**
 * POST /api/conversations/:id/clear
 *
 * Granular privacy control: wipe the transcript, the AI's memory, the draft
 * history, or everything — without deleting the contact itself.
 */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { scope } = schema.parse(await body(req));

  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation) throw new ApiError('Conversation not found', 404);

  const removed: Record<string, number> = {};

  if (scope === 'messages' || scope === 'all') {
    removed.messages = (await prisma.message.deleteMany({ where: { conversationId: id } })).count;
  }
  if (scope === 'memory' || scope === 'all') {
    removed.memory = (await prisma.conversationMemory.deleteMany({ where: { conversationId: id } })).count;
  }
  if (scope === 'drafts' || scope === 'all') {
    removed.drafts = (await prisma.generatedReply.deleteMany({ where: { conversationId: id } })).count;
  }
  if (scope === 'all') {
    removed.queue = (
      await prisma.outboundMessage.deleteMany({ where: { conversationId: id, status: { in: ['queued', 'failed', 'cancelled'] } } })
    ).count;
    await prisma.conversation.update({
      where: { id },
      data: { lastMessagePreview: null, unreadCount: 0 },
    });
  } else if (scope === 'messages') {
    await prisma.conversation.update({ where: { id }, data: { lastMessagePreview: null } });
  }

  return json({ ok: true, scope, removed });
});
