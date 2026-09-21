import { ChatRequest, ChatResult, HealthResult, LlmProvider, ProviderModel } from '../types';

/**
 * Offline fallback provider.
 *
 * Never touches the network, so drafting, approval, autopilot and memory all
 * keep working when Ollama is not running. It reads the same style-profile
 * block the real prompt uses and composes replies from language- and
 * intent-aware templates — enough to demo every branch of the product
 * without downloading a model.
 */
export class MockProvider implements LlmProvider {
  readonly id = 'mock' as const;
  readonly label = 'Built-in offline drafter';
  readonly model = 'copilot-offline-v1';

  get endpoint() {
    return 'Local · no network required';
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const started = Date.now();
    const system = req.messages.find((m) => m.role === 'system')?.content ?? '';
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const text = composeOfflineReplies(system, lastUser, req.json !== false);

    return {
      text,
      provider: this.id,
      model: this.model,
      latencyMs: Math.max(40, Date.now() - started + 45),
      usage: {
        promptTokens: Math.round(system.length / 4),
        completionTokens: Math.round(text.length / 4),
        totalTokens: Math.round((system.length + text.length) / 4),
      },
      notes: ['Drafted by the built-in offline drafter — no LLM was reachable.'],
    };
  }

  async listModels(): Promise<ProviderModel[]> {
    return [{ id: this.model, label: 'Built-in offline drafter' }];
  }

  async health(): Promise<HealthResult> {
    return {
      ok: true,
      status: 'connected',
      provider: this.id,
      model: this.model,
      message: 'Built-in offline drafter ready (no network needed).',
      models: [{ id: this.model, label: 'Built-in offline drafter' }],
    };
  }
}

/* ------------------------------------------------------------------ context */

type Style = 'suggested' | 'casual' | 'warm' | 'playful' | 'short';
type Intent = 'question' | 'plan' | 'money' | 'flirt' | 'support' | 'greeting' | 'dry' | 'smalltalk' | 'other';
type Lang = 'Hinglish' | 'Hindi' | 'English';

interface Ctx {
  lang: Lang;
  length: string;
  formality: number;
  humor: number;
  flirt: number;
  confidence: number;
  emojis: string;
  avoid: string[];
  phrases: string[];
  interests: string[];
  contact: string;
  incoming: string;
  topic: string;
  intent: Intent;
  /** true when no usable topic could be extracted from the message */
  weakTopic: boolean;
}

const STOP = new Set([
  'the', 'and', 'you', 'your', 'are', 'was', 'were', 'for', 'with', 'that', 'this', 'have', 'has', 'had',
  'kya', 'hai', 'hoon', 'mera', 'meri', 'tum', 'tumhe', 'mujhe', 'kaise', 'kab', 'kahan', 'bhi', 'nahi',
  'just', 'sent', 'will', 'would', 'should', 'about', 'from', 'they', 'them', 'then', 'than', 'when',
  'what', 'where', 'which', 'some', 'very', 'really', 'like', 'okay', 'yeah', 'sure', 'here', 'there',
  // filler verbs/nouns that read badly when dropped into a sentence
  'asking', 'asked', 'friend', 'people', 'thing', 'things', 'stuff', 'need', 'want', 'give', 'make',
  'take', 'come', 'coming', 'going', 'know', 'tell', 'said', 'says', 'think', 'maybe', 'fine', 'good',
  'hey', 'hello', 'also', 'still', 'much', 'many', 'more', 'most', 'only', 'even', 'well', 'back', 'down',
  'over', 'into', 'out', 'now', 'today', 'tomorrow', 'tonight',
  'oye', 'arre', 'arrey', 'but', 'never', 'yes', 'well', 'free', 'busy', 'okay', 'ok',
  'thinking', 'thought', 'actually', 'anyway', 'again', 'always', 'nevermind', 'please',
  'chal', 'kar', 'karo', 'karu', 'dekh', 'bata', 'bolo', 'bola', 'baat', 'scene', 'matlab',
  'yaar', 'bhai', 're', 'toh', 'phir', 'abhi', 'warna', 'sab', 'kuch', 'tera', 'teri', 'tere',
  'dilana', 'dena', 'deni', 'lena', 'karna', 'hona', 'jaana', 'aana', 'raha', 'gaya', 'gayi',
]);

