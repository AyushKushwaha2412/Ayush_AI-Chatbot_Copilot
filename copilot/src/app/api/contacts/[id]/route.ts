import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { json, route, ApiError } from '@/lib/api';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().max(80).optional(),
  notes: z.string().max(2000).optional(),
  tags: z.string().max(300).optional(),
  isFavorite: z.boolean().optional(),
});

/** PATCH /api/contacts/:id */
export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const input = patchSchema.parse(await req.json().catch(() => ({})));
  const contact = await prisma.contact.update({ where: { id }, data: input });
  return json({ ok: true, contact });
});

/**
 * DELETE /api/contacts/:id
 * ?conversations=1 also wipes every thread, message and memory with them.
 */
export const DELETE = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const withConversations = req.nextUrl.searchParams.get('conversations') === '1';

  const contact = await prisma.contact.findUnique({ where: { id } });
  if (!contact) throw new ApiError('Contact not found', 404);

  if (withConversations) {
    await prisma.conversation.deleteMany({ where: { contactId: id } });
  } else {
    const remaining = await prisma.conversation.count({ where: { contactId: id } });
    if (remaining > 0) {
      throw new ApiError(
        `This contact still has ${remaining} conversation(s). Pass ?conversations=1 to delete them too.`,
        409,
      );
    }
  }
  await prisma.contact.delete({ where: { id } });
  return json({ ok: true, deleted: true, conversationsDeleted: withConversations });
});
