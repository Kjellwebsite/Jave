import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MODEL_ALIAS } from './config.mjs';

/**
 * Runs llama-server: the model stays loaded in memory and speaks the OpenAI
 * chat API on 127.0.0.1, with Gemma 4's native tool calls parsed into
 * structured `tool_calls` by the model's own chat template.
 */

export class ServerError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function serverArgs({ modelPath, port, ctx, gpuLayers }) {
  const args = ['-m', modelPath, '--host', '127.0.0.1', '--port', String(port), '-c', String(ctx)];
  // One slot keeps the whole context for the agent and lets the prompt cache carry over between turns.
  args.push('-np', '1', '--alias', MODEL_ALIAS, '--jinja');
  if (gpuLayers !== undefined) args.push('-ngl', String(gpuLayers));
  return args;
}

/** The name of the model a running server answers to, or null when nothing (healthy) listens there. */
export async function probeServer(baseUrl, apiKey) {
  try {
    const origin = new URL(baseUrl).origin;
    const health = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(2000) });
    // OpenAI-compatible servers other than llama.cpp may have no /health: /models decides.
    if (health.status === 503) return null;
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const models = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!models.ok) return null;
    const body = await models.json();
    return body?.data?.[0]?.id ?? MODEL_ALIAS;
  } catch {
    return null;
  }
}

function logTail(logFile, lines = 25) {
  if (!logFile || !existsSync(logFile)) return '';
  return readFileSync(logFile, 'utf8').split(/\r?\n/).slice(-lines).join('\n');
}

/** Turns a failed start into advice the owner can act on. */
export function explainFailure(log) {
  const text = log.toLowerCase();
  if (/unknown (model )?architecture|gemma4unified|not supported/.test(text)) {
    return 'Das llama.cpp ist zu alt für dieses Modell. Abhilfe: node agent/agent.mjs update';
  }
  if (/address already in use|couldn't bind|failed to bind|bind failed/.test(text)) {
    return 'Der Port ist belegt. Einen anderen nehmen, z. B. --port 8099';
  }
  if (
    /out of memory|failed to allocate|cudamalloc failed|unable to allocate|vk::outofdevicememory/.test(
      text,
    )
  ) {
    return 'Zu wenig Speicher. Abhilfe: kleineren Kontext (--kontext 8192) oder weniger GPU-Schichten (--gpu-layers 20).';
  }
  if (/failed to load model|error loading model|invalid magic|gguf/.test(text)) {
    return 'Die Modelldatei ist beschädigt oder unvollständig. Den Ordner "models" in ~/.jave-agent löschen und neu starten.';
  }
  return 'Details stehen im Server-Log.';
}

/**
 * Starts llama-server. In the foreground its output goes to this terminal;
 * otherwise to `logFile`, and the returned promise waits until the model is loaded.
 * A kept server outlives the agent, so the next start skips loading the model.
 */
export async function startServer({
  serverPath,
  modelPath,
  port,
  ctx,
  gpuLayers,
  logFile,
  foreground,
  keep,
}) {
  const args = serverArgs({ modelPath, port, ctx, gpuLayers });
  const logFd = foreground ? null : openSync(logFile, 'w');
  const child = spawn(serverPath, args, {
    cwd: dirname(serverPath), // Windows finds the backend DLLs next to the exe
    stdio: foreground ? 'inherit' : ['ignore', logFd, logFd],
    detached: Boolean(keep),
    windowsHide: true,
  });
  if (keep) child.unref();
  if (logFd !== null) closeSync(logFd);
  let exited = null;
  child.on('exit', (code, signal) => {
    exited = { code, signal };
  });
  child.on('error', (error) => {
    exited = { code: -1, error };
  });
  // One SIGKILL, sent once. The agent stops the server in `finally` and again on exit;
  // a second SIGTERM makes llama-server call exit() inside its signal handler, which
  // on macOS trips a Metal assert and can hang with the model still in memory, where
  // the next start then reuses it. The server has nothing to save, and a swapped-out
  // one would have to page back in just to shut down cleanly.
  let killed = false;
  const kill = () => {
    if (exited !== null || killed) return;
    killed = true;
    child.kill('SIGKILL');
  };
  process.on('exit', kill);
  const stop = keep ? () => process.off('exit', kill) : kill;
  if (foreground) return { child, stop };

  const baseUrl = `http://127.0.0.1:${port}/v1`;
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    if (exited) {
      const log = logTail(logFile);
      const reason = exited.error
        ? exited.error.message
        : `Exit-Code ${exited.code ?? exited.signal}`;
      throw new ServerError(
        `Der Modell-Server ist abgestürzt (${reason}).\n${explainFailure(log)}\nLog: ${logFile}`,
      );
    }
    if (await probeServer(baseUrl)) return { child, stop };
    await sleep(500);
  }
  kill();
  throw new ServerError(`Der Modell-Server wurde nicht rechtzeitig fertig. Log: ${logFile}`);
}
