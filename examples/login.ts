import { TelegramClient } from '@mtcute/node';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

/**
 * Interactive login — run ONCE per account to authorise the session.
 *
 *   API_ID=... API_HASH=... SESSION_PATH=./my-session tsx examples/login.ts
 *
 * After that you can use `UserBotClient` with the same `sessionPath` and
 * `.connect()` will skip the auth flow.
 */
async function main() {
  const apiId = Number(process.env.API_ID);
  const apiHash = process.env.API_HASH;
  const sessionPath = process.env.SESSION_PATH ?? './session';

  if (!apiId || !apiHash) {
    console.error('Set API_ID and API_HASH (https://my.telegram.org/apps)');
    process.exit(1);
  }

  const client = new TelegramClient({ apiId, apiHash, storage: sessionPath });
  const rl = createInterface({ input: stdin, output: stdout });

  const self = await client.start({
    phone: async () => rl.question('Phone (e.g. +49…): '),
    code: async () => rl.question('Code from Telegram: '),
    password: async () => rl.question('2FA password: '),
  });

  console.log(`Logged in as @${self.username ?? self.id}. Session saved to ${sessionPath}.`);
  rl.close();
  await client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
