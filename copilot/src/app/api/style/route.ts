import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { ensureProfile } from '@/lib/ai/reply-service';
import { body, json, route } from '@/lib/api';
import { publicStyleProfile } from '@/lib/serializers';
import { styleProfileSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/** GET /api/style — the personal style profile that trains every draft. */
export const GET = route(async () => {
  const profile = await ensureProfile();
  return json({ ok: true, profile: publicStyleProfile(profile) });
});

/** PUT /api/style — save edits. */
export const PUT = route(async (req: NextRequest) => {
  await ensureProfile();
  const input = styleProfileSchema.parse(await body(req));
  const updated = await prisma.userStyleProfile.update({ where: { id: 'default' }, data: input });
  return json({ ok: true, profile: publicStyleProfile(updated) });
});

/** DELETE /api/style/samples — wipe the uploaded training samples. */
export const DELETE = route(async () => {
  await ensureProfile();
  const updated = await prisma.userStyleProfile.update({
    where: { id: 'default' },
    data: { trainingSamples: '' },
  });
  return json({ ok: true, profile: publicStyleProfile(updated), message: 'Style training samples cleared.' });
});
