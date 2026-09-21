import { NextRequest } from 'next/server';
import { providerStatus, loadProviderConfig } from '@/lib/ai';
import { json, route } from '@/lib/api';
import { ensureSettings } from '@/lib/ai/reply-service';
import { publicAiSettings } from '@/lib/serializers';

export const dynamic = 'force-dynamic';

/** GET /api/ai/status — powers the "Local AI" indicator. */
export const GET = route(async () => {
  const settings = await ensureSettings();
  const report = await providerStatus();
  const config = await loadProviderConfig();

  return json({
    ok: true,
    status: report.primary.status,
    connected: report.primary.ok,
    provider: report.primary.provider,
    model: report.primary.model,
    activeProvider: report.activeProvider,
    activeModel: report.activeModel,
    message: report.primary.message,
    latencyMs: report.primary.latencyMs ?? null,
    endpoint: report.primary.baseUrlMasked ?? null,
    models: (report.primary.models ?? []).map((m) => ({ id: m.id, family: m.family ?? null })),
    fallback: report.fallback
      ? {
          provider: report.fallback.provider,
          connected: report.fallback.ok,
          model: report.fallback.model,
          message: report.fallback.message,
        }
      : null,
    configuredProvider: settings.provider,
    fallbackEnabled: settings.fallbackEnabled,
    mode: settings.autoSend ? 'autopilot' : 'copilot',
    settings: publicAiSettings(settings),
    resolvedChain: {
      provider: config.provider,
      timeoutMs: config.requestTimeoutMs,
      temperature: config.temperature,
    },
    observedAt: report.observedAt,
  });
});
