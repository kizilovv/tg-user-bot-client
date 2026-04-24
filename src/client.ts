import { TelegramClient } from '@mtcute/node';
import { html } from '@mtcute/html-parser';
import { consoleLogger, withBackoff, type Logger } from './retry.js';
import type {
  ChatSummary,
  ClientOptions,
  JoinResult,
  PostResult,
} from './types.js';

/**
 * High-level Telegram user-bot client (not Bot API — uses MTProto via mtcute).
 *
 * Wraps common posting / scheduling / folder / reaction flows behind an
 * exponential-backoff retry layer. Every helper retries transient API errors
 * (FLOOD_WAIT, connection drops, server errors) so you don't have to.
 */
export class UserBotClient {
  private client: TelegramClient | null = null;
  private readonly logger: Logger;
  private readonly retry: NonNullable<ClientOptions['retry']>;

  constructor(private readonly opts: ClientOptions) {
    this.logger = opts.logger ?? consoleLogger;
    this.retry = opts.retry ?? {};
  }

  private async backoff<T>(fn: () => Promise<T>): Promise<T> {
    return withBackoff(fn, { ...this.retry, logger: this.logger });
  }

  /**
   * Connect using the stored session. Throws if the session isn't authorised
   * yet — run an interactive login first (see `examples/login.ts`).
   */
  async connect(): Promise<TelegramClient> {
    if (this.client) return this.client;

    this.client = new TelegramClient({
      apiId: this.opts.credentials.apiId,
      apiHash: this.opts.credentials.apiHash,
      storage: this.opts.sessionPath,
    });

    await this.client.connect();
    const me = await this.backoff(() => this.client!.getMe());
    this.logger.warn(`connected as @${me.username ?? me.id}`);
    return this.client;
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;
    await this.client.disconnect();
    this.client = null;
  }

  /** Raw mtcute client. Use when the high-level helpers don't cover your need. */
  async raw(): Promise<TelegramClient> {
    return this.connect();
  }

  async getSelf() {
    const c = await this.connect();
    return this.backoff(() => c.getMe());
  }

  /**
   * Returns the first `limit` dialogs. Uses mtcute's async iterator under the
   * hood so very large numbers pull fewer chunks than you'd expect.
   */
  async getDialogs(limit = 20) {
    const c = await this.connect();
    return this.backoff(async () => {
      const out: Awaited<ReturnType<TelegramClient['iterDialogs']> extends AsyncIterable<infer T> ? never : never> extends never
        ? Array<unknown>
        : never = [] as never;
      const arr: unknown[] = [];
      for await (const dialog of c.iterDialogs({ limit })) {
        arr.push(dialog);
        if (arr.length >= limit) break;
      }
      return arr;
    });
  }

  async getHistory(peer: string, limit = 10) {
    const c = await this.connect();
    return this.backoff(async () => {
      const arr: unknown[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for await (const msg of (c as any).iterHistory(peer, { limit })) {
        arr.push(msg);
        if (arr.length >= limit) break;
      }
      return arr;
    });
  }

  async resolveUsername(username: string) {
    const c = await this.connect();
    return this.backoff(() => c.resolvePeer(username));
  }

  /**
   * Join a public channel by @username. Treats USER_ALREADY_PARTICIPANT /
   * CHANNEL_PRIVATE as success.
   */
  async joinChannel(username: string): Promise<boolean> {
    const c = await this.connect();
    try {
      const peer = await this.backoff(() => c.resolvePeer(username));
      await this.backoff(() =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        c.call({ _: 'channels.joinChannel', channel: peer as any }),
      );
      return true;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg?.includes('USER_ALREADY_PARTICIPANT') || msg?.includes('CHANNEL_PRIVATE')) {
        return true;
      }
      throw err;
    }
  }

  /**
   * Join many channels sequentially with a small pause between calls to
   * avoid flood waits. Failures are collected, never thrown.
   */
  async joinChannels(usernames: string[], pauseMs = 500): Promise<JoinResult> {
    const joined: string[] = [];
    const failed: string[] = [];

    for (const username of usernames) {
      try {
        await this.joinChannel(username);
        joined.push(username);
        await new Promise((r) => setTimeout(r, pauseMs));
      } catch {
        failed.push(username);
      }
    }
    return { joined, failed };
  }

  /**
   * Resolve all chats inside a folder (chat filter) by its display name.
   * Returns id/title/username for each channel — useful for building
   * per-folder broadcast lists.
   */
  async getChatsByFolderName(folderName: string): Promise<ChatSummary[]> {
    const c = await this.connect();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const folders: any = await this.backoff(() => (c as any).getFolders());
    const filters: Array<Record<string, unknown>> = folders?.filters ?? [];

    const target = filters.find((f) => {
      const title = f.title;
      return typeof title === 'string' ? title === folderName : (title as { text?: string } | undefined)?.text === folderName;
    }) as { includePeers?: Array<Record<string, unknown>> } | undefined;

    if (!target) {
      const available = filters
        .map((f) => (typeof f.title === 'string' ? f.title : (f.title as { text?: string } | undefined)?.text))
        .filter(Boolean);
      throw new Error(`Folder "${folderName}" not found. Available: ${available.join(', ')}`);
    }

    const inputPeers = (target.includePeers ?? []).filter((p) => p._ === 'inputPeerChannel');
    if (inputPeers.length === 0) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await this.backoff(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      c.call({ _: 'channels.getChannels', id: inputPeers as any }),
    );

    const chats: ChatSummary[] = [];
    for (const channel of (result.chats ?? []) as Array<Record<string, unknown>>) {
      if (channel._ !== 'channel') continue;
      chats.push({
        id: -(channel.id as number),
        title: (channel.title as string) ?? 'Unknown',
        username: (channel.username as string | undefined) ?? undefined,
      });
    }
    return chats;
  }

