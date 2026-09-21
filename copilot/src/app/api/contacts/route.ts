import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { json, route, body } from '@/lib/api';
import { contactSchema } from '@/lib/validation';
import { normalizePhone } from '@/lib/whatsapp/normalize';

export const dynamic = 'force-dynamic';

/** GET /api/contacts — the people I talk to, with memory counts. */
export const GET = route(async () => {
  const contacts = await prisma.contact.findMany({
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { conversations: true } } },
  });
  return json({
    ok: true,
    contacts: contacts.map((c) => ({
      id: c.id,
      name: c.name,
      phoneNumber: c.phoneNumber,
      avatarColor: c.avatarColor,
      tags: c.tags,
      notes: c.notes,
      isFavorite: c.isFavorite,
      conversationCount: c._count.conversations,
      createdAt: c.createdAt.toISOString(),
    })),
  });
});

/** POST /api/contacts */
export const POST = route(async (req: NextRequest) => {
  const input = contactSchema.parse(await body(req));
  const phone = normalizePhone(input.phoneNumber);
  const contact = await prisma.contact.upsert({
    where: { phoneNumber: phone },
    update: { name: input.name, notes: input.notes, tags: input.tags ?? '' },
    create: { name: input.name, phoneNumber: phone, waId: phone, notes: input.notes, tags: input.tags ?? '' },
  });
  return json({ ok: true, contact });
});
