import { json, route } from '@/lib/api';
import { prisma } from '@/lib/db';
import { providerStatus } from '@/lib/ai';
import { ensureSettings } from '@/lib/ai/reply-service';
import { queueStats } from '@/lib/whatsapp/queue';
import { publicStatus } from '@/lib/whatsapp/config';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** GET /api/dashboard — every number shown on the overview screen. */
export const GET = route(async () => {
  const since = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000);
  const settings = await ensureSettings();

  const [
    conversations,
    messages,
    inbound,
    outbound,
    drafts,
    approved,
    sent,
    memories,
    contacts,
    usage,
    usageAgg,
    status,
    queue,
    recent,
    recentUsage,
    topContacts,
  ] = await Promise.all([
    prisma.conversation.count(),
    prisma.message.count(),
    prisma.message.count({ where: { direction: 'inbound' } }),
    prisma.message.count({ where: { direction: 'outbound' } }),
    prisma.generatedReply.count(),
    prisma.generatedReply.count({ where: { status: { in: ['approved', 'sent'] } } }),
    prisma.generatedReply.count({ where: { status: 'sent' } }),
    prisma.conversationMemory.count(),
    prisma.contact.count(),
    prisma.aiUsageLog.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, totalTokens: true, latencyMs: true, fallbackUsed: true, provider: true } }),
    prisma.aiUsageLog.aggregate({
      _sum: { totalTokens: true, promptTokens: true, completionTokens: true },
      _avg: { latencyMs: true },
      _count: { _all: true },
    }),
    providerStatus(),
    queueStats(),
    prisma.conversation.findMany({
      orderBy: { lastMessageAt: 'desc' },
      take: 8,
      include: { contact: true, _count: { select: { messages: true, generatedReplies: true } } },
    }),
    prisma.aiUsageLog.findMany({ orderBy: { createdAt: 'desc' }, take: 12 }),
    prisma.conversation.groupBy({
      by: ['contactId'],
      _count: { _all: true },
      orderBy: { _count: { contactId: 'desc' } },
      take: 5,
    }),
  ]);

  // 14-day activity sparkline
  const series: { day: string; drafts: number; messages: number; tokens: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    series.push({ day: dayKey(d), drafts: 0, messages: 0, tokens: 0 });
  }
  const index = new Map(series.map((s) => [s.day, s]));

  const [msgRows, replyRows] = await Promise.all([
    prisma.message.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
    prisma.generatedReply.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
  ]);
  for (const m of msgRows) {
    const bucket = index.get(dayKey(m.createdAt));
    if (bucket) bucket.messages++;
  }
  for (const r of replyRows) {
    const bucket = index.get(dayKey(r.createdAt));
    if (bucket) bucket.drafts++;
  }
  for (const u of usage) {
    const bucket = index.get(dayKey(u.createdAt));
    if (bucket) bucket.tokens += u.totalTokens;
  }

  const contactIds = topContacts.map((t) => t.contactId);
  const contactRows = await prisma.contact.findMany({ where: { id: { in: contactIds } } });
  const contactMap = new Map(contactRows.map((c) => [c.id, c]));

  const totalDrafts = usageAgg._count._all || 1;

  return json({
    ok: true,
    totals: {
      conversations,
      contacts,
      messages,
      inbound,
      outbound,
      drafts,
      approved,
      sent,
      memories,
      pendingDrafts: drafts - approved,
      approvalRate: drafts ? Math.round((approved / drafts) * 100) : 0,
    },
    usage: {
      requests: usageAgg._count._all,
      promptTokens: usageAgg._sum.promptTokens ?? 0,
      completionTokens: usageAgg._sum.completionTokens ?? 0,
      totalTokens: usageAgg._sum.totalTokens ?? 0,
      avgLatencyMs: Math.round(usageAgg._avg.latencyMs ?? 0),
      fallbackRate: Math.round((usage.filter((u) => u.fallbackUsed).length / totalDrafts) * 100),
      byProvider: Object.entries(
        usage.reduce<Record<string, number>>((acc, u) => {
          acc[u.provider] = (acc[u.provider] ?? 0) + 1;
          return acc;
        }, {}),
      ).map(([provider, count]) => ({ provider, count })),
    },
    localAi: {
      status: status.primary.status,
      connected: status.primary.ok,
      provider: status.activeProvider,
      model: status.activeModel,
      message: status.primary.message,
      configuredProvider: settings.provider,
      fallbackEnabled: settings.fallbackEnabled,
      endpoint: status.primary.baseUrlMasked ?? null,
      latencyMs: status.primary.latencyMs ?? null,
    },
    mode: settings.autoSend ? 'autopilot' : 'copilot',
    autoSend: settings.autoSend,
    whatsapp: publicStatus(),
    queue,
    series,
    recentConversations: recent.map((c) => ({
      id: c.id,
      contactName: c.contact.name,
      avatarColor: c.contact.avatarColor,
      preview: c.lastMessagePreview,
      lastMessageAt: c.lastMessageAt.toISOString(),
      messages: c._count.messages,
      drafts: c._count.generatedReplies,
      autoSendOverride: c.autoSendOverride,
    })),
    recentUsage: recentUsage.map((u) => ({
      id: u.id,
      provider: u.provider,
      model: u.model,
      totalTokens: u.totalTokens,
      latencyMs: u.latencyMs,
      fallbackUsed: u.fallbackUsed,
      success: u.success,
      createdAt: u.createdAt.toISOString(),
    })),
    topContacts: topContacts.map((t) => ({
      contactId: t.contactId,
      name: contactMap.get(t.contactId)?.name ?? 'Unknown',
      conversations: t._count._all,
    })),
  });
});
