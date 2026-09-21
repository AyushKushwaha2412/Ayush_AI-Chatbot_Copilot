import { WhatsAppConfig, WhatsAppMode } from './types';

/**
 * WhatsApp credentials are read from server-side environment variables only.
 * They are NEVER returned to the browser: `publicStatus()` deliberately
 * exposes booleans instead of secrets.
 */
export function getWhatsAppConfig(): WhatsAppConfig {
  const mode = (process.env.WHATSAPP_MODE === 'live' ? 'live' : 'simulated') as WhatsAppMode;
  const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const accessToken = (process.env.WHATSAPP_ACCESS_TOKEN || '').trim();

  return {
    mode,
    phoneNumberId,
    accessToken,
    verifyToken: (process.env.WHATSAPP_VERIFY_TOKEN || 'copilot-verify-token').trim(),
    appSecret: (process.env.WHATSAPP_APP_SECRET || '').trim(),
    apiVersion: (process.env.WHATSAPP_API_VERSION || 'v21.0').trim(),
    liveReady: Boolean(phoneNumberId && accessToken),
  };
}

export interface PublicWhatsAppStatus {
  mode: WhatsAppMode;
  liveReady: boolean;
  credentialsPresent: { phoneNumberId: boolean; accessToken: boolean; appSecret: boolean; verifyToken: boolean };
  webhookUrlHint: string;
  graphBase: string;
  notes: string[];
}

export function publicStatus(): PublicWhatsAppStatus {
  const cfg = getWhatsAppConfig();
  const notes: string[] = [];

  if (cfg.mode === 'simulated') {
    notes.push('Simulation mode: outbound messages are queued and recorded locally. Nothing leaves this machine.');
  } else if (!cfg.liveReady) {
    notes.push('Live mode selected but credentials are incomplete — sends will fail until WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN are set.');
  } else {
    notes.push('Live mode: outbound messages are sent through the WhatsApp Cloud API.');
  }
  if (!cfg.appSecret) {
    notes.push('No WHATSAPP_APP_SECRET set — inbound webhook signatures are recorded but not enforced.');
  }

  return {
    mode: cfg.mode,
    liveReady: cfg.liveReady,
    credentialsPresent: {
      phoneNumberId: Boolean(cfg.phoneNumberId),
      accessToken: Boolean(cfg.accessToken),
      appSecret: Boolean(cfg.appSecret),
      verifyToken: Boolean(cfg.verifyToken),
    },
    webhookUrlHint: '/api/whatsapp/webhook',
    graphBase: `https://graph.facebook.com/${cfg.apiVersion}`,
    notes,
  };
}