function readContext(system: string, user: string): Ctx {
  const grab = (label: string, fallback = '') => {
    const m = system.match(new RegExp(`^${label}\\s*:\\s*(.+)$`, 'im'));
    return m ? m[1].trim() : fallback;
  };
  const num = (label: string, fallback: number) => {
    const m = system.match(new RegExp(`^${label}\\s*:\\s*(\\d+)`, 'im'));
    return m ? Number(m[1]) : fallback;
  };
  const list = (label: string) => {
    const raw = grab(label);
    if (!raw) return [];
    return raw
      .split(/[,\n;|]/)
      .map((s) => s.replace(/^[-•*]\s*/, '').trim())
      .filter((s) => s && !/^(none|n\/a|—|\()/i.test(s));
  };

  const incoming = extractIncoming(user);
  const words = incoming
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !STOP.has(w.toLowerCase()));
  // Longest word wins: longer words carry more meaning ("saturday" beats "oye").
  // If nothing survives the stop list, we go generic rather than quote junk back.
  const candidates = [...new Set(words)].filter(
    (w) => w.length >= 4 && !/^\d/.test(w) && /[a-z\u0900-\u097F]/i.test(w),
  );
  const topic = candidates.sort((a, b) => b.length - a.length)[0] ?? '';
  const weakTopic = !topic;

  const langRaw = grab('Preferred language', 'Hinglish');
  const lang: Lang = langRaw.startsWith('Hindi') ? 'Hindi' : langRaw.startsWith('English') ? 'English' : 'Hinglish';

  return {
    lang,
    length: grab('Typical length', 'short'),
    formality: num('Formality', 4),
    humor: num('Humor', 6),
    flirt: num('Flirtiness', 6),
    confidence: num('Confidence', 7),
    emojis: grab('Emoji usage', 'moderate').toLowerCase(),
    avoid: list('Never say / never do'),
    phrases: list('Signature phrases'),
    interests: list('Their interests'),
    contact: grab('Contact name', 'them'),
    incoming,
    topic,
    intent: classify(incoming),
    weakTopic,
  };
}

/** Pulls the real message out of "Rohan just sent: \"…\"" style wrappers. */
function extractIncoming(user: string): string {
  const quoted = user.match(/(?:just sent|sent|says|said)\s*:\s*"([\s\S]*?)"\s*$/i);
  if (quoted) return quoted[1].trim();
  const afterMarker = user.split(/INCOMING MESSAGE/i).pop() ?? user;
  return afterMarker.replace(/^[:\s"]+/, '').replace(/["\s]+$/, '').trim() || user.trim();
}

function classify(msg: string): Intent {
  const m = msg.toLowerCase();
  if (/^[\s\S]{0,14}[?？]\s*$/.test(m) || /^(kya|kaise|kab|kahan|kaun|what|when|where|why|how|who|are you|can you|will you)\b/i.test(m)) return 'question';
  if (/(free|plan|saturday|sunday|tonight|tomorrow|meet|milna|aaja|aa ja|chal|calender|time|10am|schedule|diwali|weekend)/i.test(m)) return 'plan';
  if (/(paisa|paise|money|pay|refund|owe|dena hai|upi|split|bill|ticket)/i.test(m)) return 'money';
  if (/(miss you|love|cutie|handsome|😏|😘|😍|flirt|date|dinner with me)/i.test(m)) return 'flirt';
  if (/(sorry|sad|tired|stressed|problem|kharab|bura|hate|upset|alone|help me)/i.test(m)) return 'support';
  if (/^(hey|hi|hello|oye|yo|hii+|namaste|good morning|gm)\b/i.test(m.trim())) return 'greeting';
  if (m.trim().split(/\s+/).length <= 2) return 'dry';
  return 'smalltalk';
}

