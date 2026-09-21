import { prisma } from '@/lib/db';
import { chatWithFallback, loadProviderConfig } from '@/lib/ai';
import {
  ParsedModelOutput,
  PromptContext,
  ReplyStyle,
  buildSystemPrompt,
  parseModelOutput,
} from '@/lib/ai/prompts';

export interface GenerateInput {
  conversationId: string;
  /** The inbound text to answer. Omit to answer the most recent inbound message. */
  incoming?: string;
  sourceMessageId?: string;
  regenerate?: boolean;
  /** free-text steer, e.g. "make it funnier" */
  steer?: string;
  styleKey?: string;
  /** only generate this single bucket (used by Regenerate on one card) */
  onlyStyle?: ReplyStyle;
  persist?: boolean;
}

export interface GeneratedReplyDto {
  id: string;
  style: string;
  label: string;
  body: string;
  provider: string;
  model: string;
  latencyMs: number;
  status: string;
  autoSent: boolean;
  createdAt: string;
}

export interface GenerateOutput {
  ok: boolean;
  conversationId: string;
  intent: string;
  read: string;
  replies: GeneratedReplyDto[];
  memoryUpdates: { id: string; label: string | null; value: string; kind: string }[];
  meta: {
    provider: string;
    model: string;
    latencyMs: number;
    fallbackUsed: boolean;
    providerTried: string[];
    warnings: string[];
    parseFallback: boolean;
    usage: { promptTokens: number; completionTokens: number; totalTokens: number };
    autoSend: boolean;
  };
}

const LABELS: Record<string, string> = {
  suggested: 'Suggested',
  casual: 'Casual',
  warm: 'Warm & friendly',
  playful: 'Playful',
  short: 'Short',
  custom: 'Custom',
};

