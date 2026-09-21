import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { body, json, route } from '@/lib/api';
import { conversationSchema } from '@/lib/validation';
import { normalizePhone } from '@/lib/whatsapp/normalize';

export const dynamic = 'force-dynamic';

/** GET /api/conversations — sidebar list with previews + draft counts. */
export const GET = route(async (req: NextRequest) => {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase();
  const status = req.nextUrl.searchParams.get('status') ?? 'active';

  const conversations = await prisma.conversation.findMany({
    where: {
      status,
      ...(q
        ? {
            OR: [
              { contact: { name: { contains: q } } },
              { contact: { phoneNumber: { contains: q } } },
              { lastMessagePreview: { contains: q } },
            ],
          }
        : {}),
    },
    include: {
      contact: true,
      _count: { select: { messages: true, generatedReplies: true, memories: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
  });

  const draftCounts = await prisma.generatedReply.groupBy({
    by: ['conversationId'],
    where: { status: 'draft' },
    _count: { _all: true },
  });
  const drafts = new Map(draftCounts.map((d) => [d.conversationId, d._count._all]));

  const pendingOutbound = await prisma.outboundMessage.groupBy({
    by: ['conversationId'],
    where: { status: { in: ['queued', 'sending'] } },
    _count: { _all: true },
  });
  const queued = new Map(pendingOutbound.map((d) => [d.conversationId, d._count._all]));

  return json({
    ok: true,
    conversations: conversations.map((c) => ({
      id: c.id,
      title: c.title,
      contact: {
        id: c.contact.id,
        name: c.contact.name,
        phoneNumber: c.contact.phoneNumber,
        avatarColor: c.contact.avatarColor,
        tags: c.contact.tags,
      },
      lastMessageAt: c.lastMessageAt.toISOString(),
      lastMessagePreview: c.lastMessagePreview ?? c.messages[0]?.body ?? null,
      lastMessageDirection: c.messages[0]?.direction ?? null,
      unreadCount: c.unreadCount,
      autoSendOverride: c.autoSendOverride,
      toneOverride: c.toneOverride,
      languageOverride: c.languageOverride,
      counts: {
        messages: c._count.messages,
        drafts: drafts.get(c.id) ?? 0,
        memories: c._count.memories,
        queued: queued.get(c.id) ?? 0,
      },
    })),
  });
});

/** POST /api/conversations — start a chat with a new or existing number. */
export const POST = route(async (req: NextRequest) => {
  const input = conversationSchema.parse(await body(req));
  const phone = normalizePhone(input.phoneNumber ?? '');
  if (!phone && !input.contactId) {
    return json({ ok: false, error: 'Provide a contactId or a phoneNumber.' }, { status: 422 });
  }

  let contactId = input.contactId;
  if (!contactId && phone) {
    const contact = await prisma.contact.upsert({
      where: { phoneNumber: phone },
      update: { name: input.name?.trim() || phone },
      create: { name: input.name?.trim() || phone, phoneNumber: phone, waId: phone },
    });
    contactId = contact.id;
  }

  const conversation = await prisma.conversation.create({
    data: {
      contactId: contactId!,
      title: input.title ?? null,
      lastMessagePreview: input.openingMessage?.slice(0, 140) ?? null,
      lastMessageAt: new Date(),
    },
    include: { contact: true },
  });

  if (input.openingMessage?.trim()) {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'inbound',
        sender: 'contact',
        body: input.openingMessage.trim(),
        status: 'received',
        waMessageId: `local.opening.${conversation.id}`,
      },
    });
  }

  return json({ ok: true, conversation: { id: conversation.id, contactId: conversation.contact.id } });
});
