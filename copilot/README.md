# Conversation Copilot

A **private, full-stack WhatsApp-style conversation assistant** that drafts replies in *your* voice, with a human approval workflow, conversation memory, and a local-first LLM provider abstraction.

The iron rule of the product: an incoming message is **never** answered silently by a machine. Either **you approve** a draft, or you deliberately switch a chat (or the whole app) to **Autopilot**.

```
Incoming message → AI reads context + memory + your style → 3–5 drafts
   → you Edit / Regenerate / Copy / Approve   (Copilot mode)
   → or the top draft is sent automatically   (Autopilot mode)
```

---

## How to run it

**Prerequisites:** Node.js 20 or newer. Nothing else is required — no database server, no API key. Ollama is optional but recommended.

### 1. Install and set up

```bash
cd copilot
npm install        # installs Next.js, React, Prisma
npm run setup      # creates prisma/dev.db and generates the Prisma client
```

### 2. Start it

```bash
npm run dev
```

Open **http://localhost:3000**.

### 3. Load demo data (optional but recommended)

Either click **“Load demo data”** on the dashboard, or from a second terminal:

```bash
npm run seed         # adds 4 fictional conversations, memory and draft history
npm run seed:reset   # wipe chat data and reload it from scratch
```

> The CLI seeder talks to the running app, so `npm run dev` must be running first. It defaults to `http://localhost:3000`; pass a URL to override: `node scripts/seed.mjs http://localhost:3100`.

### 4. Use a real local model (optional)

```bash
ollama serve                 # terminal 1
ollama pull qwen3:8b         # terminal 2 — the model named in Settings by default
```

Refresh the app: the header pill flips from *AI offline* to **Local AI · qwen3:8b**. Verify with the **Test connection** button (it runs a real round-trip completion, not just a ping).

Without Ollama the app still works — the built-in offline drafter takes over so you can exercise the entire approve/edit/send workflow. Add any OpenAI-compatible endpoint (OpenAI, Groq, OpenRouter, vLLM, LM Studio) under *Settings → AI provider*; the key is stored server-side and never sent to the browser.

### 5. Go live on WhatsApp (optional)

The default is **simulation mode** — approvals run the full queue and appear in the thread, but nothing leaves your machine. To send real messages, set your Cloud API credentials in `.env`, then restart:

```env
WHATSAPP_MODE="live"
WHATSAPP_PHONE_NUMBER_ID="..."
WHATSAPP_ACCESS_TOKEN="..."
WHATSAPP_APP_SECRET="..."      # enables webhook signature verification
WHATSAPP_VERIFY_TOKEN="copilot-verify-token"
```

Point Meta's webhook at `https://<your-host>/api/whatsapp/webhook` using the same verify token.

### Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on :3000 (hot reload) |
| `npm run build` && `npm start` | Production build + server on :3000 |
| `npm run seed` / `npm run seed:reset` | Load / reload demo data |
| `npm run smoke` | 41-check end-to-end API test suite |
| `npm run db:push` | Apply schema changes |
| `npm run db:reset` | **Drop and recreate** the database (deletes all data) |

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Port 3000 is in use` | `npx next dev -p 3100`, then `node scripts/seed.mjs http://localhost:3100` |
| Header says *AI offline* | Expected without Ollama. Run `ollama serve`, or set the provider to *Built-in offline drafter* in Settings to silence it. |
| `Ollama reachable. No models found` | `ollama pull qwen3:8b` |
| `@prisma/client did not initialize yet` | `npm run setup` |
| Prisma engine error on a very fresh machine | Re-run `npm install` (it fetches the right engine binary for your OS) |
| Want a clean slate | `npm run db:reset && npm run seed` |

### Deploying somewhere other than localhost

The app is a standard Next.js server, so anything that runs Node (a VPS, Fly.io, Railway, Docker) works. Two things to change: set `DATABASE_URL` to Postgres (change `provider` in `prisma/schema.prisma`, then `npm run db:push`), and set `APP_ACCESS_CODE` so the UI requires a code before the API answers. Note that `localhost:11434` in the Ollama base URL then means *the server's* localhost, not your laptop's — either run Ollama on the same host or expose it deliberately.

---

## What's in the box

