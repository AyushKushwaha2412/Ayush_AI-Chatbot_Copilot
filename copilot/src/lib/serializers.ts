import type { AiSetting } from '@prisma/client';
import { maskSecret } from '@/lib/ai/types';

/**
 * Serialisation boundary.
 *
 * EVERY response that touches ai_settings goes through here. Secrets are
 * replaced with a masked hint, so an API key can never leak into the browser
 * via a fetch, a server-rendered payload, or a React devtools snapshot.
 */
export function publicAiSettings(row: AiSetting) {
  return {
    id: row.id,
    provider: row.provider,
    fallbackEnabled: row.fallbackEnabled,
    ollamaBaseUrl: row.ollamaBaseUrl,
    ollamaModel: row.ollamaModel,
    openaiBaseUrl: row.openaiBaseUrl,
    openaiModel: row.openaiModel,
    openaiApiKeySet: Boolean(row.openaiApiKey),
    openaiApiKeyMasked: maskSecret(row.openaiApiKey),
    openaiApiKeyFromEnv: !row.openaiApiKey && Boolean(process.env.OPENAI_API_KEY),
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    suggestionCount: row.suggestionCount,
    requestTimeoutMs: row.requestTimeoutMs,
    systemPromptExtra: row.systemPromptExtra,
    autoSend: row.autoSend,
    autoSendThreshold: row.autoSendThreshold,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function publicStyleProfile(row: {
  id: string;
  displayName: string;
  preferredLanguage: string;
  typicalLength: string;
  formalityLevel: number;
  humorLevel: number;
  flirtinessLevel: number;
  confidenceLevel: number;
  emojiUsage: string;
  commonPhrases: string;
  avoidPhrases: string;
  interests: string;
  communicationPrefs: string;
  trainingSamples: string;
  signature: string;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    displayName: row.displayName,
    preferredLanguage: row.preferredLanguage,
    typicalLength: row.typicalLength,
    formalityLevel: row.formalityLevel,
    humorLevel: row.humorLevel,
    flirtinessLevel: row.flirtinessLevel,
    confidenceLevel: row.confidenceLevel,
    emojiUsage: row.emojiUsage,
    commonPhrases: row.commonPhrases,
    avoidPhrases: row.avoidPhrases,
    interests: row.interests,
    communicationPrefs: row.communicationPrefs,
    trainingSamples: row.trainingSamples,
    trainingSampleCount: row.trainingSamples
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean).length,
    signature: row.signature,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}
