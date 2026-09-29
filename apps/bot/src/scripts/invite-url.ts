import { inviteUrl } from '../discord/permissions';

/** Print only the bot's invite link (least-privilege permissions). No network. */
const clientId = process.env.DISCORD_CLIENT_ID;
if (!clientId) {
  console.error('DISCORD_CLIENT_ID is not set');
  process.exit(1);
}
console.log(inviteUrl(clientId));
