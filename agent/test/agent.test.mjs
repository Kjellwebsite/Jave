import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { Agent, fitContext } from '../lib/agent.mjs';
import { setOutput } from '../lib/ui.mjs';

// What the user would see in the terminal.
let screen = '';
setOutput({ write: (text) => (screen += text) });

/**
 * A stand-in for llama-server: each request to /v1/chat/completions gets the
 * next scripted reply, streamed as server-sent events like llama.cpp sends them.
 */
const script = [];
const requests = [];
let server;
let baseUrl;

const sse = (res, chunks) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.end('data: [DONE]\n\n');
};
const delta = (d, finish = null) => ({ choices: [{ index: 0, delta: d, finish_reason: finish }] });

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push(JSON.parse(body));
      const next = script.shift();
      if (typeof next === 'function') next(res);
      else sse(res, next);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
});
after(() => server.close());

const dir = mkdtempSync(join(tmpdir(), 'jave-agent-e2e-'));
after(() => rmSync(dir, { recursive: true, force: true }));

test('runs tool calls (structured and native) until the model answers', async () => {
  const Q = '<|"|>';
  script.push(
    // 1: a structured tool call, streamed in pieces
    [
      delta({ role: 'assistant', content: null }),
      delta({
        tool_calls: [
          { index: 0, id: 'c1', type: 'function', function: { name: 'write_file', arguments: '' } },
        ],
      }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '{"path":"gruss.txt",' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '"content":"Hallo JAVE"}' } }] }),
      delta({}, 'tool_calls'),
    ],
    // 2: a native Gemma tool call left in the text
    [
      delta({ content: 'Ich prüfe' }),
      delta({ content: ` es.<|tool_call>call:read_file{path:${Q}gruss.txt${Q}}` }),
      delta({ content: '<tool_call|>' }, 'stop'),
    ],
    // 3: the final answer
    [
      delta({ reasoning_content: 'fertig' }),
      delta({ content: 'Erledigt: gruss.txt enthält „Hallo JAVE“.' }),
      { ...delta({}, 'stop'), timings: { predicted_per_second: 42.4 } },
    ],
  );
  const approvals = [];
  const agent = new Agent({
    baseUrl,
    modelName: 'gemma-4-12b',
    ctx: 16384,
    cwd: dir,
    think: false,
    approve: async (request) => {
      approvals.push(request.title);
      return true;
    },
  });
  screen = '';
  await agent.run('Schreib Hallo JAVE in gruss.txt');

  // The user sees the text and the tool lines, never Gemma's raw tokens.
  assert.match(screen, /Ich prüfe es\./);
  assert.match(screen, /⚙ write_file gruss\.txt/);
  assert.match(screen, /⚙ read_file gruss\.txt/);
  assert.match(screen, /Erledigt: gruss\.txt enthält/);
  assert.match(screen, /42 Tokens\/s/);
  assert.doesNotMatch(screen, /<\|tool_call>|<tool_call\|>|<\|"\|>/);

  assert.equal(readFileSync(join(dir, 'gruss.txt'), 'utf8'), 'Hallo JAVE');
  assert.equal(approvals.length, 1);
  assert.match(approvals[0], /gruss\.txt/);

  assert.equal(requests.length, 3);
  const first = requests[0];
  assert.equal(first.stream, true);
  assert.equal(first.model, 'gemma-4-12b');
  assert.deepEqual(first.chat_template_kwargs, { enable_thinking: false });
  assert.ok(first.tools.some((t) => t.function.name === 'run_command'));

  const roles = agent.messages.map((m) => m.role);
  assert.deepEqual(roles, [
    'system',
    'user',
    'assistant',
    'tool',
    'assistant',
    'tool',
    'assistant',
  ]);
  assert.equal(agent.messages[2].tool_calls[0].function.name, 'write_file');
  assert.equal(agent.messages[3].tool_call_id, 'c1');
  assert.equal(agent.messages[4].content, 'Ich prüfe es.');
  assert.equal(agent.messages[4].tool_calls[0].function.name, 'read_file');
  assert.match(agent.messages[5].content, /1\| Hallo JAVE/);
  assert.equal(agent.messages[6].content, 'Erledigt: gruss.txt enthält „Hallo JAVE“.');
  // The third request carried both tool results back to the model.
  assert.equal(requests[2].messages.filter((m) => m.role === 'tool').length, 2);
});

test('a context overflow shrinks the conversation and retries', async () => {
  requests.length = 0;
  script.push(
    (res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'the request exceeds the available context size' } }),
      );
    },
    [delta({ content: 'ok' }, 'stop')],
  );
  const agent = new Agent({
    baseUrl,
    modelName: 'm',
    ctx: 16384,
    cwd: dir,
    approve: async () => true,
  });
  await agent.run('hallo');
  assert.equal(requests.length, 2);
  assert.equal(agent.messages.at(-1).content, 'ok');
});

test('a cancel in the middle of a tool call leaves a well-formed history', async () => {
  script.push([
    delta({
      tool_calls: [
        {
          index: 0,
          id: 'k1',
          type: 'function',
          function: { name: 'list_directory', arguments: '{}' },
        },
        {
          index: 1,
          id: 'k2',
          type: 'function',
          function: { name: 'write_file', arguments: '{"path":"x","content":"y"}' },
        },
      ],
    }),
    delta({}, 'tool_calls'),
  ]);
  const controller = new AbortController();
  const agent = new Agent({
    baseUrl,
    modelName: 'm',
    ctx: 16384,
    cwd: dir,
    approve: async () => {
      controller.abort(); // Ctrl+C at the question
      return false;
    },
  });
  await assert.rejects(agent.run('mach was', controller.signal));
  assert.deepEqual(
    agent.messages.map((m) => [m.role, m.tool_call_id ?? '']),
    [
      ['system', ''],
      ['user', ''],
      ['assistant', ''],
      ['tool', 'k1'],
      ['tool', 'k2'],
      ['assistant', ''],
    ],
  );

  // Cancelled before any answer: the request is forgotten.
  const quiet = new Agent({
    baseUrl: 'http://127.0.0.1:9/v1',
    modelName: 'm',
    ctx: 16384,
    cwd: dir,
  });
  await assert.rejects(quiet.run('hallo'));
  assert.deepEqual(
    quiet.messages.map((m) => m.role),
    ['system'],
  );
});

test('fitContext shortens old tool output, then drops old turns, never the current one', () => {
  const big = 'x'.repeat(20_000);
  const messages = [
    { role: 'system', content: 's' },
    { role: 'user', content: 'alt' },
    { role: 'assistant', content: '', tool_calls: [] },
    { role: 'tool', content: big },
    { role: 'assistant', content: 'a' },
    { role: 'user', content: 'neu' },
    { role: 'assistant', content: '', tool_calls: [] },
    { role: 'tool', content: big },
  ];
  fitContext(messages, 9000);
  assert.ok(messages[3].content.length < 400);
  assert.equal(messages[7].content, big);

  fitContext(messages, 2500);
  assert.deepEqual(
    messages.map((m) => m.content.slice(0, 3)),
    ['s', 'neu', '', 'xxx'],
  );
  assert.ok(messages[3].content.length < 400);
});
