import { randomUUID } from 'node:crypto';

/**
 * A streaming client for the OpenAI chat API as llama-server speaks it.
 *
 * llama-server turns Gemma 4's native tool calls into structured `tool_calls`.
 * Servers that do not (older builds, other runtimes) leave the raw tokens in
 * the text: `<|tool_call>call:name{key:<|"|>value<|"|>}<tool_call|>`, with
 * thinking in `<|channel>thought…<channel|>`. Those are parsed here as well and
 * never shown to the user.
 */

export class ContextOverflowError extends Error {}
export class ModelError extends Error {}

const TOOL_OPEN = '<|tool_call>';
const TOOL_CLOSE = '<tool_call|>';
const THOUGHT_OPEN = '<|channel>';
const THOUGHT_CLOSE = '<channel|>';
const STRING_DELIMITER = '<|"|>';

/** Removes thinking blocks (closed or still open at the end). */
export function stripThoughts(text) {
  return text.replace(/<\|channel>[\s\S]*?(<channel\|>|$)/g, '');
}

/** Parses the argument object of a native Gemma 4 tool call into a plain value. */
export function parseNativeValue(source) {
  let i = 0;
  const skip = () => {
    while (i < source.length && /\s/.test(source[i])) i++;
  };
  const startsWith = (token) => source.startsWith(token, i);

  function string() {
    if (startsWith(STRING_DELIMITER)) {
      i += STRING_DELIMITER.length;
      const end = source.indexOf(STRING_DELIMITER, i);
      const value = source.slice(i, end < 0 ? source.length : end);
      i = end < 0 ? source.length : end + STRING_DELIMITER.length;
      return value;
    }
    // A JSON string, which the model sometimes writes instead.
    let j = i + 1;
    while (j < source.length && source[j] !== '"') j += source[j] === '\\' ? 2 : 1;
    const raw = source.slice(i, j + 1);
    i = j + 1;
    try {
      return JSON.parse(raw);
    } catch {
      return raw.slice(1, -1);
    }
  }

  function bare(stops) {
    const start = i;
    while (i < source.length && !stops.includes(source[i])) i++;
    const word = source.slice(start, i).trim();
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'null') return null;
    if (word !== '' && !Number.isNaN(Number(word))) return Number(word);
    return word;
  }

  function value(stops) {
    skip();
    if (startsWith(STRING_DELIMITER) || source[i] === '"') return string();
    if (source[i] === '{') return object();
    if (source[i] === '[') return array();
    return bare(stops);
  }

  function array() {
    i++; // [
    const items = [];
    skip();
    while (i < source.length && source[i] !== ']') {
      items.push(value([',', ']']));
      skip();
      if (source[i] === ',') i++;
      skip();
    }
    i++; // ]
    return items;
  }

  function object() {
    i++; // {
    const result = {};
    skip();
    while (i < source.length && source[i] !== '}') {
      const key =
        startsWith(STRING_DELIMITER) || source[i] === '"' ? string() : bare([':', ',', '}']);
      skip();
      if (source[i] === ':') i++;
      result[String(key)] = value([',', '}']);
      skip();
      if (source[i] === ',') i++;
      skip();
    }
    i++; // }
    return result;
  }

  skip();
  return source[i] === '{' ? object() : value([]);
}

/** Finds native tool calls in model text: [{ id, name, arguments }] plus the text without them. */
export function parseNativeToolCalls(text) {
  const calls = [];
  let rest = stripThoughts(text);
  let index = rest.indexOf(TOOL_OPEN);
  const visible = index < 0 ? rest : rest.slice(0, index);
  while (index >= 0) {
    const bodyStart = index + TOOL_OPEN.length;
    const close = rest.indexOf(TOOL_CLOSE, bodyStart);
    const body = rest.slice(bodyStart, close < 0 ? rest.length : close).trim();
    const match = /^(?:call:)?([\w.-]+)\s*([\s\S]*)$/.exec(body);
    if (match) {
      let args = {};
      try {
        const parsed = match[2].trim() ? parseNativeValue(match[2]) : {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
      } catch {
        args = {};
      }
      calls.push({ id: `call_${randomUUID().slice(0, 8)}`, name: match[1], arguments: args });
    }
    rest = close < 0 ? '' : rest.slice(close + TOOL_CLOSE.length);
    index = rest.indexOf(TOOL_OPEN);
  }
  return { calls, text: visible.trim() };
}

/** Parses structured tool-call arguments, removing stray string delimiters some builds leave in. */
export function parseArguments(raw) {
  if (raw && typeof raw === 'object') return raw;
  const text = String(raw ?? '').trim();
  if (!text) return {};
  const parsed = JSON.parse(text);
  const clean = (value) => {
    if (typeof value === 'string') return value.split(STRING_DELIMITER).join('');
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)]));
    }
    return value;
  };
  return clean(parsed);
}

