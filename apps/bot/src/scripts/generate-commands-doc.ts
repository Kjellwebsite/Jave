import { writeFileSync } from 'node:fs';
import { allFeatures } from '../features';
import { COMMANDS_DOC_PATH, docExistsInRepo, formatCommandsDoc } from './commands-doc';

/** Write COMMANDS.md from the command definitions. No network, no database. */
const doc = await formatCommandsDoc(allFeatures(), docExistsInRepo);
writeFileSync(COMMANDS_DOC_PATH, doc);
console.log(`wrote ${COMMANDS_DOC_PATH}`);
