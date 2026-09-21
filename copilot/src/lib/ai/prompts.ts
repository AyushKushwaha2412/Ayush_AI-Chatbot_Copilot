import type { AiSetting, Conversation, ConversationMemory, Message, UserStyleProfile } from '@prisma/client';

export interface PromptContext {
  profile: UserStyleProfile;
  settings: Pick<AiSetting, 'systemPromptExtra' | 'suggestionCount'>;
  conversation: Conversation & { contact: { name: string; phoneNumber: string; notes?: string | null; tags: string } };
  memories: ConversationMemory[];
  history: Message[];
  incoming: string;
  regenerate?: boolean;
  steer?: string; // user steer for custom generation, e.g. "make it funnier"
  styleOverride?: string | null;
}

export const REPLY_STYLES = ['suggested', 'casual', 'warm', 'playful', 'short'] as const;
export type ReplyStyle = (typeof REPLY_STYLES)[number];

export const STYLE_LABELS: Record<string, string> = {
  suggested: 'Suggested reply',
  casual: 'Casual reply',
  warm: 'Warm / friendly reply',
  playful: 'Playful reply',
  short: 'Short reply',
  custom: 'Custom reply',
};

function lines(value: string | null | undefined): string[] {
  return (value || '')
    .split('\n')
    .map((l) => l.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean);
}

function bullet(values: string[], emptyLabel = '—'): string {
  return values.length ? values.map((v) => `- ${v}`).join('\n') : emptyLabel;
}

function levelLabel(n: number, scale: [string, string, string, string, string]): string {
  const idx = Math.min(4, Math.max(0, Math.round((n - 1) / 2)));
  return `${n}/10 (${scale[idx]})`;
}

function lengthWord(len: string): string {
  switch (len) {
    case 'very-short':
      return '1 short line, max 6 words';
    case 'long':
      return '3–5 sentences, tell a bit of a story';
    case 'medium':
      return '2–3 sentences';
    default:
      return '1–2 short sentences, ideally under 15 words';
  }
}

function languageRules(lang: string): string {
  switch (lang) {
    case 'Hindi':
      return 'Write in natural conversational Hindi. Devanagari script. No English words unless unavoidable (names, apps, brands).';
    case 'English':
      return 'Write in natural, modern chat English. Contractions are welcome. No stanza-style or formal letter phrasing.';
    default:
      return 'Write in Hinglish — Roman-script Hindi mixed with English, exactly how urban Indian chat actually looks ("bhai ye scene kya hai", "haan chal"). Keep the Hindi parts Roman, never Devanagari.';
  }
}

function emojiRule(usage: string): string {
  switch (usage) {
    case 'none':
      return 'Use NO emojis at all.';
    case 'rare':
      return 'Use at most one emoji across all five replies.';
    case 'heavy':
      return 'Use emojis generously, 1–3 per reply, as active punctuation.';
    default:
      return 'Use emojis sparingly: 0–1 per reply, only where it adds warmth or humour.';
  }
}

/**
 * Builds the system prompt that encodes the user's voice.
 * This is the piece that makes output feel like *them* rather than a chatbot.
 */
