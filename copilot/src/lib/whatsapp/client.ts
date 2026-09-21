import { getWhatsAppConfig } from './config';
import { SendResult, WhatsAppMode } from './types';
import { normalizePhone } from './normalize';

/**
 * Outbound transport for the official WhatsApp Business Cloud API.
 *
 *   POST https://graph.facebook.com/{version}/{phone-number-id}/messages
 *
 * In `simulated` mode no HTTP call is made and a synthetic wamid is returned
 * so the rest of the pipeline (queue → message record → UI) behaves
 * identically. Flip WHATSAPP_MODE=live to send for real.
 */
export async function sendTextMessage(opts: {
  to: string;
  body: string;
  previewUrl?: boolean;
  mode?: WhatsAppMode;
}): Promise<SendResult> {
  const cfg = getWhatsAppConfig();
  const mode = opts.mode ?? cfg.mode;
  const to = normalizePhone(opts.to);

  if (!to) {
    return { ok: false, mode, status: 'failed', error: 'Recipient phone number is missing.' };
  }

  if (mode === 'simulated') {
    return {
      ok: true,
      mode,
      status: 'sent',
      simulated: true,
      waMessageId: `sim.wamid.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
    };
  }

  if (!cfg.liveReady) {
    return {
      ok: false,
      mode,
      status: 'failed',
      error:
        'Live mode is on but WhatsApp credentials are missing. Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN, or switch WHATSAPP_MODE to simulated.',
    };
  }

  const url = `https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: {
      preview_url: opts.previewUrl ?? false,
      body: opts.body,
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });

    const data = (await res.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
      error?: { message?: string; code?: number; error_data?: { details?: string } };
    };

    if (!res.ok) {
      const detail = data.error?.error_data?.details || data.error?.message || `HTTP ${res.status}`;
      return {
        ok: false,
        mode,
        status: 'failed',
        // tokens are never echoed back in errors
        error: `Cloud API error: ${String(detail).slice(0, 300)}`,
      };
    }

    return {
      ok: true,
      mode,
      status: 'sent',
      waMessageId: data.messages?.[0]?.id,
    };
  } catch (err) {
    const e = err as Error;
    return {
      ok: false,
      mode,
      status: 'failed',
      error:
        e.name === 'TimeoutError'
          ? 'Cloud API request timed out.'
          : `Cloud API unreachable: ${e.message}`,
    };
  }
}

/** Mark an inbound message as read (Cloud API nicety). */
export async function markRead(waMessageId: string): Promise<boolean> {
  const cfg = getWhatsAppConfig();
  if (cfg.mode !== 'live' || !cfg.liveReady) return false;
  try {
    const res = await fetch(`https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: waMessageId }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Quick credential check used by the settings page ("Test WhatsApp"). */
export async function verifyCloudApiCredentials(): Promise<{ ok: boolean; message: string }> {
  const cfg = getWhatsAppConfig();
  if (!cfg.liveReady) {
    return {
      ok: false,
      message: 'No credentials configured. Running in simulation mode — that is the safe default.',
    };
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
      {
        headers: { Authorization: `Bearer ${cfg.accessToken}` },
        signal: AbortSignal.timeout(10000),
      },
    );
    const data = (await res.json()) as {
      display_phone_number?: string;
      verified_name?: string;
      error?: { message?: string };
    };
    if (!res.ok) {
      return { ok: false, message: `Cloud API rejected the credentials: ${data.error?.message ?? res.status}` };
    }
    return {
      ok: true,
      message: `Connected as ${data.verified_name ?? 'WhatsApp Business'} (${data.display_phone_number ?? cfg.phoneNumberId}).`,
    };
  } catch (err) {
    return { ok: false, message: `Could not reach Cloud API: ${(err as Error).message}` };
  }
}
