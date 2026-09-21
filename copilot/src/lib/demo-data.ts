import { prisma } from '@/lib/db';

/**
 * Demo dataset.
 *
 * Gives the dashboard, threads and memory panels something realistic to show
 * on first run. Everything here is fictional and only created when the user
 * explicitly asks for it (button in the UI or POST /api/demo/seed).
 */

const CONTACTS = [
  {
    name: 'Aisha',
    phoneNumber: '919812345671',
    avatarColor: '#F472B6',
    tags: 'close, gym',
    notes: 'Met at the climbing gym. Funniest person I know. Gets competitive about everything.',
    isFavorite: true,
    autoSendOverride: null as boolean | null,
    memories: [
      { kind: 'fact', label: 'Work', value: 'Product designer at a fintech startup in Bengaluru; sprint reviews every Thursday.', importance: 4, pinned: true },
      { kind: 'fact', label: 'Birthday', value: 'Birthday is 14 March — she hates surprise parties but loves handwritten notes.', importance: 5, pinned: true },
      { kind: 'preference', label: 'Music', value: 'Obsessed with indie rock and sends songs at 1am. Appreciates a voice note reply over text.', importance: 3, pinned: false },
      { kind: 'taboo', label: 'Avoid', value: 'Do not bring up her ex or the Delhi trip. Sensitive topic.', importance: 5, pinned: true },
      { kind: 'note', label: 'Inside joke', value: 'We call the gym reception guy "Coach Bhaiya".', importance: 2, pinned: false },
    ],
    thread: [
      { from: 'contact', body: 'oye you disappeared after one set yesterday 😤', minutesAgo: 260 },
      { from: 'me', body: 'I was pacing myself. Legendary athletes do that', minutesAgo: 250 },
      { from: 'contact', body: 'sure sure 🙄 anyway are you coming saturday? the new bouldering wall is up', minutesAgo: 240 },
      { from: 'me', body: 'Depends. Will you finally admit I beat you on the slab?', minutesAgo: 232 },
      { from: 'contact', body: 'never. but yes come. 10am?', minutesAgo: 24 },
    ],
    lastIncoming: 'never. but yes come. 10am?',
  },
  {
    name: 'Rohan (bhai)',
    phoneNumber: '919812345672',
    avatarColor: '#34B7F1',
    tags: 'family, brother',
    notes: 'Younger brother. Replies in one word unless it is about cricket or money.',
    isFavorite: false,
    autoSendOverride: false,
    memories: [
      { kind: 'important_date', label: 'Exam', value: 'Semester exams 3–17 December; do not spam him during that window.', importance: 5, pinned: true },
      { kind: 'preference', label: 'Cricket', value: 'Follows RCB obsessively. Will talk for hours if the conversation starts that way.', importance: 3, pinned: false },
    ],
    thread: [
      { from: 'contact', body: 'bro', minutesAgo: 96 },
      { from: 'me', body: 'bol', minutesAgo: 94 },
      { from: 'contact', body: 'RCB ticket chahiye. sunday match. paisa de dunga baad me', minutesAgo: 92 },
      { from: 'contact', body: 'also mom is asking if you are coming home for diwali', minutesAgo: 88 },
    ],
    lastIncoming: 'also mom is asking if you are coming home for diwali',
  },
  {
    name: 'Meera',
    phoneNumber: '919812345673',
    avatarColor: '#8E7CFF',
    tags: 'dating',
    notes: 'Matched on Hinge three weeks ago. Great texter, dry humour. We have met twice — coffee, then the photography walk.',
    isFavorite: true,
    autoSendOverride: null as boolean | null,
    memories: [
      { kind: 'fact', label: 'Job', value: 'Veterinarian — works late shifts, so daytime texts are better.', importance: 4, pinned: true },
      { kind: 'preference', label: 'Humour', value: 'Loves dry, deadpan humour and hates over-complimenting.', importance: 4, pinned: true },
      { kind: 'fact', label: 'Shared interest', value: 'Both into film photography — she shoots on a Pentax K1000.', importance: 3, pinned: false },
      { kind: 'note', label: 'Plan', value: 'She mentioned a Sunday flea market she wants to visit but never named a date.', importance: 3, pinned: true },
    ],
    thread: [
      { from: 'contact', body: 'so that flea market thing everyone keeps posting about?', minutesAgo: 700 },
      { from: 'me', body: 'The one with the terrible chai queue? I am in purely for the chaos', minutesAgo: 690 },
      { from: 'contact', body: 'exactly that one. you free sunday or are you doing something important like laundry', minutesAgo: 45 },
      { from: 'contact', body: 'asking for a friend', minutesAgo: 44 },
    ],
    lastIncoming: 'asking for a friend',
  },
  {
    name: 'Kabir',
    phoneNumber: '919812345674',
    avatarColor: '#FFC145',
    tags: 'work, friend',
    notes: 'College friend, now at the same company (different team). Owes me money for the Goa trip.',
    isFavorite: false,
    autoSendOverride: null as boolean | null,
    memories: [
      { kind: 'note', label: 'Pending', value: 'Owes ₹4,200 from the Goa trip — has "forgotten" twice.', importance: 3, pinned: true },
      { kind: 'preference', label: 'Style', value: 'Only responds to voice notes or blunt one-liners.', importance: 2, pinned: false },
    ],
    thread: [
      { from: 'contact', body: 'bhai the deck for tomorrow', minutesAgo: 1500 },
      { from: 'me', body: 'Sent. Look at slide 7, I fixed the numbers', minutesAgo: 1480 },
      { from: 'contact', body: 'bhai tune abhi bhi numbers fix nahi kiye', minutesAgo: 61 },
      { from: 'contact', body: 'aur paisa bhi dena hai mujhe. yaad dilana pada 🙄', minutesAgo: 60 },
    ],
    lastIncoming: 'aur paisa bhi dena hai mujhe. yaad dilana pada 🙄',
  },
];

