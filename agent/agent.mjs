#!/usr/bin/env node
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Agent } from './lib/agent.mjs';
import { AGENT_HOME, MODEL_ALIAS, parseArgs, USAGE, UsageError } from './lib/config.mjs';
import { probeServer, startServer } from './lib/server.mjs';
import { ensureLlamaServer, ensureModel } from './lib/setup.mjs';
import { bold, cyan, dim, green, ok, red, say, spinner, step, warn, yellow } from './lib/ui.mjs';

/**
 * JAVE Agent: a fast local AI agent on Gemma 4 12B (uncensored GGUF) with
 * access to this computer: files, shell and the web. Everything runs here;
 * nothing leaves the machine except the agent's own web requests.
 *
 *   node agent/agent.mjs            chat (first run downloads llama.cpp + model)
 *   node agent/agent.mjs "task"     one task, then exit
 *   node agent/agent.mjs --help     all options
 */

const MIN_NODE = [22, 12];

function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
    throw new UsageError(
      `Node.js ${MIN_NODE.join('.')} oder neuer wird gebraucht (installiert: ${process.versions.node}).`,
    );
  }
}

/**
 * Keyboard input, one request at a time. Lines that arrive together (a pasted
 * block) become one request; lines typed while the agent works wait their turn.
 */
function createInput() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY,
  });
  const queue = [];
  const waiting = [];
  let lines = [];
  let timer = null;
  let closed = false;
  const deliver = (text) => {
    const next = waiting.shift();
    if (next) next(text);
    else queue.push(text);
  };
  rl.on('line', (line) => {
    lines.push(line);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const text = lines.join('\n');
      lines = [];
      deliver(text);
    }, 30);
  });
  rl.on('close', () => {
    closed = true;
    clearTimeout(timer);
    if (lines.length) deliver(lines.join('\n'));
    lines = [];
    while (waiting.length) waiting.shift()(null);
  });
  return {
    rl,
    /**
     * The next request, or null when the input has ended (Ctrl+D, end of a pipe).
     * `fresh` skips lines typed ahead, so they stay requests and never answer a question.
     */
    read(prompt, { fresh = false } = {}) {
      if (queue.length && !fresh) return Promise.resolve(queue.shift());
      if (closed) return Promise.resolve(null);
      rl.setPrompt(prompt);
      rl.prompt();
      return new Promise((resolve) => waiting.push(resolve));
    },
    /** Answers every open question with null (after Ctrl+C, so no stale question takes the next line). */
    cancel() {
      while (waiting.length) waiting.shift()(null);
    },
    close: () => rl.close(),
  };
}

function makeApprover(state, input, interactive) {
  return async ({ kind, title, preview }) => {
    if (state.auto || state.always.has(kind)) {
      say(dim(`  ${title}${preview.length === 1 ? ` ${preview[0]}` : ''}`));
      return true;
    }
    if (!interactive) {
      say(yellow(`  Abgelehnt (keine Rückfrage möglich, --auto erlaubt es): ${title}`));
      return false;
    }
    say(`\n  ${yellow('?')} ${bold(title)}`);
    for (const line of preview) {
      const colored = line.startsWith('+ ')
        ? green(line)
        : line.startsWith('- ')
          ? red(line)
          : cyan(line);
      say(`    ${colored}`);
    }
    for (;;) {
      const answer = await input.read(
        `  ${dim('[j] ja  [n] nein  [i] immer (für diese Sitzung)')} › `,
        { fresh: true },
      );
      const choice = (answer ?? 'n').trim().toLowerCase();
      if (['j', 'ja', 'y', 'yes'].includes(choice)) return true;
      if (['n', 'nein', 'no'].includes(choice)) return false;
      if (['i', 'immer', 'a', 'always'].includes(choice)) {
        state.always.add(kind);
        return true;
      }
    }
  };
}

const HELP = `${bold('Befehle')}
  /neu              neue Unterhaltung (vergisst den Verlauf)
  /auto             Rückfragen vor Schreiben/Befehlen an/aus
  /denken           Denkmodus an/aus (gründlicher, langsamer)
  /ordner <pfad>    Arbeitsordner wechseln
  /exit             beenden (auch Strg+D)
  Strg+C            laufende Antwort abbrechen`;

/** Handles a /command; returns false when the agent should exit. */
function handleCommand(text, agent, state) {
  const [command, ...rest] = text.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim();
  switch (command.toLowerCase()) {
    case 'exit':
    case 'quit':
    case 'ende':
      return false;
    case 'hilfe':
    case 'help':
    case '?':
      say(HELP);
      break;
    case 'neu':
    case 'reset':
    case 'clear':
      agent.reset();
      ok('Neue Unterhaltung.');
      break;
    case 'auto':
      state.auto = !state.auto;
      state.always.clear();
      ok(
        state.auto
          ? 'Auto an: Schreiben und Befehle ohne Rückfrage.'
          : 'Auto aus: vor Änderungen wird gefragt.',
      );
      break;
    case 'denken':
    case 'think':
      agent.think = !agent.think;
      ok(agent.think ? 'Denkmodus an.' : 'Denkmodus aus (schneller).');
      break;
    case 'ordner':
    case 'cd': {
      const dir = resolve(agent.cwd, arg || '.');
      if (!existsSync(dir) || !statSync(dir).isDirectory()) {
        warn(`Kein Ordner: ${dir}`);
      } else {
        agent.setCwd(dir);
        ok(`Arbeitsordner: ${dir}`);
      }
      break;
    }
    default:
      warn(`Unbekannter Befehl /${command}. /hilfe zeigt alle.`);
  }
  return true;
}

