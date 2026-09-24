import { REST, Routes } from 'discord.js';
import { z } from 'zod';
import { parseEnv } from '@jave/config';
import { allFeatures } from '../features';

/**
 * Registers JAVE's commands as guild commands (instant propagation) for
 * DISCORD_GUILD_ID. Idempotent: PUT replaces the full set.
 */
const env = parseEnv(
  z.object({
    DISCORD_TOKEN: z.string().min(50),
    DISCORD_CLIENT_ID: z.string().regex(/^\d{17,20}$/),
    DISCORD_GUILD_ID: z.string().regex(/^\d{17,20}$/),
  }),
);

const body = allFeatures()
  .flatMap((f) => f.commands ?? [])
  .map((c) => c.data);

const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
const result = (await rest.put(
  Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID),
  { body },
)) as unknown[];
console.log(`registered ${result.length} commands in guild ${env.DISCORD_GUILD_ID}`);