const DEMO_USAGE = [
  { provider: 'ollama', model: 'qwen3:8b', promptTokens: 840, completionTokens: 120, latencyMs: 2100, fallbackUsed: false },
  { provider: 'ollama', model: 'qwen3:8b', promptTokens: 910, completionTokens: 140, latencyMs: 1870, fallbackUsed: false },
  { provider: 'mock', model: 'copilot-offline-v1', promptTokens: 780, completionTokens: 110, latencyMs: 42, fallbackUsed: true },
  { provider: 'ollama', model: 'qwen3:8b', promptTokens: 1220, completionTokens: 160, latencyMs: 2650, fallbackUsed: false },
  { provider: 'openai', model: 'gpt-4o-mini', promptTokens: 800, completionTokens: 130, latencyMs: 940, fallbackUsed: false },
];

export interface SeedResult {
  seeded: boolean;
  contacts: number;
  conversations: number;
  messages: number;
  memories: number;
}

export async function seedDemoData(opts: { reset?: boolean } = {}): Promise<SeedResult> {
  if (opts.reset) {
    // order matters: children first (cascade would handle it, but be explicit)
    await prisma.outboundMessage.deleteMany();
    await prisma.generatedReply.deleteMany();
    await prisma.conversationMemory.deleteMany();
    await prisma.message.deleteMany();
    await prisma.webhookEvent.deleteMany();
    await prisma.aiUsageLog.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.contact.deleteMany();
  }

  // ---- style profile ------------------------------------------------------
  await prisma.userStyleProfile.upsert({
    where: { id: 'default' },
    update: {
      displayName: 'You',
      preferredLanguage: 'Hinglish',
      typicalLength: 'short',
      formalityLevel: 3,
      humorLevel: 8,
      flirtinessLevel: 7,
      confidenceLevel: 8,
      emojiUsage: 'moderate',
      commonPhrases: [
        'bhai ye scene kya hai',
        'haan chal',
        'I am in',
        'dekhte hain',
        'obviously',
      ].join('\n'),
      avoidPhrases: [
        'As an AI language model',
        'Dear friend',
        'I hope this message finds you well',
        'kindly do the needful',
        'brb',
      ].join('\n'),
      interests: ['climbing', 'film photography', 'indie music', 'cricket', 'street food', 'film photography'].join('\n'),
      communicationPrefs: [
        'Keep it short — I never write paragraphs on WhatsApp.',
        'Mirror the other person’s energy: if they send one line, send one line.',
        'One question maximum per message.',
        'Light teasing beats compliments.',
        'Never use full stops at the end of a chat message.',
      ].join('\n'),
      trainingSamples: [
        'haan chal, dekhte hain kya hota hai',
        'ok that’s actually a good idea, when?',
        'I was pacing myself. Legendary athletes do that',
        'you say that like it’s a bad thing 😏',
        'done. next time lead with that instead of three paragraphs',
        'arrey yaar, abhi bola hota',
        'honestly? I’d say yes just for the chai',
        'matlab tu busy hai, samajh gaya 😌',
        'come to the gym, I’ll fix your form and your mood',
        'that’s a lot of words for "I missed you"',
      ].join('\n'),
      signature: '',
    },
    create: {
      id: 'default',
      displayName: 'You',
      preferredLanguage: 'Hinglish',
      typicalLength: 'short',
      formalityLevel: 3,
      humorLevel: 8,
      flirtinessLevel: 7,
      confidenceLevel: 8,
      emojiUsage: 'moderate',
    },
  });

  // ---- AI settings --------------------------------------------------------
  await prisma.aiSetting.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      provider: 'ollama',
      fallbackEnabled: true,
      ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
      ollamaModel: process.env.OLLAMA_MODEL || 'qwen3:8b',
      openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.9,
      maxTokens: 320,
      suggestionCount: 5,
      autoSend: false,
      systemPromptExtra:
        'Never be needy or over-eager. If the contact is being dry, stay unbothered — that is how I actually text.',
    },
  });

  let contacts = 0;
  let conversations = 0;
  let messages = 0;
  let memories = 0;

  for (const c of CONTACTS) {
    const contact = await prisma.contact.upsert({
      where: { phoneNumber: c.phoneNumber },
      update: { name: c.name, notes: c.notes, tags: c.tags, isFavorite: c.isFavorite, avatarColor: c.avatarColor },
      create: {
        name: c.name,
        phoneNumber: c.phoneNumber,
        waId: c.phoneNumber,
        avatarColor: c.avatarColor,
        tags: c.tags,
        notes: c.notes,
        isFavorite: c.isFavorite,
      },
    });
    contacts++;

    const existing = await prisma.conversation.findFirst({ where: { contactId: contact.id } });
    const conversation =
      existing ??
      (await prisma.conversation.create({
        data: {
          contactId: contact.id,
          title: `Chat with ${contact.name}`,
          autoSendOverride: c.autoSendOverride,
          lastMessageAt: new Date(Date.now() - 5 * 60 * 1000),
          lastMessagePreview: c.lastIncoming.slice(0, 140),
        },
      }));
    conversations++;

    if (!existing) {
      for (const m of c.thread) {
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            direction: m.from === 'contact' ? 'inbound' : 'outbound',
            sender: m.from === 'contact' ? 'contact' : 'me',
            body: m.body,
            status: m.from === 'contact' ? 'received' : 'read',
            waMessageId: `demo.${c.phoneNumber}.${m.minutesAgo}.${Math.random().toString(36).slice(2, 6)}`,
            createdAt: new Date(Date.now() - m.minutesAgo * 60 * 1000),
          },
        });
        messages++;
      }

      for (const mem of c.memories) {
        await prisma.conversationMemory.create({
          data: {
            conversationId: conversation.id,
            kind: mem.kind,
            label: mem.label,
            value: mem.value,
            importance: mem.importance,
            pinned: mem.pinned,
            source: 'user',
          },
        });
        memories++;
      }

      // a couple of historical drafts so the approval workflow has context
      const lastContactMsg = await prisma.message.findFirst({
        where: { conversationId: conversation.id, direction: 'inbound' },
        orderBy: { createdAt: 'desc' },
      });
      const samples = draftSamplesFor(c.name);
      for (const [i, s] of samples.entries()) {
        await prisma.generatedReply.create({
          data: {
            conversationId: conversation.id,
            sourceMessageId: lastContactMsg?.id ?? null,
            style: s.style,
            body: s.body,
            provider: i === 2 ? 'mock' : 'ollama',
            model: i === 2 ? 'copilot-offline-v1' : 'qwen3:8b',
            latencyMs: 1600 + i * 240,
            status: s.status,
            approvedAt: s.status === 'draft' ? null : new Date(Date.now() - 30 * 60 * 1000),
            sentAt: s.status === 'sent' ? new Date(Date.now() - 28 * 60 * 1000) : null,
            promptTokens: 820 + i * 30,
            completionTokens: 90 + i * 10,
            createdAt: new Date(Date.now() - (120 - i * 15) * 60 * 1000),
          },
        });
      }
    }
  }

  // ---- usage history so the dashboard sparkline has shape ----------------
  for (const [i, u] of DEMO_USAGE.entries()) {
    await prisma.aiUsageLog.create({
      data: {
        provider: u.provider,
        model: u.model,
        promptTokens: u.promptTokens,
        completionTokens: u.completionTokens,
        totalTokens: u.promptTokens + u.completionTokens,
        latencyMs: u.latencyMs,
        fallbackUsed: u.fallbackUsed,
        success: true,
        createdAt: new Date(Date.now() - (i + 1) * 7 * 60 * 60 * 1000),
      },
    });
  }

  await prisma.webhookEvent.create({
    data: {
      source: 'whatsapp',
      eventType: 'demo',
      signatureValid: null,
      payload: JSON.stringify({ note: 'Demo data loaded — this row shows the webhook audit trail format.' }),
      processed: true,
    },
  });

  return { seeded: true, contacts, conversations, messages, memories };
}

function draftSamplesFor(name: string) {
  return [
    { style: 'suggested', body: `haan chal — main aata hoon${name === 'Meera' ? ', but only if you actually wake up on time 😏' : ' 😌'}`, status: 'draft' },
    { style: 'casual', body: 'bol na, kya scene hai', status: 'draft' },
    { style: 'warm', body: 'I’m around, tell me when and I’ll make it work 🤍', status: 'draft' },
    { style: 'playful', body: 'you’re only asking because I’m the fun one, admit it', status: 'discarded' },
    { style: 'short', body: 'haan done', status: 'sent' },
  ];
}
