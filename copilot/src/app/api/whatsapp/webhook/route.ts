import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { applyStatusUpdate, ingestInbound } from '@/lib/whatsapp/ingest';
import { normalizeWebhook } from '@/lib/whatsapp/normalize';
import { verifyChallenge, verifySignature } from '@/lib/whatsapp/verify';
import { markRead } from '@/lib/whatsapp/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET /api/whatsapp/webhook
 * Meta's subscription handshake. Point your Cloud API webhook at this URL and
 * set the verify token to WHATSAPP_VERIFY_TOKEN.
 */
export async function GET(req: NextRequest) {
  const result = verifyChallenge(req.nextUrl.searchParams);
  if (!result.ok) {
    return new NextResponse(result.reason ?? 'verification failed', { status: 403 });
  }
  // Meta expects the raw challenge as a plain-text body.
  return new NextResponse(result.challenge ?? '', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

/**
 * POST /api/whatsapp/webhook
 *
 * Inbound message receiver:
 *   raw body → HMAC signature check → raw event stored → normalized
 *   → contact/conversation upsert → message stored → (Autopilot?) draft + send
 *
 * Always answers 200 quickly: Meta retries anything non-2xx, which would
 * duplicate messages. Our own idempotency guard (waMessageId) is the second
 * line of defence for retries that do happen.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get('x-hub-signature-256');
  const check = verifySignature(raw, signature);

  if (check.checked && !check.valid) {
    await prisma.webhookEvent.create({
      data: {
        source: 'whatsapp',
        eventType: 'rejected',
        signatureValid: false,
        payload: raw.slice(0, 8000),
        processingError: check.reason ?? 'invalid signature',
        processed: false,
      },
    });
    return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: 'Body must be JSON' }, { status: 400 });
  }

  const normalized = normalizeWebhook(payload);

  const event = await prisma.webhookEvent.create({
    data: {
      source: 'whatsapp',
      eventType: normalized.eventType,
      signatureValid: check.checked ? check.valid : null,
      payload: raw.slice(0, 20000),
    },
  });

  const results: Record<string, unknown>[] = [];

  try {
    for (const msg of normalized.messages) {
      const ingested = await ingestInbound(msg);
      results.push({
        waMessageId: msg.waMessageId,
        ...ingested,
        generated: undefined,
      });
      // best-effort read receipt in live mode
      void markRead(msg.waMessageId);
    }

    for (const st of normalized.statuses) {
      await applyStatusUpdate(st.waMessageId, st.status, st.error);
      results.push({ statusUpdate: st.waMessageId, state: st.status });
    }

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processed: true },
    });
  } catch (err) {
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processed: false, processingError: (err as Error).message },
    });
    console.error('[whatsapp:webhook]', (err as Error).message);
  }

  return NextResponse.json({
    ok: true,
    received: normalized.messages.length,
    statuses: normalized.statuses.length,
    eventType: normalized.eventType,
    signatureChecked: check.checked,
    results,
  });
}