export async function generateReplies(input: GenerateInput): Promise<GenerateOutput> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    include: { contact: true },
  });
  if (!conversation) throw new Error('Conversation not found');

  const [profile, settings, memories, history, recentAiReplies] = await Promise.all([
    ensureProfile(),
    ensureSettings(),
    prisma.conversationMemory.findMany({
      where: { conversationId: conversation.id },
      orderBy: [{ pinned: 'desc' }, { importance: 'desc' }],
      take: 40,
    }),
    prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
      take: 60,
    }),
    prisma.generatedReply.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
  ]);

  const lastInbound = [...history].reverse().find((m) => m.direction === 'inbound');
  const incoming = (input.incoming ?? lastInbound?.body ?? '').trim();
  if (!incoming) {
    throw new Error('No incoming message to reply to. Send or simulate an incoming message first.');
  }

  const ctx: PromptContext = {
    profile,
    settings: { systemPromptExtra: settings.systemPromptExtra, suggestionCount: settings.suggestionCount },
    conversation: conversation as PromptContext['conversation'],
    memories,
    history,
    incoming,
    regenerate: input.regenerate,
    steer: input.steer,
    styleOverride: input.styleKey ?? conversation.toneOverride ?? null,
  };

  let systemPrompt = buildSystemPrompt(ctx);

  if (input.onlyStyle) {
    systemPrompt += `\n\n## NARROW REQUEST
Only produce the "${input.onlyStyle}" bucket. Return exactly one reply with style "${input.onlyStyle}".`;
  }

  if (input.regenerate && recentAiReplies.length) {
    systemPrompt += `\n\n## DO NOT REUSE
The user already saw these drafts and rejected them. Write something clearly different:\n${recentAiReplies
      .slice(0, 5)
      .map((r) => `- (${r.style}) ${r.editedBody ?? r.body}`)
      .join('\n')}`;
  }

  const outcome = await chatWithFallback({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `${conversation.contact.name} just sent: "${incoming}"` },
    ],
    json: true,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
  });

  const parsed: ParsedModelOutput = parseModelOutput(outcome.result.text);
  const warnings: string[] = [];
  if (outcome.fallbackUsed) {
    warnings.push(
      outcome.errors.length
        ? `Fell back to the offline drafter because: ${outcome.errors
            .map((e) => `${e.provider} — ${e.message}`)
            .join('; ')}`
        : 'Fell back to the offline drafter.',
    );
  }
  if (parsed.parseFallback) {
    warnings.push('The model did not return strict JSON — replies were recovered from plain text.');
  }
  for (const note of outcome.result.notes ?? []) warnings.push(note);

  const wanted = input.onlyStyle
    ? parsed.replies.filter((r) => r.style === input.onlyStyle)
    : parsed.replies.slice(0, Math.max(1, settings.suggestionCount));

  const persist = input.persist !== false;
  let saved: { id: string; style: string; body: string; createdAt: Date; status: string; autoSent: boolean }[] = [];

  if (persist) {
    const autoSend = resolveAutoSend(conversation.autoSendOverride, settings.autoSend);
    saved = [];
    for (const reply of wanted) {
      const row = await prisma.generatedReply.create({
        data: {
          conversationId: conversation.id,
          sourceMessageId: input.sourceMessageId ?? lastInbound?.id ?? null,
          style: reply.style,
          body: reply.body,
          provider: outcome.result.provider,
          model: outcome.result.model,
          latencyMs: outcome.result.latencyMs,
          promptTokens: outcome.result.usage.promptTokens,
          completionTokens: outcome.result.usage.completionTokens,
          status: autoSend && reply.style === 'suggested' ? 'approved' : 'draft',
          approvedAt: autoSend && reply.style === 'suggested' ? new Date() : null,
        },
      });
      saved.push(row);
    }
  } else {
    saved = wanted.map((r, i) => ({
      id: `preview-${i}`,
      style: r.style,
      body: r.body,
      createdAt: new Date(),
      status: 'draft',
      autoSent: false,
    }));
  }

  // store durable facts the model discovered (never overwrite user-entered ones)
  const storedMemory: { id: string; label: string | null; value: string; kind: string }[] = [];
  if (persist && parsed.memoryUpdates?.length) {
    for (const mu of parsed.memoryUpdates.slice(0, 4)) {
      if (!mu.value || mu.value.length > 400) continue;
      const dup = await prisma.conversationMemory.findFirst({
        where: { conversationId: conversation.id, value: mu.value },
      });
      if (dup) continue;
      const row = await prisma.conversationMemory.create({
        data: {
          conversationId: conversation.id,
          kind: mu.kind || 'fact',
          label: mu.label ?? null,
          value: mu.value,
          importance: Math.min(5, Math.max(1, mu.importance ?? 3)),
          source: 'ai',
        },
      });
      storedMemory.push({ id: row.id, label: row.label, value: row.value, kind: row.kind });
    }
  }

  await prisma.aiUsageLog.create({
    data: {
      provider: outcome.result.provider,
      model: outcome.result.model,
      conversationId: conversation.id,
      replyId: saved[0]?.id && !saved[0].id.startsWith('preview-') ? saved[0].id : null,
      promptTokens: outcome.result.usage.promptTokens,
      completionTokens: outcome.result.usage.completionTokens,
      totalTokens: outcome.result.usage.totalTokens,
      latencyMs: outcome.result.latencyMs,
      success: true,
      fallbackUsed: outcome.fallbackUsed,
    },
  });

  const autoSend = resolveAutoSend(conversation.autoSendOverride, settings.autoSend);

  return {
    ok: true,
    conversationId: conversation.id,
    intent: parsed.intent,
    read: parsed.read,
    replies: saved.map((r) => ({
      id: r.id,
      style: r.style,
      label: LABELS[r.style] ?? r.style,
      body: r.body,
      provider: outcome.result.provider,
      model: outcome.result.model,
      latencyMs: outcome.result.latencyMs,
      status: r.status,
      autoSent: r.autoSent,
      createdAt: r.createdAt.toISOString(),
    })),
    memoryUpdates: storedMemory,
    meta: {
      provider: outcome.result.provider,
      model: outcome.result.model,
      latencyMs: outcome.result.latencyMs,
      fallbackUsed: outcome.fallbackUsed,
      providerTried: outcome.providerTried,
      warnings,
      parseFallback: parsed.parseFallback,
      usage: outcome.result.usage,
      autoSend,
    },
  };
}

export function resolveAutoSend(
  override: boolean | null | undefined,
  global: boolean,
): boolean {
  return override === null || override === undefined ? global : override;
}

export function replyLabel(style: string): string {
  return LABELS[style] ?? style;
}

export async function ensureProfile() {
  const existing = await prisma.userStyleProfile.findUnique({ where: { id: 'default' } });
  if (existing) return existing;
  return prisma.userStyleProfile.create({ data: { id: 'default' } });
}

export async function ensureSettings() {
  const existing = await prisma.aiSetting.findUnique({ where: { id: 'default' } });
  if (existing) return existing;

  const cfg = await loadProviderConfig();
  return prisma.aiSetting.create({
    data: {
      id: 'default',
      provider: cfg.provider === 'auto' ? 'ollama' : cfg.provider,
      ollamaBaseUrl: cfg.ollamaBaseUrl,
      ollamaModel: cfg.ollamaModel,
      openaiBaseUrl: cfg.openaiBaseUrl,
      openaiModel: cfg.openaiModel,
    },
  });
}