/**
 * Filters streamed text for display: hides native tool calls and thinking
 * blocks, holding back a chunk that might be the start of one.
 */
export class VisibleText {
  constructor() {
    this.buffer = '';
    this.mode = 'text';
  }

  push(chunk) {
    this.buffer += chunk;
    let out = '';
    while (this.buffer) {
      if (this.mode === 'tool') {
        this.buffer = '';
        break;
      }
      if (this.mode === 'thought') {
        const end = this.buffer.indexOf(THOUGHT_CLOSE);
        if (end < 0) {
          this.buffer = this.buffer.slice(-THOUGHT_CLOSE.length);
          break;
        }
        this.buffer = this.buffer.slice(end + THOUGHT_CLOSE.length);
        this.mode = 'text';
        continue;
      }
      const marker = this.buffer.indexOf('<');
      if (marker < 0) {
        out += this.buffer;
        this.buffer = '';
        break;
      }
      out += this.buffer.slice(0, marker);
      this.buffer = this.buffer.slice(marker);
      if (this.buffer.startsWith(TOOL_OPEN)) {
        this.mode = 'tool';
        continue;
      }
      if (this.buffer.startsWith(THOUGHT_OPEN)) {
        this.buffer = this.buffer.slice(THOUGHT_OPEN.length);
        this.mode = 'thought';
        continue;
      }
      if (TOOL_OPEN.startsWith(this.buffer) || THOUGHT_OPEN.startsWith(this.buffer)) break; // wait for more
      out += '<';
      this.buffer = this.buffer.slice(1);
    }
    return out;
  }

  flush() {
    const rest = this.mode === 'text' ? this.buffer : '';
    this.buffer = '';
    return rest;
  }
}

/** Reads an SSE response body and yields each parsed `data:` payload. */
async function* events(body) {
  const decoder = new TextDecoder();
  let pending = '';
  for await (const chunk of body) {
    pending += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        yield JSON.parse(data);
      } catch {
        // a keep-alive or partial line
      }
    }
  }
}

/**
 * One streamed model reply. Text reaches `onText` as it arrives, thinking
 * `onReasoning`; the result carries the full text and the tool calls.
 */
export async function chat({
  baseUrl,
  apiKey,
  model,
  messages,
  tools,
  think = false,
  maxTokens = 4096,
  signal,
  onText = () => {},
  onReasoning = () => {},
}) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages,
      tools,
      tool_choice: 'auto',
      stream: true,
      max_tokens: maxTokens,
      // Google's recommended sampling for Gemma, a little cooler for reliable tool calls.
      temperature: 0.7,
      top_p: 0.95,
      top_k: 64,
      chat_template_kwargs: { enable_thinking: think },
    }),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    if (/context|too long|exceed/i.test(detail) && response.status === 400) {
      throw new ContextOverflowError(detail);
    }
    throw new ModelError(`Modell-Server antwortet mit ${response.status}: ${detail.slice(0, 500)}`);
  }

  const filter = new VisibleText();
  const calls = [];
  let raw = '';
  let reasoning = '';
  let finishReason = null;
  let timings = null;
  let usage = null;
  for await (const event of events(response.body)) {
    if (event.error) {
      const message = event.error.message ?? JSON.stringify(event.error);
      if (/context|exceed/i.test(message)) throw new ContextOverflowError(message);
      throw new ModelError(message);
    }
    if (event.timings) timings = event.timings;
    if (event.usage) usage = event.usage;
    const choice = event.choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta ?? {};
    if (delta.reasoning_content) {
      reasoning += delta.reasoning_content;
      onReasoning(delta.reasoning_content);
    }
    if (delta.content) {
      raw += delta.content;
      const visible = filter.push(delta.content);
      if (visible) onText(visible);
    }
    for (const part of delta.tool_calls ?? []) {
      const index = part.index ?? calls.length;
      calls[index] ??= { id: '', name: '', arguments: '' };
      if (part.id) calls[index].id = part.id;
      if (part.function?.name) calls[index].name += part.function.name;
      if (part.function?.arguments) calls[index].arguments += part.function.arguments;
    }
  }
  const tail = filter.flush();
  if (tail) onText(tail);

  let toolCalls = calls.filter(Boolean).map((call) => {
    let args;
    let error;
    try {
      args = parseArguments(call.arguments);
    } catch {
      args = {};
      error =
        finishReason === 'length'
          ? 'The arguments were cut off (output limit). Split the work into smaller pieces.'
          : 'The arguments were not valid JSON.';
    }
    return {
      id: call.id || `call_${randomUUID().slice(0, 8)}`,
      name: call.name,
      arguments: args,
      error,
    };
  });
  let text = stripThoughts(raw);
  if (!toolCalls.length && raw.includes(TOOL_OPEN)) {
    const native = parseNativeToolCalls(raw);
    toolCalls = native.calls;
    text = native.text;
  }
  return { text: text.trim(), reasoning, toolCalls, finishReason, timings, usage };
}
