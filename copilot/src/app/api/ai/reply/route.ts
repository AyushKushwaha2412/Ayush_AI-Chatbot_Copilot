import { NextRequest } from 'next/server';
import { generateReplies } from '@/lib/ai/reply-service';
import { body, json, route } from '@/lib/api';
import { generateReplySchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/ai/reply
 *
 * The core endpoint. It:
 *   1. accepts the conversation (plus optional new incoming text)
 *   2. loads the style profile, per-contact memory and recent transcript
 *   3. builds the system prompt that encodes the user's voice
 *   4. calls the configured LLM provider (Ollama → optional remote → offline)
 *   5. returns structured reply suggestions, persisted for the approval flow
 */
export const POST = route(async (req: NextRequest) => {
  const input = generateReplySchema.parse(await body(req));
  const result = await generateReplies({
    conversationId: input.conversationId,
    incoming: input.incoming,
    sourceMessageId: input.sourceMessageId,
    regenerate: input.regenerate,
    steer: input.steer,
    styleKey: input.styleKey,
    onlyStyle: input.onlyStyle,
    persist: input.persist,
  });
  return json(result);
});
