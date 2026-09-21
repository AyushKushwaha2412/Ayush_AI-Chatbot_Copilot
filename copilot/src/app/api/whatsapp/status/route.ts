import { NextRequest } from 'next/server';
import { json, route } from '@/lib/api';
import { publicStatus, getWhatsAppConfig } from '@/lib/whatsapp/config';
import { verifyCloudApiCredentials } from '@/lib/whatsapp/client';
import { queueStats } from '@/lib/whatsapp/queue';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** GET /api/whatsapp/status — integration view (no secrets exposed). */
export const GET = route(async (req: NextRequest) => {
  const status = publicStatus();
  const queue = await queueStats();
  const test = req.nextUrl.searchParams.get('test') === '1';

  const recentEvents = await prisma.webhookEvent.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      eventType: true,
      signatureValid: true,
      processed: true,
      processingError: true,
      createdAt: true,
    },
  });

  const counts = await Promise.all([
    prisma.message.count({ where: { direction: 'inbound' } }),
    prisma.message.count({ where: { direction: 'outbound' } }),
    prisma.webhookEvent.count(),
  ]);

  return json({
    ok: true,
    ...status,
    queue,
    counts: { inbound: counts[0], outbound: counts[1], webhookEvents: counts[2] },
    recentEvents: recentEvents.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
    credentials: getWhatsAppConfig().liveReady ? 'configured' : 'incomplete',
    liveCheck: test ? await verifyCloudApiCredentials() : null,
  });
});
