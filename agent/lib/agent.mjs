import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { platform, release } from 'node:os';
import { chat, ContextOverflowError } from './llm.mjs';
import { runTool, SHELL, TOOL_DEFINITIONS } from './tools.mjs';
import { bold, cyan, dim, red, say, write, yellow } from './ui.mjs';

/**
 * The agent loop: the model answers or calls tools, tool results go back to
 * it, until it answers without a tool call. The conversation is trimmed to
 * fit the context window, oldest tool output first.
 */

const MAX_STEPS = 40;
const CHARS_PER_TOKEN = 3.2;
const TOOLS_TOKENS = 1600;

const OS_NAMES = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };

export function systemPrompt({ cwd, modelName }) {
  const today = new Date().toISOString().slice(0, 10);
  let prompt = `You are JAVE Agent, a fast AI agent that runs entirely on the user's own computer (${modelName}, local via llama.cpp). You have real access to this computer through your tools: list, find, search, read, write and edit files, run ${SHELL} commands, fetch web pages and search the web.

Environment:
- Operating system: ${OS_NAMES[platform()] ?? platform()} (${platform()} ${release()})
- Shell for run_command: ${SHELL}
- Working directory: ${cwd}
- Today: ${today}

How you work:
- Act instead of describing: when a task needs information or a change, call the tools. Do not ask for permission; the program asks the user itself before anything that changes the computer.
- Read a file before editing it. Use edit_file for small changes and write_file for new files.
- Relative paths start at the working directory.
- If a tool fails, read the error and try a different approach instead of repeating the same call.
- For current facts use web_search, then fetch_url on the best result.
- Keep going until the task is done, then reply briefly with what you did and the result.
- Be concise. Answer in the user's language (usually German).`;
  const notes = join(cwd, 'AGENTS.md');
  if (existsSync(notes)) {
    prompt += `\n\nProject notes (AGENTS.md):\n${readFileSync(notes, 'utf8').slice(0, 8000)}`;
  }
  return prompt;
}

const estimateTokens = (messages) =>
  Math.ceil(JSON.stringify(messages).length / CHARS_PER_TOKEN) + TOOLS_TOKENS;

/**
 * Trims `messages` in place until it fits `budget` tokens: first old tool
 * results shrink, then whole old turns go. The system prompt and the current
 * turn always stay.
 */
export function fitContext(messages, budget) {
  if (estimateTokens(messages) <= budget) return false;
  const shorten = (message) => {
    if (message.role === 'tool' && message.content.length > 400) {
      message.content = `${message.content.slice(0, 300)}\n[… shortened to save space; run the tool again if needed]`;
    }
  };
  for (let i = 1; i < messages.length - 2 && estimateTokens(messages) > budget; i++)
    shorten(messages[i]);
  while (estimateTokens(messages) > budget) {
    const current = messages.findLastIndex((m) => m.role === 'user');
    if (current <= 1) break;
    const next = messages.findIndex((m, i) => i > 1 && m.role === 'user');
    messages.splice(1, next - 1);
  }
  for (let i = 1; i < messages.length && estimateTokens(messages) > budget; i++)
    shorten(messages[i]);
  return true;
}

function describeCall(name, args) {
  const pick = args.command ?? args.path ?? args.url ?? args.query ?? args.pattern ?? '';
  const text = String(pick).replace(/\s+/g, ' ');
  return text.length > 100 ? `${text.slice(0, 100)}…` : text;
}

function summarize(result) {
  const lines = result.output.split('\n');
  if (!result.ok) return red(`  ✗ ${lines[0].slice(0, 200)}`);
  const first = lines.find((line) => line.trim()) ?? '';
  const more = lines.length > 1 ? dim(` (+${lines.length - 1} Zeilen)`) : '';
  return dim(`  ↳ ${first.slice(0, 120)}`) + more;
}

export class Agent {
  /**
   * @param {object} options
   * @param {string} options.baseUrl OpenAI-compatible endpoint, e.g. http://127.0.0.1:8088/v1
   * @param {string} options.modelName
   * @param {number} options.ctx context window in tokens
   * @param {(request: object) => Promise<boolean>} options.approve asks the owner
   */
  constructor({ baseUrl, apiKey, modelName, ctx, cwd, think, approve }) {
    Object.assign(this, { baseUrl, apiKey, modelName, ctx, cwd, think, approve });
    this.maxTokens = Math.min(8192, Math.floor(ctx / 3));
    this.reset();
  }

  reset() {
    this.messages = [
      { role: 'system', content: systemPrompt({ cwd: this.cwd, modelName: this.modelName }) },
    ];
  }

