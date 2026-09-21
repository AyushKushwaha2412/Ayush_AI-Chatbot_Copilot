/**
 * WhatsApp integration — shared types.
 *
 * The app speaks ONE internal shape ("normalized message") and every
 * WhatsApp surface (Cloud API webhook, simulation, future providers such as
 * the on-prem Business API or a Baileys bridge) is translated into it.
 * Swapping providers therefore touches only this folder.
 */

export type WhatsAppMode = 'simulated' | 'live';

export interface WhatsAppConfig {
  mode: WhatsAppMode;
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  appSecret: string;
  apiVersion: string;
  /** true when credentials are complete enough to attempt live sends */
  liveReady: boolean;
}

/** The single internal representation every inbound path produces. */
export interface NormalizedInboundMessage {
  waMessageId: string;
  /** E.164 / digits-only sender id (the "wa_id") */
  from: string;
  /** WhatsApp profile name when the payload includes it */
  profileName?: string;
  to?: string;
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location' | 'unsupported';
  text: string;
  mediaId?: string;
  mediaUrl?: string;
  timestamp: Date;
  /** true when contact pressed a quick-reply button */
  interactiveReplyId?: string;
  raw: unknown;
}

export interface NormalizedStatusUpdate {
  waMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  recipient: string;
  timestamp: Date;
  error?: string;
}

export interface NormalizedWebhook {
  source: 'whatsapp';
  phoneNumberId?: string;
  messages: NormalizedInboundMessage[];
  statuses: NormalizedStatusUpdate[];
  eventType: string;
}

export interface SendResult {
  ok: boolean;
  waMessageId?: string;
  mode: WhatsAppMode;
  status: 'sent' | 'queued' | 'failed';
  error?: string;
  simulated?: boolean;
}

export interface QueueStats {
  queued: number;
  sending: number;
  sent: number;
  failed: number;
  cancelled: number;
  oldestQueuedAt: string | null;
}
