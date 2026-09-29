#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

/**
 * JAVE on your own computer, in one command: `node start.mjs`.
 *
 * The first run asks for the Discord values and writes `.env`. Every run then
 * installs what is missing, starts the database, applies migrations, registers
 * the slash commands and runs the bot and the dashboard together (Ctrl+C stops
 * both). Messages are German: this is the owner's launcher (START-HIER.md).
 * Servers follow DEPLOYMENT.md instead.
 */

const WINDOWS = process.platform === 'win32';
const ENV_FILE = '.env';
const EXAMPLE_FILE = '.env.example';
const MIN_NODE = [22, 12];
const SNOWFLAKE = /^\d{17,20}$/;
const BOT_TOKEN = /^[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,}$/;
const DASHBOARD_URL = 'http://localhost:3000';
const OAUTH_CALLBACK = `${DASHBOARD_URL}/api/auth/discord/callback`;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const DATABASE_WAIT_MS = 60_000;

const say = (text = '') => console.log(text);
const step = (text) => console.log(`\n▸ ${text}`);
function fail(text) {
  console.error(`\n✗ ${text}\n`);
  process.exit(1);
}

/**
 * Typed answers, one line each, in order. Lines are queued, so an answer that
 * arrives before its question (pasted, or piped) is never lost.
 */
const answers = { reader: null, queue: [], waiting: [], closed: false };

function readAnswer(promptText) {
  if (!answers.reader) {
    answers.reader = createInterface({ input: process.stdin });
    answers.reader.on('line', (line) => {
      const resolve = answers.waiting.shift();
      if (resolve) resolve(line);
      else answers.queue.push(line);
    });
    answers.reader.on('close', () => {
      answers.closed = true;
      for (const resolve of answers.waiting.splice(0)) resolve(null);
    });
  }
  process.stdout.write(promptText);
  if (answers.queue.length > 0) return Promise.resolve(answers.queue.shift());
  if (answers.closed) return Promise.resolve(null);
  return new Promise((resolve) => answers.waiting.push(resolve));
}

async function readLine(promptText) {
  const line = await readAnswer(promptText);
  if (line === null) fail('Eingabe beendet. Starte `node start.mjs` noch einmal.');
  return line;
}

function run(command, args, { quiet = false } = {}) {
  const result = spawnSync(command, args, {
    stdio: quiet ? 'pipe' : 'inherit',
    shell: WINDOWS,
    encoding: 'utf8',
  });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

// ── Prerequisites ────────────────────────────────────────────────────────────

function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1])) return;
  fail(
    `Node.js ${MIN_NODE.join('.')} oder neuer wird gebraucht (du hast ${process.versions.node}). ` +
      'Lade die LTS-Version von https://nodejs.org und starte dann neu.',
  );
}

/** pnpm, however it is available: installed, through corepack, or fetched by npx. */
function findPnpm() {
  const pinned = JSON.parse(readFileSync('package.json', 'utf8')).packageManager ?? 'pnpm@10';
  const candidates = [
    ['pnpm', []],
    ['corepack', ['pnpm']],
    ['npx', ['--yes', pinned]],
  ];
  for (const [command, prefix] of candidates) {
    if (run(command, [...prefix, '--version'], { quiet: true }).ok) {
      return {
        command,
        prefix,
        run: (args, options) => run(command, [...prefix, ...args], options),
      };
    }
  }
  return fail('pnpm lässt sich nicht starten. Installiere es mit: npm install -g pnpm');
}

// ── .env ─────────────────────────────────────────────────────────────────────