  setCwd(cwd) {
    this.cwd = cwd;
    this.messages[0] = {
      role: 'system',
      content: systemPrompt({ cwd, modelName: this.modelName }),
    };
  }

  async complete(signal) {
    let budget = this.ctx - this.maxTokens;
    for (let attempt = 0; ; attempt++) {
      fitContext(this.messages, budget);
      let started = false;
      let thinking = false;
      try {
        return await chat({
          baseUrl: this.baseUrl,
          apiKey: this.apiKey,
          model: this.modelName,
          messages: this.messages,
          tools: TOOL_DEFINITIONS,
          think: this.think,
          maxTokens: this.maxTokens,
          signal,
          onReasoning: (text) => {
            if (!thinking) write(dim('💭 '));
            thinking = true;
            write(dim(text));
          },
          onText: (text) => {
            if (thinking) write('\n\n');
            thinking = false;
            if (!started && !text.trim()) return;
            started = true;
            write(text);
          },
        }).finally(() => {
          if (started || thinking) write('\n');
        });
      } catch (error) {
        if (!(error instanceof ContextOverflowError) || attempt >= 2) throw error;
        budget = Math.floor(budget * 0.6);
      }
    }
  }

  /** Runs one user request to its end; a cancelled request leaves a well-formed history. */
  async run(userText, signal) {
    this.messages.push({ role: 'user', content: userText });
    try {
      await this.#loop(signal);
    } catch (error) {
      this.#closeTurn();
      throw error;
    }
  }

  /** After a cancel: every tool call gets a result, and the turn ends with an answer. */
  #closeTurn() {
    const answered = new Set(
      this.messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id),
    );
    const last = this.messages.at(-1);
    if (last.role === 'user') {
      this.messages.pop();
      return;
    }
    if (last.role === 'assistant' && last.tool_calls) {
      for (const call of last.tool_calls) {
        if (!answered.has(call.id)) {
          this.messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.function.name,
            content: 'Cancelled by the user.',
          });
        }
      }
    }
    if (this.messages.at(-1).role === 'tool') {
      this.messages.push({ role: 'assistant', content: '(cancelled by the user)' });
    }
  }

  async #loop(signal) {
    const started = Date.now();
    let lastSpeed = null;
    let repeats = { key: '', count: 0 };
    for (let step = 0; step < MAX_STEPS; step++) {
      const reply = await this.complete(signal);
      if (reply.timings?.predicted_per_second) lastSpeed = reply.timings.predicted_per_second;
      const message = { role: 'assistant', content: reply.text };
      if (reply.toolCalls.length) {
        message.tool_calls = reply.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        }));
      }
      this.messages.push(message);
      if (!reply.toolCalls.length) {
        if (reply.finishReason === 'length')
          say(yellow('  (Antwort wurde am Längenlimit abgeschnitten)'));
        break;
      }
      for (const call of reply.toolCalls) {
        say(`${cyan('⚙')} ${bold(call.name)} ${dim(describeCall(call.name, call.arguments))}`);
        const key = `${call.name}:${JSON.stringify(call.arguments)}`;
        repeats = key === repeats.key ? { key, count: repeats.count + 1 } : { key, count: 1 };
        let result;
        if (call.error) {
          result = { ok: false, output: `Error: ${call.error}` };
        } else if (repeats.count >= 3) {
          result = {
            ok: false,
            output:
              'Error: you made this exact call 3 times in a row. Change your approach or answer the user.',
          };
        } else {
          result = await runTool(call.name, call.arguments, {
            cwd: this.cwd,
            approve: this.approve,
            signal,
            onOutput: liveOutput(),
          });
        }
        say(summarize(result));
        this.messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.name,
          content: result.output,
        });
      }
      if (step === MAX_STEPS - 1)
        say(
          yellow(`  (nach ${MAX_STEPS} Schritten angehalten; „weiter“ schreiben, um fortzufahren)`),
        );
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    say(dim(`  ${seconds} s${lastSpeed ? ` · ${Math.round(lastSpeed)} Tokens/s` : ''}`));
  }
}

/** Shows the first lines of a running command's output, dimmed, so long commands visibly progress. */
function liveOutput(maxLines = 12) {
  let shown = 0;
  let pending = '';
  return (text) => {
    if (shown > maxLines) return;
    pending += text;
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) {
      if (shown === maxLines) {
        say(dim('  │ …'));
        shown++;
        return;
      }
      say(dim(`  │ ${line.slice(0, 160)}`));
      shown++;
    }
  };
}
