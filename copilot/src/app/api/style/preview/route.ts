import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { json, route } from '@/lib/api';
import { buildSystemPrompt } from '@/lib/ai/prompts';
import { ensureProfile, ensureSettings } from '@/lib/ai/reply-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/style/preview?conversationId=...
 *
 * Returns the exact system prompt the model receives (with memory and recent
 * transcript folded in). Full transparency: you can see precisely what is
 * sent to your LLM, and nothing else leaves the server.
 */
export const GET = route(async (req: NextRequest) => {
  const profile = await ensureProfile();
  const settings = await ensureSettings();
  const conversationId = req.nextUrl.searchParams.get('conversationId');
  const incomingOverride = req.nextUrl.searchParams.get('incoming');

  const conversation = conversationId
    ? await prisma.conversation.findUnique({ where: { id: conversationId }, include: { contact: true } })
    : await prisma.conversation.findFirst({ include: { contact: true }, orderBy: { lastMessageAt: 'desc' } });

  if (!conversation) {
    return json({
      ok: true,
      prompt: '(No conversations yet — the prompt will be built per conversation once you add one.)',
      profileLoaded: true,
    });
  }

  const [memories, history] = await Promise.all([
    prisma.conversationMemory.findMany({
      where: { conversationId: conversation.id },
      orderBy: [{ pinned: 'desc' }, { importance: 'desc' }],
      take: 40,
    }),
    prisma.message.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'asc' }, take: 60 }),
  ]);

  const lastInbound = [...history].reverse().find((m) => m.direction === 'inbound');

  const prompt = buildSystemPrompt({
    profile,
    settings: { systemPromptExtra: settings.systemPromptExtra, suggestionCount: settings.suggestionCount },
    conversation: conversation as Parameters<typeof buildSystemPrompt>[0]['conversation'],
    memories,
    history,
    incoming: incomingOverride || lastInbound?.body || '(their next message)',
  });

  return json({
    ok: true,
    conversationId: conversation.id,
    contact: conversation.contact.name,
    chars: prompt.length,
    approxTokens: Math.round(prompt.length / 4),
    prompt,
  });
});