export function buildSystemPrompt(ctx: PromptContext): string {
  const p = ctx.profile;
  const c = ctx.conversation.contact;

  const memory = ctx.memories
    .slice()
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.importance - a.importance)
    .map((m) => `- [${m.kind}${m.label ? `/${m.label}` : ''}] ${m.value}`)
    .join('\n');

  const transcript = ctx.history
    .slice(-14)
    .map((m) => {
      const who = m.direction === 'inbound' ? c.name : m.sender === 'ai' ? `${p.displayName} (AI-drafted)` : p.displayName;
      return `${who}: ${m.body}`;
    })
    .join('\n');

  const samples = lines(p.trainingSamples).slice(0, 60);

  return `You are the private "Conversation Copilot" for ${p.displayName}. You are NOT a chatbot talking to the user — you draft messages that ${p.displayName} will send to a real contact on WhatsApp, in ${p.displayName}'s own voice. Never mention that you are an AI, never add disclaimers, never explain the message.

## WHO YOU ARE WRITING TO
Contact name: ${c.name}
Relationship notes: ${c.notes?.trim() || 'not specified'}
Tags: ${c.tags || '—'}

## YOUR VOICE (this is the most important section)
Preferred language: ${p.preferredLanguage}
${languageRules(p.preferredLanguage)}
Typical length: ${p.typicalLength} — ${lengthWord(p.typicalLength)}
Formality: ${levelLabel(p.formalityLevel, ['extremely casual / slang-heavy', 'casual', 'relaxed but polite', 'polite', 'formal'])}
Humor: ${levelLabel(p.humorLevel, ['dead serious', 'lightly dry', 'occasionally funny', 'witty', 'very funny'])}
Flirtiness: ${levelLabel(p.flirtinessLevel, ['strictly platonic', 'friendly only', 'light teasing', 'clearly flirty', 'openly flirty'])}
Confidence: ${levelLabel(p.confidenceLevel, ['hesitant', 'gentle', 'balanced', 'assertive', 'bold and direct'])}
Emoji usage: ${emojiRule(p.emojiUsage)}

Signature phrases (use naturally, never force them all in):
${bullet(lines(p.commonPhrases))}

Never say / never do (hard constraint — never violate):
${bullet(lines(p.avoidPhrases), '—')}

Their interests (bridge to these when it fits organically):
${bullet(lines(p.interests), '—')}

Communication preferences:
${bullet(lines(p.communicationPrefs), '—')}
${p.signature ? `\nSigns off as: ${p.signature}` : ''}

## HOW ${p.displayName} ACTUALLY TEXTS (learn the rhythm from these real samples)
${samples.length ? bullet(samples) : '— (no samples provided)'}

## WHAT WE KNOW ABOUT THIS CONTACT AND THIS CHAT
${memory || '— (no stored facts yet)'}

Recent transcript (oldest → newest):
${transcript || '—'}

## THE MESSAGE JUST RECEIVED
${c.name}: ${ctx.incoming}

## YOUR TASK
Produce ${ctx.settings.suggestionCount} distinct reply options that ${p.displayName} could send right now. Each one must be a complete, send-ready WhatsApp message — not a description, not a suggestion of what to say, not multiple variants inside one string. Each reply must feel like the same person wrote it: consistent voice, but different angle.

Required buckets (use these exact style keys):
- "suggested" — your single best pick: confident, moves the conversation forward, sounds like ${p.displayName} on a good day. Slightly flirty when the context allows it.
- "casual" — low-effort, everyday reply. Chill, unbothered, text-speak friendly.
- "warm" — friendly and caring, makes the other person feel good.
- "playful" — teasing, witty, fun. A little flirty is good here.
- "short" — 2–5 words. Punchy, complete thought.

Rules:
- Match the language, length and emoji settings above exactly.
- Never use the forbidden phrases, ever.
- Sound human: contractions, lowercase, no perfect grammar, no corporate polish, no em-dash poetry.
- Do not repeat the same opener across replies.
- Do not ask more than one question per reply, and only when a question is genuinely natural.
- If the incoming message is a question, at least two replies must actually answer it.
- Do not include the contact's name in every reply.
${ctx.regenerate ? '- The user rejected the previous draft. Take a noticeably different angle this time; avoid the previous phrasing entirely.' : ''}
${ctx.styleOverride ? `- Steer the whole set toward: ${ctx.styleOverride}` : ''}
${ctx.steer ? `- Extra instruction from ${p.displayName} for the "suggested" reply: ${ctx.steer}` : ''}
${ctx.settings.systemPromptExtra ? `\n## EXTRA HOUSE RULES\n${ctx.settings.systemPromptExtra}` : ''}

## OUTPUT FORMAT (strict)
Return ONLY a JSON object, no markdown fences, no commentary:
{
  "intent": "one of: question | plan | logistics | flirt | smalltalk | support | other",
  "read": "one short sentence on what they really mean / what they want",
  "replies": [
    { "style": "suggested", "body": "..." },
    { "style": "casual", "body": "..." },
    { "style": "warm", "body": "..." },
    { "style": "playful", "body": "..." },
    { "style": "short", "body": "..." }
  ],
  "memory_updates": [
    { "kind": "fact|note|preference|important_date|taboo", "label": "short label", "value": "what we learned", "importance": 1 }
  ]
}
"memory_updates" must only contain durable facts that will still matter in a month (plans made, birthdays, preferences, things to avoid). If nothing qualifies, return an empty array.`;
}

export function buildCustomPrompt(ctx: PromptContext): string {
  return `${buildSystemPrompt({ ...ctx, styleOverride: 'a single custom reply' })}

