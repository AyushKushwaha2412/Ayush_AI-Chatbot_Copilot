import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { json, route, body, ApiError } from '@/lib/api';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({
  scope: z.enum(['memory', 'drafts', 'messages', 'everything', 'queue', 'webhooks']),
});

/**
 * POST /api/privacy/purge
 *
 * Bulk data removal. Every scope is explicit about what it touches, and the
 * style profile + provider settings are never deleted by "everything" so the
 * app stays configured after a wipe.
 */
export const POST = route(async (req: NextRequest) => {
  const { scope } = schema.parse(await body(req));
  const deleted: Record<string, number> = {};

  switch (scope) {
    case 'memory':
      deleted.memory = (await prisma.conversationMemory.deleteMany()).count;
      break;
    case 'drafts':
      deleted.drafts = (await prisma.generatedReply.deleteMany()).count;
      break;
    case 'messages':
      deleted.messages = (await prisma.message.deleteMany()).count;
      await prisma.conversation.updateMany({ data: { lastMessagePreview: null, unreadCount: 0 } });
      break;
    case 'queue':
      deleted.queue = (await prisma.outboundMessage.deleteMany()).count;
      break;
    case 'webhooks':
      deleted.webhookEvents = (await prisma.webhookEvent.deleteMany()).count;
      break;
    case 'everything':
      deleted.outbound = (await prisma.outboundMessage.deleteMany()).count;
      deleted.drafts = (await prisma.generatedReply.deleteMany()).count;
      deleted.memory = (await prisma.conversationMemory.deleteMany()).count;
      deleted.messages = (await prisma.message.deleteMany()).count;
      deleted.webhookEvents = (await prisma.webhookEvent.deleteMany()).count;
      deleted.usage = (await prisma.aiUsageLog.deleteMany()).count;
      deleted.conversations = (await prisma.conversation.deleteMany()).count;
      deleted.contacts = (await prisma.contact.deleteMany()).count;
      break;
    default:
      throw new ApiError('Unknown purge scope.', 422);
  }

  return json({
    ok: true,
    scope,
    deleted,
    total: Object.values(deleted).reduce((a, b) => a + b, 0),
    note:
      scope === 'everything'
        ? 'Conversation data wiped. Your style profile and provider settings were preserved.'
        : undefined,
  });
});
