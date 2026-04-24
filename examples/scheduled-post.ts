import { UserBotClient } from '../src/index.js';

/**
 * Schedule a post for 1 hour from now with two photos.
 * Bot API cannot do this — only user-bots via MTProto.
 */
async function main() {
  const client = new UserBotClient({
    credentials: {
      apiId: Number(process.env.API_ID),
      apiHash: process.env.API_HASH!,
    },
    sessionPath: process.env.SESSION_PATH ?? './session',
  });

  const target = process.env.TARGET ?? '@your_channel_username';
  const scheduleAt = Math.floor(Date.now() / 1000) + 3600; // +1h

  const result = await client.sendScheduledPost(
    target,
    '<b>Hello from tg-user-bot-client</b>\n\nScheduled via MTProto.',
    ['https://picsum.photos/1200/800', 'https://picsum.photos/1200/801'],
    scheduleAt,
  );

  console.log(result);
  await client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
