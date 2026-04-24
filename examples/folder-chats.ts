import { UserBotClient } from '../src/index.js';

/**
 * Resolve every channel inside a Telegram folder (chat filter) by its name.
 * Handy for building per-folder broadcast lists.
 */
async function main() {
  const client = new UserBotClient({
    credentials: {
      apiId: Number(process.env.API_ID),
      apiHash: process.env.API_HASH!,
    },
    sessionPath: process.env.SESSION_PATH ?? './session',
  });

  const folderName = process.argv[2] ?? 'Work';
  const chats = await client.getChatsByFolderName(folderName);

  console.log(`Folder "${folderName}": ${chats.length} channels`);
  for (const chat of chats) {
    console.log(`  ${chat.id}  ${chat.title}${chat.username ? ` (@${chat.username})` : ''}`);
  }

  await client.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
