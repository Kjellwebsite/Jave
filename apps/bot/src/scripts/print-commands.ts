import { allFeatures } from '../features';
import { inviteUrl, REQUIRED_PERMISSIONS } from '../discord/permissions';

/** Print the command payload, required permissions and the bot invite URL. No network. */
const commands = allFeatures().flatMap((f) => f.commands ?? []);
console.log(
  JSON.stringify(
    commands.map((c) => c.data),
    null,
    2,
  ),
);
console.log(`\n${commands.length} commands`);
console.log('\nRequired permissions:');
for (const [name, why] of Object.entries(REQUIRED_PERMISSIONS))
  console.log(`  ${name.padEnd(22)} ${why}`);
const clientId = process.env.DISCORD_CLIENT_ID;
if (clientId) console.log(`\nInvite URL:\n  ${inviteUrl(clientId)}`);
