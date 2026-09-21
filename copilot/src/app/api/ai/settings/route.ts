import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { ensureSettings } from '@/lib/ai/reply-service';
import { OllamaProvider, OpenAICompatProvider } from '@/lib/ai';
import { body, json, route } from '@/lib/api';
import { publicAiSettings } from '@/lib/serializers';
import { aiSettingsSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/** GET /api/ai/settings — safe view (secrets masked). */
export const GET = route(async () => {
  const settings = await ensureSettings();
  return json({ ok: true, settings: publicAiSettings(settings) });
});

/**
 * PUT /api/ai/settings
 * Writes provider configuration. The API key travels browser → server once
 * and is stored in the local SQLite file; it is never read back out.
 */
export const PUT = route(async (req: NextRequest) => {
  await ensureSettings();
  const input = aiSettingsSchema.parse(await body(req));

  const data: Record<string, unknown> = { ...input };

  if (typeof input.openaiApiKey === 'string') {
    if (input.openaiApiKey === '***') {
      delete data.openaiApiKey; // sentinel: leave the stored key untouched
    } else if (input.openaiApiKey.trim() === '') {
      data.openaiApiKey = null; // explicit clear
    } else {
      data.openaiApiKey = input.openaiApiKey.trim();
    }
  }

  const updated = await prisma.aiSetting.update({ where: { id: 'default' }, data });

  return json({
    ok: true,
    settings: publicAiSettings(updated),
    note: 'Saved. Credentials stay on the server — they are never returned to the browser.',
  });
});

/** POST /api/ai/settings — list models for a given provider (used by the model picker). */
export const POST = route(async (req: NextRequest) => {
  const settings = await ensureSettings();
  const { provider, baseUrl, model } = (await body(req).catch(() => ({}))) as {
    provider?: 'ollama' | 'openai' | 'mock';
    baseUrl?: string;
    model?: string;
  };

  const which = provider ?? (settings.provider === 'auto' ? 'ollama' : (settings.provider as 'ollama' | 'openai' | 'mock'));

  if (which === 'ollama') {
    const p = new OllamaProvider(baseUrl || settings.ollamaBaseUrl, model || settings.ollamaModel);
    const health = await p.health();
    return json({ ok: health.ok, provider: 'ollama', models: health.models ?? [], message: health.message });
  }
  if (which === 'openai') {
    const p = new OpenAICompatProvider({
      baseUrl: baseUrl || settings.openaiBaseUrl,
      model: model || settings.openaiModel,
      apiKey: settings.openaiApiKey || process.env.OPENAI_API_KEY || '',
    });
    const health = await p.health();
    return json({ ok: health.ok, provider: 'openai', models: health.models ?? [], message: health.message });
  }
  return json({ ok: true, provider: 'mock', models: [{ id: 'copilot-offline-v1' }], message: 'Built-in offline drafter.' });
});
