import crypto from 'node:crypto';
import { getWhatsAppConfig } from './config';

/**
 * Webhook security.
 *
 * Meta signs every POST body with HMAC-SHA256 using the app secret and sends
 * it as `X-Hub-Signature-256`. We verify against the RAW body — parsing first
 * and re-serialising would change the bytes and break the signature.
 */
export function verifySignature(rawBody: string, signatureHeader: string | null): {
  checked: boolean;
  valid: boolean;
  reason?: string;
} {
  const cfg = getWhatsAppConfig();
  if (!cfg.appSecret) {
    return { checked: false, valid: true, reason: 'No app secret configured — signature not enforced.' };
  }
  if (!signatureHeader) {
    return { checked: true, valid: false, reason: 'Missing X-Hub-Signature-256 header.' };
  }

  const expected =
    'sha256=' + crypto.createHmac('sha256', cfg.appSecret).update(rawBody, 'utf8').digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  if (a.length !== b.length) return { checked: true, valid: false, reason: 'Signature mismatch.' };

  const valid = crypto.timingSafeEqual(a, b);
  return { checked: true, valid, reason: valid ? undefined : 'Signature mismatch.' };
}

/** GET verification handshake used when you register the webhook URL. */
export function verifyChallenge(params: URLSearchParams): { ok: boolean; challenge?: string; reason?: string } {
  const cfg = getWhatsAppConfig();
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge') ?? '';

  if (mode !== 'subscribe') return { ok: false, reason: 'hub.mode must be "subscribe".' };
  if (!token || token !== cfg.verifyToken) return { ok: false, reason: 'Verify token mismatch.' };
  return { ok: true, challenge };
}
