import { z } from 'zod';

export const generateReplySchema = z.object({
  conversationId: z.string().min(1),
  incoming: z.string().max(4000).optional(),
  sourceMessageId: z.string().optional(),
  regenerate: z.boolean().optional(),
  steer: z.string().max(500).optional(),
  styleKey: z.string().max(40).optional(),
  onlyStyle: z.enum(['suggested', 'casual', 'warm', 'playful', 'short']).optional(),
  persist: z.boolean().optional(),
});

export const styleProfileSchema = z.object({
  displayName: z.string().max(80).optional(),
  preferredLanguage: z.enum(['English', 'Hindi', 'Hinglish']).optional(),
  typicalLength: z.enum(['very-short', 'short', 'medium', 'long']).optional(),
  formalityLevel: z.number().int().min(1).max(10).optional(),
  humorLevel: z.number().int().min(1).max(10).optional(),
  flirtinessLevel: z.number().int().min(1).max(10).optional(),
  confidenceLevel: z.number().int().min(1).max(10).optional(),
  emojiUsage: z.enum(['none', 'rare', 'moderate', 'heavy']).optional(),
  commonPhrases: z.string().max(4000).optional(),
  avoidPhrases: z.string().max(4000).optional(),
  interests: z.string().max(4000).optional(),
  communicationPrefs: z.string().max(4000).optional(),
  trainingSamples: z.string().max(20000).optional(),
  signature: z.string().max(200).optional(),
});

export const aiSettingsSchema = z.object({
  provider: z.enum(['ollama', 'openai', 'mock', 'auto']).optional(),
  fallbackEnabled: z.boolean().optional(),
  ollamaBaseUrl: z.string().max(300).optional(),
  ollamaModel: z.string().max(120).optional(),
  openaiBaseUrl: z.string().max(300).optional(),
  openaiModel: z.string().max(120).optional(),
  /** write-only: "" clears, "***" means "leave unchanged" */
  openaiApiKey: z.string().max(400).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(64).max(4000).optional(),
  suggestionCount: z.number().int().min(1).max(5).optional(),
  requestTimeoutMs: z.number().int().min(3000).max(300000).optional(),
  systemPromptExtra: z.string().max(4000).optional(),
  autoSend: z.boolean().optional(),
  autoSendThreshold: z.number().int().min(0).max(4).optional(),
});

export const contactSchema = z.object({
  name: z.string().min(1).max(80),
  phoneNumber: z.string().min(6).max(20),
  notes: z.string().max(2000).optional(),
  tags: z.string().max(300).optional(),
});

export const conversationSchema = z.object({
  contactId: z.string().optional(),
  name: z.string().max(80).optional(),
  phoneNumber: z.string().max(20).optional(),
  title: z.string().max(120).optional(),
  openingMessage: z.string().max(2000).optional(),
});

export const memorySchema = z.object({
  kind: z.enum(['fact', 'note', 'preference', 'important_date', 'taboo', 'summary']).default('fact'),
  label: z.string().max(80).optional(),
  value: z.string().min(1).max(2000),
  importance: z.number().int().min(1).max(5).default(3),
  pinned: z.boolean().default(false),
});

export const replyPatchSchema = z.object({
  action: z.enum(['approve', 'discard', 'edit', 'regenerate']),
  body: z.string().max(4000).optional(),
});

export const simulateSchema = z.object({
  from: z.string().min(6).max(20),
  profileName: z.string().max(80).optional(),
  text: z.string().min(1).max(4000),
  /** when true, do NOT auto-draft/send even if Autopilot is on */
  forceCopilot: z.boolean().optional(),
  at: z.string().optional(),
});