function readValue(text, key) {
  const match = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1].trim().replace(/^(["'])(.*)\1$/, '$2') : '';
}

function writeValue(text, key, value) {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  return pattern.test(text) ? text.replace(pattern, () => line) : `${text.trimEnd()}\n${line}\n`;
}

const QUESTIONS = [
  {
    key: 'DISCORD_CLIENT_ID',
    title: 'Application ID',
    where:
      'discord.com/developers/applications → deine App → General Information → „Application ID“',
    valid: (value) => SNOWFLAKE.test(value),
    format: '17 bis 20 Ziffern',
  },
  {
    key: 'DISCORD_TOKEN',
    title: 'Bot-Token (geheim, wie ein Passwort)',
    where: 'Developer Portal → deine App → Bot → „Reset Token“ → kopieren',
    valid: (value) => value.length >= 50 && BOT_TOKEN.test(value),
    format: 'eine lange Zeichenkette mit zwei Punkten',
  },
  {
    key: 'DISCORD_GUILD_ID',
    title: 'Server-ID',
    where:
      'Discord → Rechtsklick auf deinen Server → „Server-ID kopieren“ ' +
      '(dafür einmal einschalten: Einstellungen → Erweitert → Entwicklermodus)',
    valid: (value) => SNOWFLAKE.test(value),
    format: '17 bis 20 Ziffern',
  },
  {
    key: 'JAVE_FOUNDER_DISCORD_IDS',
    title: 'Deine eigene Nutzer-ID (du wirst Founder)',
    where: 'Discord → Rechtsklick auf deinen Namen → „Nutzer-ID kopieren“',
    valid: (value) => value.split(',').every((id) => SNOWFLAKE.test(id.trim())),
    format: '17 bis 20 Ziffern',
  },
];

async function ask(question) {
  say(`\n${question.title}`);
  say(`  Wo: ${question.where}`);
  for (;;) {
    const answer = (await readLine('  → ')).trim();
    if (question.optional && answer === '') return '';
    if (question.valid(answer)) return answer;
    say(`  Das sieht nicht richtig aus (${question.format}). Bitte noch einmal einfügen.`);
  }
}

/** Fill in `.env`: ask for what is missing, generate secrets, keep everything else. */
async function ensureEnv() {
  const exists = existsSync(ENV_FILE);
  let text = readFileSync(exists ? ENV_FILE : EXAMPLE_FILE, 'utf8');
  const missing = QUESTIONS.filter((question) => !question.valid(readValue(text, question.key)));
  const firstRun = missing.length > 0;

  if (firstRun) {
    say('\nEinmalige Einrichtung: vier Werte aus Discord. Kopieren und hier einfügen.');
    for (const question of missing) text = writeValue(text, question.key, await ask(question));
    if (!readValue(text, 'DISCORD_CLIENT_SECRET')) {
      const secret = await ask({
        title: 'Optional: Client Secret (damit du dich im Dashboard mit Discord anmeldest)',
        where:
          `Developer Portal → OAuth2 → „Client Secret“ → Reset → kopieren. Dort bei Redirects ` +
          `${OAUTH_CALLBACK} eintragen. Nur Enter drücken zum Überspringen.`,
        valid: (value) => value.length >= 16 && !/\s/.test(value),
        format: 'mindestens 16 Zeichen, ohne Leerzeichen',
        optional: true,
      });
      if (secret) text = writeValue(text, 'DISCORD_CLIENT_SECRET', secret);
    }
  }

  // Secrets nobody needs to type.
  if (readValue(text, 'JAVE_SESSION_SECRET').length < 32)
    text = writeValue(text, 'JAVE_SESSION_SECRET', randomBytes(48).toString('base64url'));
  if (!readValue(text, 'JAVE_ENCRYPTION_KEY'))
    text = writeValue(text, 'JAVE_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  // Without Discord sign-in, the dashboard offers local test logins (MOCK / DEVELOPMENT ONLY).
  const discordLogin = Boolean(readValue(text, 'DISCORD_CLIENT_SECRET'));
  text = writeValue(text, 'JAVE_DEV_AUTH', discordLogin ? 'false' : 'true');

  writeFileSync(ENV_FILE, text);
  if (firstRun) say(`\n✓ Gespeichert in ${ENV_FILE} (bleibt auf deinem Computer, nie hochladen).`);
  return { text, firstRun };
}

// ── Database ─────────────────────────────────────────────────────────────────

function reachable(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

async function ensureDatabase(envText) {
  let url;
  try {
    url = new URL(readValue(envText, 'DATABASE_URL'));
  } catch {
    return fail('DATABASE_URL in .env ist ungültig.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const port = Number(url.port || 5432);
  if (await reachable(host, port)) return;
  if (!LOCAL_HOSTS.has(host)) fail(`Die Datenbank ${host}:${port} ist nicht erreichbar.`);

  step('Starte die Datenbank (Docker) …');
  if (!run('docker', ['info'], { quiet: true }).ok)
    fail(
      'Docker läuft nicht. Starte „Docker Desktop“, warte, bis es bereit ist, ' +
        'und führe dann noch einmal `node start.mjs` aus.',
    );
  if (!run('docker', ['compose', 'up', '-d', '--wait']).ok)
    fail('Die Datenbank ließ sich nicht starten (siehe Meldung oben).');
  const deadline = Date.now() + DATABASE_WAIT_MS;
  while (!(await reachable(host, port))) {
    if (Date.now() > deadline) fail('Die Datenbank antwortet nicht.');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// ── Discord ──────────────────────────────────────────────────────────────────

function inviteLink(pnpm) {
  const result = pnpm.run(['--filter', '@jave/bot', 'invite:url'], { quiet: true });
  return result.output.split('\n').find((line) => line.startsWith('https://discord.com/')) ?? null;
}

function explainDeployFailure(output, invite) {
  const headline = output.split('\n').find((line) => line.includes('DiscordAPIError')) ?? '';
  const status = Number(/status: (\d+)/.exec(output)?.[1] ?? 0);
  const notInServer =
    `Der Bot ist noch nicht in deinem Server. Öffne diesen Link, wähle deinen Server und bestätige:\n  ${invite}\n` +
    'Danach `node start.mjs` noch einmal.';
  if (/\[50001\]|Missing Access/.test(headline)) return notInServer;
  if (/\[10004\]|Unknown Guild/.test(headline))
    return 'Die Server-ID stimmt nicht. Prüfe DISCORD_GUILD_ID in .env.';
  if (status === 401 || /401|Unauthorized/.test(headline))
    return 'Discord lehnt den Bot-Token ab. Hol im Developer Portal (Bot → Reset Token) einen neuen und trag ihn in .env bei DISCORD_TOKEN ein.';
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed/.test(output))
    return 'Discord ist nicht erreichbar. Prüfe deine Internetverbindung.';
  if (status === 403)
    return (
      'Discord hat den Zugriff abgelehnt. Ist der Bot schon in deinem Server? Falls nicht:\n' +
      `  ${invite}\nFalls doch, blockiert vielleicht eine Firewall oder ein Proxy discord.com.`
    );
  return `Die Befehle ließen sich nicht bei Discord anmelden:\n${headline || output.trim().split('\n').slice(-8).join('\n')}`;
}

// ── Run ──────────────────────────────────────────────────────────────────────

function startAll(pnpm) {
  const processes = [
    ['bot', ['dev:bot']],
    ['dashboard', ['dev:dashboard']],
  ];
  let running = processes.length;
  const children = processes.map(([name, args]) => {
    const child = spawn(pnpm.command, [...pnpm.prefix, ...args], {
      shell: WINDOWS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on('line', (line) => say(`[${name}] ${line}`));
    }
    child.on('exit', (code) => {
      say(`[${name}] beendet${code ? ` (Fehlercode ${code})` : ''}`);
      running -= 1;
      if (running === 0) process.exit(code ?? 0);
    });
    return child;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      for (const child of children) child.kill(signal);
    });
  }
}

async function main() {
  // Every path below is relative to the repository, wherever the terminal is.
  process.chdir(dirname(fileURLToPath(import.meta.url)));
  say('JAVE · lokaler Start');
  checkNode();
  const pnpm = findPnpm();
  const { text, firstRun } = await ensureEnv();

  step('Installiere, was fehlt …');
  if (!pnpm.run(['install', '--prefer-offline']).ok) fail('Die Installation ist fehlgeschlagen.');

  await ensureDatabase(text);
  step('Richte die Datenbank ein …');
  if (!pnpm.run(['db:migrate']).ok) fail('Die Datenbank ließ sich nicht einrichten.');

  const invite = inviteLink(pnpm);
  if (firstRun && invite) {
    say('\nJetzt den Bot in deinen Server holen:');
    say(`  1. Öffne diesen Link, wähle deinen Server, bestätige:\n     ${invite}`);
    say(
      '  2. Developer Portal → Bot: „Server Members Intent“ und „Message Content Intent“ einschalten.',
    );
    say('  3. Server-Einstellungen → Rollen: die Rolle des Bots ganz nach oben ziehen.');
    await readLine('\nFertig? Dann Enter drücken … ');
  }
  answers.reader?.close();

  step('Melde die Befehle bei Discord an …');
  const deploy = pnpm.run(['commands:deploy'], { quiet: true });
  if (!deploy.ok) fail(explainDeployFailure(deploy.output, invite));
  say(deploy.output.trim().split('\n').pop());

  step('Starte Bot und Dashboard (beenden mit Strg + C) …');
  say(`  Dashboard: ${DASHBOARD_URL}`);
  say('  In Discord: /jave setup  (zeigt, ob alles eingestellt ist)');
  startAll(pnpm);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
