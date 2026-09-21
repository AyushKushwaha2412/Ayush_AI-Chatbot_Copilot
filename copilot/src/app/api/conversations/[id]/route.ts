import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { json, route, ApiError } from '@/lib/api';
import { ensureSettings } from '@/lib/ai/reply-service';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/conversations/:id — full thread + memory + draft history. */
export const GET = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const settings = await ensureSettings();

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      contact: true,
      memories: { orderBy: [{ pinned: 'desc' }, { importance: 'desc' }, { createdAt: 'desc' }] },
      messages: { orderBy: { createdAt: 'asc' }, take: 300 },
      generatedReplies: { orderBy: { createdAt: 'desc' }, take: 40 },
      outbound: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });

  if (!conversation) throw new ApiError('Conversation not found', 404);

  if (conversation.unreadCount > 0) {
    await prisma.conversation.update({ where: { id }, data: { unreadCount: 0 } });
  }

  return json({
    ok: true,
    mode: conversation.autoSendOverride ?? settings.autoSend ? 'autopilot' : 'copilot',
    globalAutoSend: settings.autoSend,
    conversation: {
      id: conversation.id,
      title: conversation.title,
      status: conversation.status,
      autoSendOverride: conversation.autoSendOverride,
      toneOverride: conversation.toneOverride,
      languageOverride: conversation.languageOverride,
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      unreadCount: 0,
    },
    contact: {
      id: conversation.contact.id,
      name: conversation.contact.name,
      phoneNumber: conversation.contact.phoneNumber,
      avatarColor: conversation.contact.avatarColor,
      tags: conversation.contact.tags,
      notes: conversation.contact.notes,
      isFavorite: conversation.contact.isFavorite,
    },
    messages: conversation.messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      sender: m.sender,
      body: m.body,
      mediaType: m.mediaType,
      status: m.status,
      isAiDrafted: m.isAiDrafted,
      intent: m.intent,
      waMessageId: m.waMessageId,
      createdAt: m.createdAt.toISOString(),
    })),
    memories: conversation.memories.map((m) => ({
      id: m.id,
      kind: m.kind,
      label: m.label,
      value: m.value,
      importance: m.importance,
      pinned: m.pinned,
      source: m.source,
      createdAt: m.createdAt.toISOString(),
    })),
    drafts: conversation.generatedReplies.map((r) => ({
      id: r.id,
      style: r.style,
      body: r.editedBody ?? r.body,
      originalBody: r.body,
      status: r.status,
      provider: r.provider,
      model: r.model,
      latencyMs: r.latencyMs,
      autoSent: r.autoSent,
      createdAt: r.createdAt.toISOString(),
      sentAt: r.sentAt?.toISOString() ?? null,
    })),
    outbound: conversation.outbound.map((o) => ({
      id: o.id,
      body: o.body,
      mode: o.mode,
      status: o.status,
      attempts: o.attempts,
      lastError: o.lastError,
      scheduledAt: o.scheduledAt?.toISOString() ?? null,
      sentAt: o.sentAt?.toISOString() ?? null,
      createdAt: o.createdAt.toISOString(),
    })),
  });
});

const patchSchema = z.object({
  autoSendOverride: z.boolean().nullable().optional(),
  toneOverride: z.string().max(200).nullable().optional(),
  languageOverride: z.enum(['English', 'Hindi', 'Hinglish']).nullable().optional(),
  title: z.string().max(120).optional(),
  status: z.enum(['active', 'archived']).optional(),
  contactName: z.string().max(80).optional(),
  contactNotes: z.string().max(2000).optional(),
  contactTags: z.string().max(300).optional(),
});

/** PATCH /api/conversations/:id — per-chat mode and contact details. */
export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const input = patchSchema.parse(await req.json().catch(() => ({})));

  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation) throw new ApiError('Conversation not found', 404);

  const { contactName, contactNotes, contactTags, ...convo } = input;

  if (Object.keys(convo).length) {
    await prisma.conversation.update({ where: { id }, data: convo });
  }
  if (contactName || contactNotes !== undefined || contactTags !== undefined) {
    await prisma.contact.update({
      where: { id: conversation.contactId },
      data: {
        ...(contactName ? { name: contactName } : {}),
        ...(contactNotes !== undefined ? { notes: contactNotes } : {}),
        ...(contactTags !== undefined ? { tags: contactTags } : {}),
      },
    });
  }

  return json({ ok: true });
});

/**
 * DELETE /api/conversations/:id
 * Removes the conversation and everything attached to it (messages, memory,
 * drafts, queue entries) via cascading deletes. Contacts are kept so the
 * number is not lost — pass ?contact=1 to remove that too.
 */
export const DELETE = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const alsoContact = req.nextUrl.searchParams.get('contact') === '1';

  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation) throw new ApiError('Conversation not found', 404);

  await prisma.conversation.delete({ where: { id } });

  if (alsoContact) {
    const others = await prisma.conversation.count({ where: { contactId: conversation.contactId } });
    if (others === 0) await prisma.contact.delete({ where: { id: conversation.contactId } });
  }

  return json({ ok: true, deleted: true, contactDeleted: alsoContact });
});
