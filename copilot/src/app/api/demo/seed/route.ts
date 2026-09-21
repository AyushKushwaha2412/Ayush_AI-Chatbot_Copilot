import { NextRequest } from 'next/server';
import { json, route } from '@/lib/api';
import { seedDemoData } from '@/lib/demo-data';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST /api/demo/seed  { reset?: boolean } — load (or reload) the demo dataset. */
export const POST = route(async (req: NextRequest) => {
  const { reset } = (await req.json().catch(() => ({}))) as { reset?: boolean };
  const result = await seedDemoData({ reset: Boolean(reset) });
  return json({ ok: true, ...result });
});