## CUSTOM REQUEST
${p_label(ctx)}
Return ONLY JSON: { "intent": "...", "read": "...", "replies": [ { "style": "custom", "body": "..." } ], "memory_updates": [] }`;
}

function p_label(ctx: PromptContext) {
  const parts = [
    ctx.steer ? `Instruction: ${ctx.steer}` : 'Instruction: write the best possible reply.',
    ctx.styleOverride ? `Tone: ${ctx.styleOverride}` : '',
  ].filter(Boolean);
  return parts.join('\n');
}

export interface ParsedReply {
  style: string;
  body: string;
}

export interface ParsedModelOutput {
  intent: string;
  read: string;
  replies: ParsedReply[];
  memoryUpdates: { kind: string; label?: string; value: string; importance?: number }[];
  parseFallback: boolean;
}

const VALID_STYLES = new Set(['suggested', 'casual', 'warm', 'playful', 'short', 'custom']);

/**
 * LLMs are messy: they wrap JSON in prose, fences, or emit numbered lists.
 * This normalises all of it into the same shape.
 */
export function parseModelOutput(raw: string): ParsedModelOutput {
  const cleaned = raw
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();

  const candidate = extractJsonObject(cleaned);
  if (candidate) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const repliesRaw = Array.isArray(parsed.replies) ? parsed.replies : [];
      const seen = new Set<string>();
      const replies: ParsedReply[] = [];

      for (const item of repliesRaw) {
        if (typeof item === 'string') {
          const style = REPLY_STYLES.find((s) => !seen.has(s)) ?? 'casual';
          seen.add(style);
          replies.push({ style, body: clean(item) });
          continue;
        }
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          const styleRaw = String(obj.style ?? obj.type ?? obj.tone ?? '').toLowerCase().trim();
          const body = clean(String(obj.body ?? obj.text ?? obj.message ?? obj.reply ?? ''));
          if (!body) continue;
          const style = VALID_STYLES.has(styleRaw)
            ? styleRaw
            : (REPLY_STYLES.find((s) => !seen.has(s)) ?? 'casual');
          seen.add(style);
          replies.push({ style, body });
        }
      }

      const memoryUpdates = Array.isArray(parsed.memory_updates)
        ? (parsed.memory_updates as unknown[])
            .map((m) => {
              if (typeof m === 'string') return { kind: 'fact', value: clean(m), importance: 3 };
              const obj = (m ?? {}) as Record<string, unknown>;
              const value = clean(String(obj.value ?? obj.text ?? obj.fact ?? ''));
              if (!value) return null;
              return {
                kind: String(obj.kind ?? 'fact').toLowerCase(),
                label: obj.label ? clean(String(obj.label)) : undefined,
                value,
                importance: Number(obj.importance) || 3,
              };
            })
            .filter(Boolean) as ParsedModelOutput['memoryUpdates']
        : [];

      if (replies.length) {
        // guarantee the five canonical buckets exist
        const normalized = ensureBuckets(replies, parsed);
        return {
          intent: String(parsed.intent ?? 'smalltalk'),
          read: clean(String(parsed.read ?? parsed.reasoning ?? parsed.analysis ?? '')),
          replies: normalized,
          memoryUpdates,
          parseFallback: false,
        };
      }
    } catch {
      /* fall through to text parsing */
    }
  }

  return {
    intent: 'other',
    read: '',
    replies: parseLooseReplies(cleaned),
    memoryUpdates: [],
    parseFallback: true,
  };
}

function ensureBuckets(replies: ParsedReply[], parsed: Record<string, unknown>): ParsedReply[] {
  const byStyle = new Map<string, string>();
  for (const r of replies) if (!byStyle.has(r.style)) byStyle.set(r.style, r.body);

  // support models that return an object keyed by style instead of an array
  for (const style of REPLY_STYLES) {
    const direct = (parsed as Record<string, unknown>)[style];
    if (!byStyle.has(style) && typeof direct === 'string' && direct.trim()) {
      byStyle.set(style, clean(direct));
    }
  }

  const out: ParsedReply[] = [];
  const leftovers = replies.filter((r) => r.style !== 'suggested').map((r) => r.body);

  for (const style of REPLY_STYLES) {
    const body = byStyle.get(style);
    if (body) {
      out.push({ style, body });
    } else {
      const alt = leftovers.shift() ?? [...byStyle.values()][0] ?? '';
      if (alt) out.push({ style, body: alt });
    }
  }
  return out;
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Fallback for models that ignore the JSON instruction entirely. */
function parseLooseReplies(text: string): ParsedReply[] {
  const buckets: ParsedReply[] = [];
  const rx = /^\s*(?:\d+[.)]\s*)?\**\s*(suggested|casual|warm|playful|short|custom)\s*[:\-–]\s*(.+)$/gim;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) {
    const body = clean(m[2]);
    if (body) buckets.push({ style: m[1].toLowerCase(), body });
  }
  if (buckets.length >= 2) return ensureBuckets(buckets, {});

  const lines = text
    .split('\n')
    .map((l) => clean(l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '')))
    .filter((l) => l.length > 1 && l.length < 400 && !/^(here|sure|replies|options|json)/i.test(l))
    .slice(0, 5);

  return ensureBuckets(
    lines.map((body, i) => ({ style: REPLY_STYLES[i] ?? 'casual', body })),
    {},
  );
}

function clean(s: string): string {
  return s
    .replace(/\\n/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