async function prepareServer(options) {
  if (options.baseUrl) {
    const name = await probeServer(options.baseUrl, options.apiKey);
    if (!name)
      throw new UsageError(`Unter ${options.baseUrl} antwortet kein OpenAI-kompatibler Server.`);
    return { baseUrl: options.baseUrl, modelName: name, stop: () => {} };
  }
  mkdirSync(AGENT_HOME, { recursive: true });
  const baseUrl = `http://127.0.0.1:${options.port}/v1`;
  const running = await probeServer(baseUrl);
  if (running && options.command === 'chat') {
    return { baseUrl, modelName: running, stop: () => {}, reused: true };
  }
  const serverPath = await ensureLlamaServer({
    home: AGENT_HOME,
    explicit: options.llamaServer,
    update: options.command === 'update',
  });
  const modelPath = await ensureModel({
    home: AGENT_HOME,
    quant: options.quant,
    explicit: options.model,
  });
  if (options.command === 'setup' || options.command === 'update') {
    ok(`Fertig. Starten mit: node agent/agent.mjs`);
    return null;
  }
  if (running)
    throw new UsageError(
      `Auf Port ${options.port} läuft schon ein Server. Einen anderen wählen: --port 8099`,
    );

  const settings = {
    serverPath,
    modelPath,
    port: options.port,
    ctx: options.ctx,
    gpuLayers: options.gpuLayers,
  };
  if (options.command === 'server') {
    step(`Modell-Server auf ${baseUrl} (Strg+C beendet ihn)`);
    say(dim('  Für die JAVE-KI in .env eintragen:'));
    say(
      dim(
        `    AI_PROVIDER=openai-compatible\n    AI_BASE_URL=${baseUrl}\n    AI_MODEL=${MODEL_ALIAS}\n`,
      ),
    );
    const server = await startServer({ ...settings, foreground: true });
    await new Promise((done) => server.child.on('exit', done));
    return null;
  }
  const logFile = join(AGENT_HOME, 'server.log');
  const wait = spinner('Modell wird geladen (beim ersten Mal bis zu 1–2 Minuten)');
  try {
    const server = await startServer({ ...settings, logFile, keep: options.keepServer });
    wait.stop('Modell bereit.');
    return { baseUrl, modelName: MODEL_ALIAS, stop: server.stop };
  } catch (error) {
    wait.stop();
    throw error;
  }
}

async function main() {
  checkNode();
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    say(USAGE);
    return;
  }
  const cwd = resolve(options.dir);
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new UsageError(`Kein Ordner: ${cwd}`);
  // Dying from a signal skips 'exit' handlers; exiting instead stops the model server with us.
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ]) {
    process.on(signal, () => process.exit(code));
  }

  const server = await prepareServer(options);
  if (!server) return;
  if (server.reused) ok(`Nehme den laufenden Modell-Server (${server.modelName}).`);

  const interactive = process.stdin.isTTY;
  const input = createInput();
  const state = { auto: options.auto, always: new Set() };
  const agent = new Agent({
    baseUrl: server.baseUrl,
    apiKey: options.apiKey,
    modelName: server.modelName,
    ctx: options.ctx,
    cwd,
    think: options.think,
    approve: makeApprover(state, input, interactive),
  });

  let current = null;
  let lastInterrupt = 0;
  input.rl.on('SIGINT', () => {
    if (current) {
      current.abort();
      input.cancel();
      return;
    }
    if (Date.now() - lastInterrupt < 1500) {
      input.close();
      return;
    }
    lastInterrupt = Date.now();
    say(dim('\n  (noch einmal Strg+C oder /exit zum Beenden)'));
    input.rl.prompt();
  });

  const runRequest = async (text) => {
    current = new AbortController();
    try {
      await agent.run(text, current.signal);
    } catch (error) {
      if (current.signal.aborted) say(yellow('\n  Abgebrochen.'));
      else say(red(`\n  Fehler: ${error.message}`));
    } finally {
      current = null;
    }
  };

  try {
    if (options.prompt) {
      await runRequest(options.prompt);
      return;
    }
    say(`\n${bold('JAVE Agent')} ${dim(`· ${server.modelName} · lokal`)}`);
    say(dim(`  Ordner: ${cwd}`));
    say(
      dim(
        `  ${state.auto ? 'Auto: Änderungen ohne Rückfrage' : 'Vor Änderungen und Befehlen wird gefragt'} · /hilfe für Befehle\n`,
      ),
    );
    for (;;) {
      const text = await input.read(`${cyan('›')} `);
      if (text === null) break;
      const request = text.trim();
      if (!request) continue;
      if (request.startsWith('/')) {
        if (!handleCommand(request, agent, state)) break;
        continue;
      }
      await runRequest(request);
      say();
    }
  } finally {
    input.close();
    server.stop();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    say(red(`✗ ${error.message}`));
    if (!(error instanceof UsageError) && process.env.DEBUG) console.error(error);
    process.exit(1);
  },
);