/* -------------------------------------------------------------- composition */

function composeOfflineReplies(system: string, user: string, asJson: boolean): string {
  const ctx = readContext(system, user);
  const set: Record<Style, string> = {
    suggested: build('suggested', ctx),
    casual: build('casual', ctx),
    warm: build('warm', ctx),
    playful: build('playful', ctx),
    short: build('short', ctx),
  };

  if (!asJson) {
    return (Object.entries(set) as [string, string][]).map(([k, v]) => `${k.toUpperCase()}: ${v}`).join('\n');
  }

  return JSON.stringify(
    {
      intent: ctx.intent,
      read: `Offline drafter: reads this as a ${ctx.intent} message about "${ctx.topic}".`,
      replies: (['suggested', 'casual', 'warm', 'playful', 'short'] as Style[]).map((style) => ({
        style,
        body: set[style],
      })),
      memory_updates: [],
    },
    null,
    2,
  );
}

function build(style: Style, ctx: Ctx): string {
  const bucket = TEMPLATES[ctx.lang][style];
  const text = ctx.weakTopic ? GENERIC[ctx.lang][style] : (bucket[ctx.intent] ?? bucket.other);
  let out = text
    .replaceAll('{topic}', ctx.topic)
    .replaceAll('{name}', ctx.contact.split(/\s|\(/)[0])
    .replaceAll('{interest}', ctx.interests[0] ?? ctx.topic);

  out = applyDials(out, style, ctx);
  out = maybePhrase(out, style, ctx);
  out = limitLength(out, style, ctx);
  out = emojify(out, style, ctx);
  return scrub(out, ctx);
}

const TEMPLATES: Record<Lang, Record<Style, Partial<Record<Intent, string>> & { other: string }>> = {
  Hinglish: {
    suggested: {
      plan: 'haan chal — {topic} ka main dekh lunga, tu bas time bata',
      question: 'haan bhai, {topic} ke liye I’m in. Bata kya karna hai',
      money: 'theek hai, {topic} ka hisaab kar dete hain aaj hi — kitna bhejna hai?',
      flirt: 'tujhse baat karke hi mera mood set ho jata hai 😌 chalo aage badho',
      support: 'main hoon na. bata kya hua — {topic} ka tension mujhpe chhod de',
      greeting: 'arre wah, {name} — kya scene hai aaj ka?',
      dry: 'kuch toh baat karo, ek shabd me kaam nahi chalega 😏',
      smalltalk: 'haan suna, {topic} kaafi interesting lag raha hai. aage bata',
      other: 'haan chal, {topic} pe baat karte hain — main in hoon',
    },
    casual: {
      plan: 'chalo theek hai, sunday ko dekhte hain',
      question: 'haan bilkul, kya scene hai?',
      money: 'haan bhej de, main kar deta hoon',
      flirt: 'arre wah, aaj mood achha hai lagta hai 😄',
      support: 'tension mat le, sab set ho jayega',
      greeting: 'oye! kya haal hai',
      dry: 'bol na, kya baat hai',
      smalltalk: 'haan haan, suna maine',
      other: 'theek hai, chal',
    },
    warm: {
      plan: 'I’d love that 🤍 tell me the time and I’ll be there — you don’t have to chase me for it',
      question: 'Achha laga tu poochh rahi hai 🤍 haan, main kar dunga. Tension mat le',
      money: 'chill, main handle kar deta hoon. Tu bas bata dena',
      flirt: 'sach bataun? tere messages padhke smile aa jaati hai 🤍',
      support: 'Sun raha hoon properly. Chhoti si baat bhi ho, bata dena — I’m not going anywhere',
      greeting: 'Hey, kaafi din baad 🤍 sab theek?',
      dry: 'sab theek hai na? bas ek word me reply aata hai to lagta hai kuch hai',
      smalltalk: 'nice, sunke achha laga 🤍 aage kya?',
      other: 'Achha laga tu bola 🤍 main saath hoon',
    },
    playful: {
      plan: '{topic}? convenient — bilkul mere free weekend pe 😏 chalo, par tu chai sponsor karega',
      question: 'hmm interesting sawaal. jawab ke liye pehle ek smile bhej 😏',
      money: 'arre aaj kal tu hisaab kitna yaad rakhta hai 😏 pehle meri chai, phir baat',
      flirt: 'this is dangerously close to flirting and I’m not complaining 😏',
      support: 'drama mat karo, tum strong ho 😌 aur main hoon hi',
      greeting: 'dekho kaun aaya! main toh busy tha… theek hai, thoda free hoon 😏',
      dry: 'ek shabd? itne kaam se thak gaya kya 😏',
      smalltalk: 'dilchasp. ab aage batao, ya mujhe kheench ke nikalna padega 😏',
      other: 'interesting 😏 aage kya plan hai',
    },
    short: {
      plan: 'haan chal.',
      question: 'haan, ho jayega.',
      money: 'theek hai, bhej de.',
      flirt: 'noted 😏',
      support: 'main hoon.',
      greeting: 'oye!',
      dry: 'bol na.',
      smalltalk: 'achha.',
      other: 'theek hai.',
    },
  },
  English: {
    suggested: {
      plan: 'Yes, I’m in for {topic} — I’ll sort my side, you just tell me the time',
      question: 'Yeah, {topic} works for me. Tell me what you need and I’ll handle it',
      money: 'Fine by me — let’s settle {topic} today, just tell me how much',
      flirt: 'Honestly? Just hearing from you fixes my mood 😌 keep going',
      support: 'I’m right here. Tell me what happened — leave the {topic} worry to me',
      greeting: 'Well look who it is — what’s the plan today?',
      dry: 'One word isn’t a conversation, you know 😏',
      smalltalk: '{topic} sounds interesting, go on',
      other: 'Yeah, let’s do it — I’m in',
    },
    casual: {
      plan: 'Sure, Sunday works. Let’s figure it out',
      question: 'Yeah of course, what’s up?',
      money: 'Just send it over, I’ll handle my bit',
      flirt: 'Someone’s in a good mood today 😄',
      support: 'Don’t stress, it’ll work out',
      greeting: 'Hey! How’ve you been',
      dry: 'Go on then, what is it',
      smalltalk: 'Yeah, I saw that',
      other: 'Alright, sounds fine',
    },
    warm: {
      plan: 'I’d genuinely love that 🤍 give me a time and I’ll be there — no need to chase me for it',
      question: 'Glad you asked 🤍 yes, I’ll take care of it. Don’t worry about it',
      money: 'Don’t stress about it, I’ll sort it out. Just keep me posted',
      flirt: 'Honest answer? Your messages make me smile 🤍',
      support: 'I’m listening, properly. Tell me everything — I’m not going anywhere',
      greeting: 'Hey, it’s been a while 🤍 you okay?',
      dry: 'Everything alright? One-word replies worry me a bit',
      smalltalk: 'Nice, that’s good to hear 🤍 what’s next?',
      other: 'Really glad you said that 🤍 I’m around',
    },
    playful: {
      plan: '{topic}? How convenient — on the one weekend I’m free 😏 fine, but you’re buying the chai',
      question: 'Tough question. To answer it I need better framing — or a smile 😏',
      money: 'You’ve suddenly become very good at accounting 😏 my drink first, then we talk',
      flirt: 'This is dangerously close to flirting and I’m not complaining 😏',
      support: 'Enough drama, you’re tougher than this 😌 and you’ve got me',
      greeting: 'Look who showed up! I was busy… okay fine, mildly free 😏',
      dry: 'One word? That all the energy you have today? 😏',
      smalltalk: 'Interesting. Continue, or I’ll have to drag it out of you 😏',
      other: 'Interesting 😏 what’s the plan then',
    },
    short: {
      plan: 'Yes, let’s.',
      question: 'Yeah, done.',
      money: 'Fine, send it.',
      flirt: 'Noted 😏',
      support: 'I’m here.',
      greeting: 'Hey you!',
      dry: 'Go on.',
      smalltalk: 'Nice.',
      other: 'Sure.',
    },
  },
  Hindi: {
    suggested: {
      plan: 'हाँ चल, {topic} की तैयारी मैं देख लूँगा — तू बस समय बता',
      question: 'हाँ, हो जाएगा। बता क्या करना है',
      money: 'ठीक है, आज ही हिसाब कर देते हैं',
      flirt: 'तुझसे बात करके मूड ठीक हो जाता है 😌 आगे बता',
      support: 'मैं हूँ ना। बता क्या हुआ, टेंशन मत ले',
      greeting: 'अरे वाह, क्या चल रहा है?',
      dry: 'कुछ तो बोल, एक शब्द में बात नहीं बनेगी 😏',
      smalltalk: 'अच्छा, आगे बता',
      other: 'हाँ चल, बात करते हैं',
    },
    casual: {
      plan: 'ठीक है, चल',
      question: 'हाँ बिल्कुल, क्या बात है?',
      money: 'भेज दे, कर देता हूँ',
      flirt: 'अरे वाह 😄',
      support: 'टेंशन मत ले, सब ठीक हो जाएगा',
      greeting: 'अरे! कैसा है',
      dry: 'बोल ना, क्या हुआ',
      smalltalk: 'हाँ देखा',
      other: 'ठीक है',
    },
    warm: {
      plan: 'मुझे बहुत अच्छा लगेगा 🤍 समय बता देना, मैं पहुँच जाऊँगा',
      question: 'अच्छा लगा तूने पूछा 🤍 हाँ, मैं कर दूँगा',
      money: 'तू चिंता मत कर, मैं देख लूँगा',
      flirt: 'सच बताऊँ? तेरे मैसेज पढ़कर मुस्कुराहट आ जाती है 🤍',
      support: 'सुन रहा हूँ ध्यान से। बता दे, मैं हूँ यहाँ 🤍',
      greeting: 'अरे बहुत दिन बाद 🤍 सब ठीक?',
      dry: 'सब ठीक है ना? एक शब्द वाला जवाब थोड़ा चिंता देता है',
      smalltalk: 'अच्छा लगा सुनकर 🤍',
      other: 'अच्छा लगा तूने बताया 🤍',
    },
    playful: {
      plan: '{topic}? क्या बात है, बिल्कुल मेरे खाली वीकेंड पर 😏 चल, पर चाय तेरी',
      question: 'अच्छा सवाल है 😏 पहले मुस्कुरा के दिखा',
      money: 'आजकल तुझे हिसाब बहुत याद रहता है 😏',
      flirt: 'ये तो सीधा फ्लर्ट है, और मुझे कोई दिक्कत नहीं 😏',
      support: 'इतना ड्रामा मत कर, तू मजबूत है 😌 और मैं हूँ ही',
      greeting: 'देखो कौन आया 😏',
      dry: 'एक शब्द? बहुत थक गया है क्या 😏',
      smalltalk: 'दिलचस्प 😏 आगे बता',
      other: 'दिलचस्प 😏',
    },
    short: {
      plan: 'हाँ चल।',
      question: 'हाँ, हो जाएगा।',
      money: 'ठीक है।',
      flirt: 'नोटेड 😏',
      support: 'मैं हूँ।',
      greeting: 'अरे!',
      dry: 'बोल।',
      smalltalk: 'अच्छा।',
      other: 'ठीक है।',
    },
  },
};

/**
 * Fallbacks used when the message has no extractable topic (short replies,
 * idioms like "asking for a friend", reactions, emoji-only). Interpolating a
 * junk keyword into a sentence reads worse than saying nothing.
 */
const GENERIC: Record<Lang, Record<Style, string>> = {
  Hinglish: {
    suggested: 'haan bolo — sun raha hoon',
    casual: 'haan haan, bol na',
    warm: 'Hey, sab theek? Bata na 🤍',
    playful: 'itna mysterious kyun 😏 seedha bolo',
    short: 'bolo.',
  },
  English: {
    suggested: 'Yeah, go on — I’m listening',
    casual: 'Ha, go on then',
    warm: 'Hey, you okay? Tell me 🤍',
    playful: 'Why so mysterious 😏 just say it',
    short: 'Go on.',
  },
  Hindi: {
    suggested: 'हाँ बोल, सुन रहा हूँ',
    casual: 'हाँ हाँ, बोल ना',
    warm: 'अरे, सब ठीक? बता 🤍',
    playful: 'इतना रहस्य क्यों 😏 सीधे बोल',
    short: 'बोल।',
  },
};

/** Confidence removes hedging; flirt dial adds the knowing edge. */
function applyDials(text: string, style: Style, ctx: Ctx): string {
  let out = text;
  if (ctx.confidence >= 8) out = out.replace(/^(maybe|perhaps|i think|shayad)\s+/i, '');
  if (ctx.confidence <= 3) out = `I think ${out[0].toLowerCase()}${out.slice(1)}`;
  if (ctx.flirt >= 7 && (style === 'playful' || style === 'suggested') && !/[😏😌🤍]/.test(out)) {
    out = out.endsWith('.') ? `${out.slice(0, -1)} 😏` : out;
  }
  if (ctx.humor >= 8 && style === 'casual' && ctx.intent === 'smalltalk' && !/😄|😂/.test(out)) {
    out = `${out} 😄`;
  }
  if (style === 'short' && ctx.length === 'very-short') {
    out = out.split(/\s+/).slice(0, 5).join(' ');
  }
  return out;
}

function maybePhrase(text: string, style: Style, ctx: Ctx): string {
  if (!ctx.phrases.length) return text;
  const eligible = style === 'suggested' || style === 'casual';
  if (!eligible || ctx.confidence < 7 || Math.random() > 0.55) return text;
  const phrase = ctx.phrases[Math.floor(Math.random() * ctx.phrases.length)];
  if (text.toLowerCase().includes(phrase.toLowerCase().slice(0, 8))) return text;
  return style === 'casual' ? `${phrase}. ${text}` : `${phrase} — ${text[0].toLowerCase()}${text.slice(1)}`;
}

function limitLength(text: string, style: Style, ctx: Ctx): string {
  if (style === 'short') return text;
  if (ctx.length === 'very-short' && text.split(/\s+/).length > 12) {
    return text.split(/(?<=[.!?])\s/)[0];
  }
  if (ctx.length === 'short' && text.split(/\s+/).length > 24) {
    return text.split(/(?<=[.!?])\s/).slice(0, 2).join(' ');
  }
  return text;
}

function emojify(text: string, style: Style, ctx: Ctx): string {
  if (ctx.emojis === 'none') return stripEmoji(text);
  if (hasEmoji(text)) {
    return ctx.emojis === 'rare' ? text.replace(/\s*\p{Extended_Pictographic}+/gu, (m, i: number) => (i < 3 ? m : '')).trim() : text;
  }
  const pool =
    style === 'warm' ? ['🤍', '😊'] : style === 'playful' ? ['😏', '😄'] : style === 'short' ? ['👍'] : ['✨', '😌'];
  if (ctx.emojis === 'rare' && Math.random() > 0.45) return text;
  return `${text.replace(/[.,;]+$/, '')} ${pool[Math.floor(Math.random() * pool.length)]}`;
}

function hasEmoji(text: string) {
  return /\p{Extended_Pictographic}/u.test(text);
}

function stripEmoji(text: string) {
  return text.replace(/\p{Extended_Pictographic}/gu, '').replace(/\s{2,}/g, ' ').trim();
}

/** Hard constraint: never emit a forbidden phrase. */
function scrub(text: string, ctx: Ctx): string {
  let out = text;
  for (const bad of ctx.avoid) {
    const clean = bad.replace(/^[-•*]\s*/, '').trim();
    if (!clean || clean.length < 2) continue;
    out = out.replace(new RegExp(escapeRe(clean), 'gi'), '');
  }
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