| Requirement | Where it lives |
| --- | --- |
| Chat interface (threads, bubbles, media types, search) | `/chat` → `src/components/ChatWorkspace.tsx` |
| AI reply generation (suggested / casual / warm / playful / short + custom) | `src/app/api/ai/reply/route.ts`, `src/lib/ai/reply-service.ts`, `src/lib/ai/prompts.ts` |
| Personal style profile (language, length, formality, humour, emoji, phrases, avoid list, interests, training data) | `/style` → `src/app/api/style/route.ts` |
| Conversation memory (facts, notes, preferences, pinned/taboo, per-contact) | `/memory`, chat side-panel → `ConversationMemory` table |
| AI provider architecture (Ollama + optional OpenAI-compatible + offline fallback) | `src/lib/ai/index.ts`, `src/lib/ai/providers/*` |
| Local AI status indicator (Connected / Disconnected / model / Test connection) | Header pill + Dashboard card → `GET /api/ai/status`, `POST /api/ai/status/test` |
| WhatsApp integration (Cloud API client, webhook, normalization, outbound queue) | `src/lib/whatsapp/*`, `src/app/api/whatsapp/*` |
| Approval workflow (Edit, Regenerate, Copy, Approve, Discard) | `src/components/ReplyCard.tsx` |
| Two modes: suggest-to-me vs send-automatically (global **and** per-chat) | Header toggle, `AiSetting.autoSend`, `Conversation.autoSendOverride` |
| Dashboard (conversations, drafts, AI usage, model status, recent chats, 14-day chart, queue) | `/` → `src/app/api/dashboard/route.ts` |
| Database entities + timestamps + relations | `prisma/schema.prisma` (10 models) |
| Security (server-side secrets, no key leakage, delete memory/conversation) | `src/lib/serializers.ts`, `/settings → Security & privacy`, `POST /api/privacy/purge` |

---

## Architecture

```
Browser (React, no secrets, same-origin fetch only)
   │
   ├── /api/ai/reply ─────────► reply-service
   │                              ├─ prompt builder (style profile + memory + transcript)
   │                              └─ provider chain ─┬─ OllamaProvider      (local, default)
   │                                                 ├─ OpenAICompatProvider(optional, key server-side)
   │                                                 └─ MockProvider        (offline fallback)
   │
   ├── /api/whatsapp/webhook ─► normalize → ingest → contact/conversation/message
   │                                     └─ Autopilot? draft → approve → queue → send
   │
   └── approve ─────────────────► outbound queue ─► Cloud API (live) | recorded locally (simulated)

SQLite via Prisma: contacts, conversations, messages, user_style_profile,
conversation_memory, ai_settings, generated_replies, outbound_messages,
webhook_events, ai_usage_logs
```

### Provider abstraction

Every provider implements one interface (`src/lib/ai/types.ts`):

```ts
interface LlmProvider {
  chat(req: ChatRequest): Promise<ChatResult>
  listModels(): Promise<ProviderModel[]>
  health(): Promise<HealthResult>
}
```

Adding a provider = one file + one line in `buildProvider()`. The chain is resolved from `ai_settings`: primary → optional fallback → offline drafter. Failures are surfaced to the UI instead of being swallowed (“Fell back to the offline drafter because: ollama — not reachable…”).

### The prompt is the product

`buildSystemPrompt()` translates your style profile into instructions: language rules (Hinglish → Roman script, no Devanagari), length budget, formality/humour/flirtiness/confidence dials, emoji policy, signature phrases, a hard *never say* list, interests to bridge to, real writing samples, and the per-contact memory — then demands strict JSON with five labelled buckets plus `memory_updates`.

**See exactly what is sent:** *My style → 👁 See what the AI sees* (`GET /api/style/preview`). Nothing else about you leaves the server.

---

## WhatsApp integration

Three layers, so the provider is swappable:

1. **Normalization** (`whatsapp/normalize.ts`) — flattens Meta's nested webhook JSON into one internal `NormalizedInboundMessage` shape (text, image, audio, document, location, reactions, interactive replies).
2. **Ingest** (`whatsapp/ingest.ts`) — upserts the contact + conversation, stores the message, applies Autopilot if enabled, and is **idempotent by `waMessageId`** (provider retries cannot duplicate your threads).
3. **Outbound queue** (`whatsapp/queue.ts`) — every approved or auto-sent message goes through one path: queued → sending → sent/failed, with attempts, backoff (0s/3s/15s), cancel and retry. Drain it from the UI, after each approval, or on a cron via `POST /api/whatsapp/queue`.

### Simulation vs live

`WHATSAPP_MODE="simulated"` (default): nothing leaves the machine — messages are recorded locally so you can rehearse the whole workflow safely.

`WHATSAPP_MODE="live"`: real sends through the official Cloud API.

