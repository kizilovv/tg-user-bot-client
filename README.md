# tg-user-bot-client

High-level Telegram **user-bot** client (not Bot API — uses MTProto via [mtcute](https://mtcute.dev)) with the ergonomics you actually want: retries, scheduled posts, folder extraction, thread replies, reactions.

Why user-bot instead of Bot API?

- **`schedule_date` is user-bot only.** Bot API cannot schedule posts.
- **Folder / chat-filter access** is user-bot only — Bot API doesn't see your folders.
- **Reactions**, **topic threads**, **joining public channels programmatically** — all cleaner via MTProto.

---

## Install

```bash
npm install tg-user-bot-client
```

## One-time login

```bash
API_ID=12345 API_HASH=abc... SESSION_PATH=./session \
  npx tsx node_modules/tg-user-bot-client/examples/login.ts
```

Get `API_ID` / `API_HASH` from <https://my.telegram.org/apps>. The session file is written once and reused.

## Connect + post

```ts
import { UserBotClient } from 'tg-user-bot-client';

const client = new UserBotClient({
  credentials: { apiId: 12345, apiHash: process.env.API_HASH! },
  sessionPath: './session',
});

// Simple send (now)
await client.sendScheduledPost('@your_channel', 'Hello from MTProto');

// Scheduled — Bot API can't do this
const at = Math.floor(Date.now() / 1000) + 3600; // +1h
await client.sendScheduledPost('@your_channel', '<b>Launching in 1 hour</b>', [], at);

// With photos
await client.sendScheduledPost(
  '@your_channel',
  '<b>Check this out</b>',
  ['https://…/photo1.jpg', 'https://…/photo2.jpg'],
);
```

## Resolve every channel in a folder

```ts
const chats = await client.getChatsByFolderName('Work');
//   [{ id: -1001234567890, title: 'Channel A', username: 'chan_a' }, …]

for (const chat of chats) {
  await client.sendScheduledPost(chat.id, '<b>Announcement</b>');
}
```

## Post to a topic / forum thread

```ts
await client.sendToThread(forumChatId, 'Update inside thread', threadMessageId);
```

## Reactions

```ts
await client.setReaction('@channel', messageId, '🔥');

const reactions = await client.getReactions('@channel', messageId);
// { '🔥': 12, '👍': 3 }
```

## Bulk join

```ts
const { joined, failed } = await client.joinChannels([
  '@channel_one',
  '@channel_two',
  '@channel_three',
], 500 /* ms pause between calls */);
```

## Retries

Every high-level helper retries with exponential backoff + jitter (default: 5 retries, 1s → 30s). Tune per client:

```ts
new UserBotClient({
  credentials: { apiId, apiHash },
  sessionPath: './session',
  retry: { maxRetries: 8, initialDelayMs: 500, maxDelayMs: 60_000 },
});
```

You can also use the backoff helper directly on any async fn:

```ts
import { withBackoff } from 'tg-user-bot-client';

const result = await withBackoff(() => myFragileApi(), { maxRetries: 3 });
```

## Escape hatch

When the high-level helpers don't cover your case, drop to raw mtcute:

```ts
const raw = await client.raw(); // TelegramClient from @mtcute/node
await raw.call({ _: 'messages.getHistory', peer, limit: 100 });
```

## What this is NOT

- Not a drop-in Bot API replacement — you need `API_ID`/`API_HASH` and a user account (or a separate burner number).
- Not for mass spam — Telegram will rate-limit and then ban accounts. Helpers pause between calls by default; don't remove that.
- Not a full MTProto surface — it's a helper layer over mtcute, not a re-implementation. Drop to `client.raw()` for anything exotic.

## License

MIT
