import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Defaults of the local agent. Everything big (llama.cpp, the model) lives in
 * one folder outside the repository, so updating JAVE never re-downloads 7 GB.
 */

export const MODEL_REPO = 'TrevorJS/gemma-4-12B-it-uncensored-GGUF';
export const DEFAULT_QUANT = 'Q4_K_M';
/** The name the local server answers to (`AI_MODEL` for JAVE itself). */
export const MODEL_ALIAS = 'gemma-4-12b';
export const DEFAULT_PORT = 8088;
export const DEFAULT_CTX = 16384;
export const AGENT_HOME = process.env.JAVE_AGENT_HOME || join(homedir(), '.jave-agent');

export const USAGE = `JAVE Agent: ein lokaler KI-Agent mit Gemma 4 12B (uncensored), läuft komplett auf deinem Computer.

  node agent/agent.mjs                 Agent starten (beim ersten Mal: Download ~8 GB)
  node agent/agent.mjs "Aufgabe"       Eine Aufgabe erledigen und beenden
  node agent/agent.mjs setup           Nur herunterladen (llama.cpp + Modell)
  node agent/agent.mjs update          llama.cpp auf die neueste Version bringen
  node agent/agent.mjs server          Nur den Modell-Server starten (z. B. für die JAVE-KI)

Optionen:
  --auto                 Nicht nachfragen: Schreiben und Befehle sofort erlauben
  --denken               Denkmodus an (gründlicher, aber langsamer)
  --ordner <pfad>        Arbeitsordner (Standard: der aktuelle Ordner)
  --quant <Q4_K_M|Q8_0>  Modellgröße: Q4_K_M 7,4 GB (Standard), Q8_0 12,7 GB (genauer)
  --modell <datei.gguf>  Eine schon vorhandene GGUF-Datei nehmen
  --kontext <n>          Kontextlänge in Tokens (Standard ${DEFAULT_CTX})
  --port <n>             Port des Modell-Servers (Standard ${DEFAULT_PORT})
  --gpu-layers <n>       Schichten auf der Grafikkarte (Standard: automatisch)
  --llama-server <pfad>  Ein eigenes llama-server nehmen statt es herunterzuladen
  --base-url <url>       Einen laufenden OpenAI-kompatiblen Server nehmen
                         (LM Studio, Ollama, …), z. B. http://127.0.0.1:1234/v1
  --server-behalten      Den Modell-Server beim Beenden weiterlaufen lassen

Im Agenten: /hilfe  /neu  /auto  /denken  /ordner <pfad>  /exit`;

const VALUE_FLAGS = {
  '--ordner': 'dir',
  '--dir': 'dir',
  '--quant': 'quant',
  '--modell': 'model',
  '--model': 'model',
  '--kontext': 'ctx',
  '--ctx': 'ctx',
  '--port': 'port',
  '--gpu-layers': 'gpuLayers',
  '--llama-server': 'llamaServer',
  '--base-url': 'baseUrl',
  '--api-key': 'apiKey',
};

const BOOLEAN_FLAGS = {
  '--auto': 'auto',
  '--yolo': 'auto',
  '--denken': 'think',
  '--think': 'think',
  '--server-behalten': 'keepServer',
  '--keep-server': 'keepServer',
  '--hilfe': 'help',
  '--help': 'help',
  '-h': 'help',
};

const COMMANDS = new Set(['setup', 'update', 'server']);

export class UsageError extends Error {}

/** Parses the command line into options; anything that is not a flag is the task. */
export function parseArgs(argv) {
  const options = {
    command: 'chat',
    auto: false,
    think: false,
    keepServer: false,
    help: false,
    dir: process.cwd(),
    quant: DEFAULT_QUANT,
    model: undefined,
    ctx: DEFAULT_CTX,
    port: DEFAULT_PORT,
    gpuLayers: undefined,
    llamaServer: undefined,
    baseUrl: undefined,
    apiKey: undefined,
    prompt: '',
  };
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? arg.split(/=(.*)/s) : [arg];
    if (flag in BOOLEAN_FLAGS) {
      options[BOOLEAN_FLAGS[flag]] = true;
    } else if (flag in VALUE_FLAGS) {
      const value = inline ?? argv[++i];
      if (value === undefined || value === '') throw new UsageError(`${flag} braucht einen Wert.`);
      options[VALUE_FLAGS[flag]] = value;
    } else if (arg.startsWith('-') && arg.length > 1 && words.length === 0) {
      throw new UsageError(`Unbekannte Option: ${arg}`);
    } else if (words.length === 0 && COMMANDS.has(arg)) {
      options.command = arg;
    } else {
      words.push(arg);
    }
  }
  for (const key of ['ctx', 'port']) {
    const n = Number(options[key]);
    if (!Number.isInteger(n) || n <= 0) throw new UsageError(`--${key} muss eine ganze Zahl sein.`);
    options[key] = n;
  }
  if (options.gpuLayers !== undefined && !/^(\d+|auto|all)$/.test(options.gpuLayers)) {
    throw new UsageError('--gpu-layers muss eine Zahl, "auto" oder "all" sein.');
  }
  options.prompt = words.join(' ').trim();
  return options;
}
