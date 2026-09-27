import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allFeatures } from '../features';
import { COMMANDS_DOC_PATH, docExistsInRepo, formatCommandsDoc } from './commands-doc';

describe('COMMANDS.md', () => {
  it('matches the command definitions (run `pnpm --filter @jave/bot commands:doc`)', async () => {
    const expected = await formatCommandsDoc(allFeatures(), docExistsInRepo);
    expect(readFileSync(COMMANDS_DOC_PATH, 'utf8')).toBe(expected);
  });

  it('lists every deployed command exactly once', async () => {
    const doc = await formatCommandsDoc(allFeatures(), docExistsInRepo);
    const commands = allFeatures().flatMap((feature) => feature.commands ?? []);
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const command of commands) {
      const name = command.kind === 'slash' ? `\`/${command.data.name}\`` : command.data.name;
      const row = new RegExp(`^\\| ${escape(name)} +\\|`, 'gm');
      expect(doc.match(row)?.length ?? 0, command.data.name).toBe(1);
    }
  });
});
