import { NextRequest } from 'next/server';
import { json, route, body, ApiError } from '@/lib/api';
import { ingestInbound } from '@/lib/whatsapp/ingest';
import { normalizePhone } from '@/lib/whatsapp/normalize';
import { simulateSchema } from '@/lib/validation';
import { ensureSettings } from '@/lib/ai/reply-service';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/whatsapp/simulate
 *
 * Fires an inbound message through the exact same pipeline a real Cloud API
 * webhook would use (ingest → autopilot decision → optional auto-send), so
 * the demo exercises production code paths instead of a mock shortcut.
 */
export const POST = route(async (req: NextRequest) => {
  const input = simulateSchema.parse(await body(req));
  const phone = normalizePhone(input.from);
  if (phone.length < 6) throw new ApiError('A valid sender phone number is required.', 422);

  // honor forceCopilot by temporarily pinning the conversation later, so we
  // must know whether autopilot applies before ingesting
  const settings = input.forceCopilot ? await ensureSettings() : null;
  let restoreOverride: { id: string; value: boolean | null } | null = null;

  if (input.forceCopilot) {
    const contact = await prisma.contact.findUnique({ where: { phoneNumber: phone } });
    if (contact) {
      const existing = await prisma.conversation.findFirst({
        where: { contactId: contact.id, status: 'active' },
        orderBy: { lastMessageAt: 'desc' },
      });
      if (existing) {
        restoreOverride = { id: existing.id, value: existing.autoSendOverride };
        await prisma.conversation.update({
          where: { id: existing.id },
          data: { autoSendOverride: false },
        });
      }
    }
  }

  try {
    const result = await ingestInbound({
      waMessageId: `sim.in.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
      from: phone,
      profileName: input.profileName,
      type: 'text',
      text: input.text,
      timestamp: input.at ? new Date(input.at) : new Date(),
      raw: { simulated: true, text: input.text, from: phone },
    });

    return json({
      ok: true,
      simulated: true,
      mode: result.autoPilot ? 'autopilot' : 'copilot',
      ...result,
      generated: result.generated
        ? {
            intent: result.generated.intent,
            read: result.generated.read,
            replies: result.generated.replies,
            meta: result.generated.meta,
          }
        : undefined,
      globalAutoSend: settings?.autoSend ?? false,
    });
  } finally {
    if (restoreOverride) {
      await prisma.conversation.update({
        where: { id: restoreOverride.id },
        data: { autoSendOverride: restoreOverride.value },
      });
    }
  }
});
