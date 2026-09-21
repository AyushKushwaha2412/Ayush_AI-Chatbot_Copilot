import { NextRequest } from 'next/server';
import { json, route, ApiError } from '@/lib/api';
import { cancelOutbound, retryOutbound } from '@/lib/whatsapp/queue';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/whatsapp/queue/:id  { action: "cancel" | "retry" } */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };

  if (action === 'cancel') {
    const done = await cancelOutbound(id);
    if (!done) throw new ApiError('Only queued messages can be cancelled.', 409);
    return json({ ok: true, action: 'cancel' });
  }
  if (action === 'retry') {
    const done = await retryOutbound(id);
    if (!done) throw new ApiError('Message not found or already sent.', 409);
    return json({ ok: true, action: 'retry' });
  }
  throw new ApiError('action must be "cancel" or "retry".', 422);
});
