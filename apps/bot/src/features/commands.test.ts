import { describe, expect, it } from 'vitest';
import { ApplicationCommandType } from 'discord.js';
import { allFeatures } from '.';

const SLASH_NAME = /^[-_\p{L}\p{N}]{1,32}$/u;

describe('command catalog', () => {
  const commands = allFeatures().flatMap((f) => f.commands ?? []);

  it('has unique names per command type', () => {
    const keys = commands.map((c) => `${c.kind}:${c.data.name}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('satisfies Discord limits', () => {
    expect(commands.filter((c) => c.kind === 'slash').length).toBeLessThanOrEqual(100);
    for (const command of commands) {
      const data = command.data as {
        name: string;
        description?: string;
        type?: number;
        options?: unknown[];
      };
      if (command.kind === 'slash') {
        expect(data.name).toMatch(SLASH_NAME);
        expect(data.name).toBe(data.name.toLowerCase());
        expect(data.description!.length).toBeGreaterThan(0);
        expect(data.description!.length).toBeLessThanOrEqual(100);
        expect((data.options ?? []).length).toBeLessThanOrEqual(25);
      } else {
        expect(data.type).toBe(
          command.kind === 'user_context'
            ? ApplicationCommandType.User
            : ApplicationCommandType.Message,
        );
        expect(data.name.length).toBeLessThanOrEqual(32);
      }
    }
  });

  it('serializes to under the 8000 character payload limit per command', () => {
    for (const command of commands) expect(JSON.stringify(command.data).length).toBeLessThan(8000);
  });

  it('every command has help text', () => {
    for (const command of commands) expect(command.help, command.data.name).toBeDefined();
  });
});