```env
WHATSAPP_MODE="live"
WHATSAPP_PHONE_NUMBER_ID="..."
WHATSAPP_ACCESS_TOKEN="..."        # server-side only
WHATSAPP_VERIFY_TOKEN="copilot-verify-token"
WHATSAPP_APP_SECRET="..."          # enables X-Hub-Signature-256 verification
WHATSAPP_API_VERSION="v21.0"
```

Then point Meta at `https://<your-host>/api/whatsapp/webhook` (GET handles the subscribe handshake, POST receives messages + delivery statuses).

> **Personal vs Business API:** the spec asked for an official WhatsApp Business API integration, and that is what's wired here. Automating a **personal** WhatsApp account (whatsapp-web.js / Baileys) is not official and risks a ban — deliberately out of scope. If you ever want it, implement the same `LlmProvider`-style seam: add a transport in `whatsapp/client.ts` that satisfies `sendTextMessage()`; the queue, normalization, approval and UI stay untouched.

---

## Security & privacy

- **Keys never reach the browser.** `publicAiSettings()` is the only serializer for `ai_settings`; it returns `openaiApiKeySet: true` plus a masked hint (`sk-t••••3456`) and never the value. Verified by the smoke test.
- **All model calls are server-side.** The browser only ever calls same-origin `/api/*` routes.
- **Webhook signatures** verified with HMAC-SHA256 (timing-safe) against the raw body when `WHATSAPP_APP_SECRET` is set; rejected events are stored for audit.
- **Optional access code:** set `APP_ACCESS_CODE` to require a code before the API answers.
- **Delete everything, granularly:** per conversation (memory / drafts / messages / wipe-keep-contact / delete entirely), per fact (memory page), or globally in *Settings → Security & privacy*. “Wipe all” removes chats but preserves your style profile and provider config.
- Uses SQLite for zero-setup local operation; swap `provider` in `prisma/schema.prisma` to Postgres for shared use.

---

## API surface

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/ai/reply` | Draft 3–5 replies (the core endpoint) |
| GET | `/api/ai/status` | Local AI indicator payload |
| POST | `/api/ai/status/test` | Health + live round-trip probe |
| GET/PUT/POST | `/api/ai/settings` | Provider config, tuning, model listing |
| GET/PUT/DELETE | `/api/style` | Style profile + training samples |
| GET | `/api/style/preview` | The exact system prompt |
| GET/POST | `/api/conversations` | List / create threads |
| GET/PATCH/DELETE | `/api/conversations/:id` | Thread, per-chat mode, delete |
| GET/POST/DELETE | `/api/conversations/:id/memory` | Memory CRUD |
| POST | `/api/conversations/:id/clear` | Clear messages / memory / drafts / all |
| POST/DELETE | `/api/conversations/:id/messages` | Manual send, simulate inbound, delete a message |
| PATCH | `/api/replies/:id` | edit / approve / discard / regenerate |
| GET/POST | `/api/whatsapp/webhook` | Meta verification + inbound receiver |
| POST | `/api/whatsapp/simulate` | Fire an inbound message through the real pipeline |
| GET/POST | `/api/whatsapp/status`, `/api/whatsapp/queue` | Integration state, queue drain |
| POST | `/api/whatsapp/queue/:id` | cancel / retry |
| GET | `/api/dashboard` | All dashboard numbers |
| POST | `/api/privacy/purge` | Bulk deletions |
| POST | `/api/demo/seed` | Fictional demo dataset |

---

## Verification

`npm run smoke` (or `bash scripts/smoke-test.sh [base_url]`) — **41 checks, all passing**: health, seed, inbound ingestion + idempotency, five-bucket generation, edit → approve → queue → delivered, AI-tagged thread entry, single-bucket regenerate, memory create/edit/delete, style save + prompt preview, **API key never echoed**, webhook verify accept/reject, Cloud-API payload normalization, duplicate-retry safety, Autopilot auto-send, per-chat override, queue drain, clear/purge/delete, dashboard aggregates and the 14-day series.

TypeScript is clean (`npx tsc --noEmit`) and `npm run build` succeeds.

---

## Notes & limits

- **Threads are local** until you configure live WhatsApp. Demo contacts are fictional and seeded only on request.
- `messages.mediaUrl` stores the link; downloading media from the Cloud API requires a separate authenticated fetch (not included).
- The offline drafter is template-based by design — it keeps the product usable with zero setup, but a real model (qwen3:8b or better) is what makes the writing feel like you.
- Autopilot is powerful and riskier: it sends the *top* suggestion without review. Per-chat overrides let you keep a few sensitive chats on manual approval.
