import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseArguments,
  parseNativeToolCalls,
  parseNativeValue,
  stripThoughts,
  VisibleText,
} from '../lib/llm.mjs';

const Q = '<|"|>';

test('parses a native Gemma 4 tool call with strings, numbers, booleans and lists', () => {
  const raw = `Ich schreibe die Datei.<|tool_call>call:write_file{content:${Q}print("hi, {x}")\n${Q},path:${Q}hello.py${Q},lines:3,force:true,tags:[${Q}a${Q},${Q}b${Q}],ratio:0.5}<tool_call|>`;
  const { calls, text } = parseNativeToolCalls(raw);
  assert.equal(text, 'Ich schreibe die Datei.');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'write_file');
  assert.deepEqual(calls[0].arguments, {
    content: 'print("hi, {x}")\n',
    path: 'hello.py',
    lines: 3,
    force: true,
    tags: ['a', 'b'],
    ratio: 0.5,
  });
  assert.match(calls[0].id, /^call_/);
});

test('parses several calls, nested objects, and a call cut off at the end', () => {
  const raw = `<|tool_call>call:a{x:{y:${Q}z${Q}}}<tool_call|><|tool_call>call:b{q:${Q}unfinished`;
  const { calls } = parseNativeToolCalls(raw);
  assert.deepEqual(
    calls.map((c) => [c.name, c.arguments]),
    [
      ['a', { x: { y: 'z' } }],
      ['b', { q: 'unfinished' }],
    ],
  );
});

test('ignores tool calls inside a thinking block', () => {
  const raw = `<|channel>thought I could <|tool_call>call:x{}<tool_call|><channel|>Antwort`;
  assert.equal(stripThoughts(raw), 'Antwort');
  assert.deepEqual(parseNativeToolCalls(raw).calls, []);
});

test('accepts JSON-style strings in native arguments', () => {
  assert.deepEqual(parseNativeValue('{path:"a \\"b\\".txt",n:-2}'), { path: 'a "b".txt', n: -2 });
});

test('structured arguments lose stray string delimiters', () => {
  assert.deepEqual(parseArguments(JSON.stringify({ domain: [`${Q}light${Q}`] })), {
    domain: ['light'],
  });
  assert.deepEqual(parseArguments(''), {});
  assert.throws(() => parseArguments('{"broken'));
});

test('the display filter hides tool calls and thoughts, even split across chunks', () => {
  const filter = new VisibleText();
  const chunks = [
    'Hallo <',
    'b>Welt</b> <|chan',
    'nel>geheim<chan',
    'nel|>sichtbar <|tool',
    '_call>call:x{}',
  ];
  const shown = chunks.map((c) => filter.push(c)).join('') + filter.flush();
  assert.equal(shown, 'Hallo <b>Welt</b> sichtbar ');
});

test('the display filter keeps a trailing "<" that turns out to be text', () => {
  const filter = new VisibleText();
  assert.equal(filter.push('a <'), 'a ');
  assert.equal(filter.flush(), '<');
});
