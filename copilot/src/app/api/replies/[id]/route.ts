import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { json, route, ApiError, body } from '@/lib/api';
import { replyPatchSchema } from '@/lib/validation';
import { enqueueOutbound, processQueue } from '@/lib/whatsapp/queue';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/replies/:id
 *
 * The approval workflow endpoint:
 *   edit       → store an edited body (keeps the original for audit)
 *   approve    → mark approved and push into the outbound queue
 *   discard    → throw the draft away
 *   regenerate → signal the client to call /api/ai/reply with regenerate=true
 */
export const PATCH = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const input = replyPatchSchema.parse(await body(req));

  const reply = await prisma.generatedReply.findUnique({
    where: { id },
    include: { conversation: { include: { contact: true } } },
  });
  if (!reply) throw new ApiError('Draft not found', 404);

  if (input.action === 'edit') {
    if (!input.body?.trim()) throw new ApiError('Edited body cannot be empty.', 422);
    const updated = await prisma.generatedReply.update({
      where: { id },
      data: { editedBody: input.body.trim() },
    });
    return json({ ok: true, action: 'edit', body: updated.editedBody });
  }

  if (input.action === 'discard') {
    await prisma.generatedReply.update({ where: { id }, data: { status: 'discarded' } });
    return json({ ok: true, action: 'discard' });
  }

  if (input.action === 'regenerate') {
    await prisma.generatedReply.update({ where: { id }, data: { status: 'discarded' } });
    return json({
      ok: true,
      action: 'regenerate',
      next: { endpoint: '/api/ai/reply', payload: { conversationId: reply.conversationId, regenerate: true } },
    });
  }

  // ---- approve → queue → deliver ----
  const finalBody = (input.body?.trim() || reply.editedBody || reply.body).trim();
  if (!finalBody) throw new ApiError('Nothing to send.', 422);

  await prisma.generatedReply.update({
    where: { id },
    data: {
      status: 'approved',
      approvedAt: new Date(),
      editedBody: input.body?.trim() || reply.editedBody || null,
    },
  });

  const queued = await enqueueOutbound({
    conversationId: reply.conversationId,
    to: reply.conversation.contact.phoneNumber,
    body: finalBody,
    replyId: reply.id,
  });

  // drain immediately so the user sees the message land in the thread
  const drain = await processQueue(3);

  const outbound = await prisma.outboundMessage.findUnique({ where: { id: queued.id } });

  return json({
    ok: outbound?.status === 'sent',
    action: 'approve',
    body: finalBody,
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

/** DELETE /api/replies/:id — hard delete a single draft. */
export const DELETE = route(async (_req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const existing = await prisma.generatedReply.findUnique({ where: { id } });
  if (!existing) throw new ApiError('Draft not found', 404);
  await prisma.generatedReply.delete({ where: { id } });
  return json({ ok: true, deleted: true });
});
