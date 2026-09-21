import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { json, route, ApiError, body } from '@/lib/api';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  value: z.string().max(2000).optional(),
  label: z.string().max(80).optional(),
  importance: z.number().int().min(1).max(5).optional(),
  pinned: z.boolean().optional(),
  kind: z.enum(['fact', 'note', 'preference', 'important_date', 'taboo', 'summary']).optional(),
});

/** PATCH /api/memory/:id — edit a stored fact. */
export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const input = patchSchema.parse(await body(req));
  const memory = await prisma.conversationMemory.update({ where: { id }, data: input });
  return json({ ok: true, memory });
});

/** DELETE /api/memory/:id — forget a single fact. */
export const DELETE = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const existing = await prisma.conversationMemory.findUnique({ where: { id } });
  if (!existing) throw new ApiError('Memory item not found', 404);
  await prisma.conversationMemory.delete({ where: { id } });
  return json({ ok: true, deleted: true });
});
