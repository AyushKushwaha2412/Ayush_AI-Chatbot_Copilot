import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { json, route, ApiError, body } from '@/lib/api';
import { memorySchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/conversations/:id/memory */
export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const memories = await prisma.conversationMemory.findMany({
    where: { conversationId: id },
    orderBy: [{ pinned: 'desc' }, { importance: 'desc' }, { createdAt: 'desc' }],
  });
  return json({ ok: true, memories });
});

/** POST /api/conversations/:id/memory — add a fact the AI should always know. */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation) throw new ApiError('Conversation not found', 404);

  const input = memorySchema.parse(await body(req));
  const memory = await prisma.conversationMemory.create({
    data: { ...input, conversationId: id, source: 'user' },
  });
  return json({ ok: true, memory });
});

/** DELETE /api/conversations/:id/memory — clear all memory for this chat. */
export const DELETE = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const result = await prisma.conversationMemory.deleteMany({ where: { conversationId: id } });
  return json({ ok: true, deleted: result.count, message: `Cleared ${result.count} memory item(s).` });
});
