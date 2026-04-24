import type { Logger } from './retry.js';

export interface MTProtoCredentials {
  /** API ID from https://my.telegram.org/apps */
  apiId: number;
  /** API hash from https://my.telegram.org/apps */
  apiHash: string;
}

export interface ClientOptions {
  credentials: MTProtoCredentials;
  /**
   * Path to session file. mtcute stores authorised session data here so you
   * only need to go through the login flow once.
   */
  sessionPath: string;
  /** Optional logger. Defaults to console. */
  logger?: Logger;
  /** Retry behaviour for every API call wrapped by the high-level helpers. */
  retry?: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
  };
}

export interface PostResult {
  success: boolean;
  messageIds?: number[];
  error?: string;
}

export interface ChatSummary {
  /** Negative ID for channels (matches Telegram's channel id convention). */
  id: number;
  title: string;
  username?: string;
}

export interface JoinResult {
  joined: string[];
  failed: string[];
}