  /**
   * Post a message (text / single photo / media group) to a chat with an
   * optional `schedule_date`. Bot API does NOT support schedule_date — this
   * is the key reason to use a user-bot for editorial automation.
   *
   * @param scheduleDateSeconds - Unix timestamp in SECONDS. Omit to send now.
   */
  async sendScheduledPost(
    peer: string | number,
    text: string,
    photoUrls: string[] = [],
    scheduleDateSeconds?: number,
  ): Promise<PostResult> {
    const c = await this.connect();
    const schedule = scheduleDateSeconds ? { schedule: new Date(scheduleDateSeconds * 1000) } : {};

    const parsedText = html(text.replace(/\n/g, '<br>'));

    try {
      if (photoUrls.length > 1) {
        const buffers = await Promise.all(photoUrls.slice(0, 4).map(downloadPhoto));
        const media = buffers.map((file, i) => ({
          type: 'photo' as const,
          file,
          ...(i === 0 ? { caption: parsedText } : {}),
        }));
        const messages = await this.backoff(() => c.sendMediaGroup(peer, media, schedule));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { success: true, messageIds: (messages as Array<any>).map((m) => m.id) };
      }

      if (photoUrls.length === 1) {
        const file = await downloadPhoto(photoUrls[0]);
        const msg = await this.backoff(() => c.sendMedia(peer, { type: 'photo', file, caption: parsedText }, schedule));
        return { success: true, messageIds: [msg.id] };
      }

      const msg = await this.backoff(() => c.sendText(peer, parsedText, schedule));
      return { success: true, messageIds: [msg.id] };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Post to a specific thread in a forum / topic group using reply_to.
   */
  async sendToThread(
    peer: string | number,
    text: string,
    threadId: number,
    photoUrls: string[] = [],
  ): Promise<PostResult> {
    const c = await this.connect();
    const parsedText = html(text.replace(/\n/g, '<br>'));
    const opts = { replyTo: threadId };

    try {
      if (photoUrls.length > 1) {
        const buffers = await Promise.all(photoUrls.slice(0, 4).map(downloadPhoto));
        const media = buffers.map((file, i) => ({
          type: 'photo' as const,
          file,
          ...(i === 0 ? { caption: parsedText } : {}),
        }));
        const messages = await this.backoff(() => c.sendMediaGroup(peer, media, opts));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { success: true, messageIds: (messages as Array<any>).map((m) => m.id) };
      }

      if (photoUrls.length === 1) {
        const file = await downloadPhoto(photoUrls[0]);
        const msg = await this.backoff(() => c.sendMedia(peer, { type: 'photo', file, caption: parsedText }, opts));
        return { success: true, messageIds: [msg.id] };
      }

      const msg = await this.backoff(() => c.sendText(peer, parsedText, opts));
      return { success: true, messageIds: [msg.id] };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Set an emoji reaction on a message. Returns true on success.
   */
  async setReaction(peer: string | number, messageId: number, emoji: string): Promise<boolean> {
    const c = await this.connect();
    try {
      await this.backoff(() =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c as any).call({
          _: 'messages.sendReaction',
          peer,
          msg_id: messageId,
          reaction: [{ _: 'reactionEmoji', emoticon: emoji }],
        }),
      );
      return true;
    } catch (err) {
      this.logger.warn(`setReaction failed`, { peer, messageId, emoji, error: (err as Error).message });
      return false;
    }
  }

  /**
   * Get current reaction counts on a message as `{ emoji: count }`.
   */
  async getReactions(peer: string | number, messageId: number): Promise<Record<string, number>> {
    const c = await this.connect();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: any = await this.backoff(() =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c as any).call({
          _: 'messages.getMessagesReactions',
          peer,
          id: [messageId],
        }),
      );

      const out: Record<string, number> = {};
      // The shape can vary by mtcute version; mine normalizes either layout.
      const reactions = result?.results ?? result?.updates?.[0]?.reactions?.results ?? [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of reactions as Array<any>) {
        const emoji = r?.reaction?.emoticon ?? '?';
        out[emoji] = r?.count ?? 0;
      }
      return out;
    } catch {
      return {};
    }
  }

  async health(): Promise<{ connected: boolean; account?: string; error?: string }> {
    try {
      const self = await this.getSelf();
      return { connected: true, account: `@${self.username ?? 'unknown'}` };
    } catch (err) {
      return { connected: false, error: String(err) };
    }
  }
}

async function downloadPhoto(url: string): Promise<Buffer> {
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok) throw new Error(`Failed to download photo ${url}: ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}
