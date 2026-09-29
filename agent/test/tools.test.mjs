import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  clip,
  globToRegExp,
  htmlToText,
  parseSearchResults,
  runTool,
  TOOL_DEFINITIONS,
} from '../lib/tools.mjs';

const dir = mkdtempSync(join(tmpdir(), 'jave-agent-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const yes = async () => true;
const no = async () => false;

test('every tool definition has a handler', async () => {
  for (const tool of TOOL_DEFINITIONS) {
    const result = await runTool(tool.function.name, {}, { cwd: dir, approve: no });
    assert.doesNotMatch(result.output, /Unknown tool/, tool.function.name);
  }
  assert.match((await runTool('nope', {}, { cwd: dir, approve: no })).output, /Unknown tool/);
});

test('write, read, edit and search a file', async () => {
  const ctx = { cwd: dir, approve: yes };
  const written = await runTool(
    'write_file',
    { path: 'sub/notes.txt', content: 'eins\nzwei\ndrei\n' },
    ctx,
  );
  assert.ok(written.ok, written.output);
  assert.equal(readFileSync(join(dir, 'sub/notes.txt'), 'utf8'), 'eins\nzwei\ndrei\n');

  const read = await runTool(
    'read_file',
    { path: 'sub/notes.txt', start_line: 2, max_lines: 1 },
    ctx,
  );
  assert.match(read.output, /^2\| zwei\n\(lines 2-2 of 4; continue with start_line=3\)$/);

  const edited = await runTool(
    'edit_file',
    { path: 'sub/notes.txt', old_text: 'zwei', new_text: 'ZWEI' },
    ctx,
  );
  assert.ok(edited.ok, edited.output);
  assert.equal(readFileSync(join(dir, 'sub/notes.txt'), 'utf8'), 'eins\nZWEI\ndrei\n');

  const missing = await runTool(
    'edit_file',
    { path: 'sub/notes.txt', old_text: 'vier', new_text: 'x' },
    ctx,
  );
  assert.equal(missing.ok, false);

  const found = await runTool('search_files', { pattern: 'zwei', ignore_case: true }, ctx);
  assert.match(found.output, /notes\.txt:2: ZWEI/);

  const files = await runTool('find_files', { pattern: '*.txt' }, ctx);
  assert.match(files.output, /notes\.txt/);
});

test('edit keeps Windows line endings', async () => {
  writeFileSync(join(dir, 'crlf.txt'), 'a\r\nb\r\nc\r\n');
  const result = await runTool(
    'edit_file',
    { path: 'crlf.txt', old_text: 'a\nb', new_text: 'a\nB' },
    { cwd: dir, approve: yes },
  );
  assert.ok(result.ok, result.output);
  assert.equal(readFileSync(join(dir, 'crlf.txt'), 'utf8'), 'a\r\nB\r\nc\r\n');
});

test('a declined write changes nothing', async () => {
  const result = await runTool(
    'write_file',
    { path: 'nein.txt', content: 'x' },
    { cwd: dir, approve: no },
  );
  assert.match(result.output, /declined/);
  assert.throws(() => readFileSync(join(dir, 'nein.txt')));
});

test(
  'run_command returns output and exit code',
  { skip: process.platform === 'win32' },
  async () => {
    const result = await runTool(
      'run_command',
      { command: 'echo hallo; exit 3' },
      { cwd: dir, approve: yes },
    );
    assert.match(result.output, /hallo\n\[exit code 3\]$/);
    const slow = await runTool(
      'run_command',
      { command: 'sleep 5', timeout_seconds: 1 },
      { cwd: dir, approve: yes },
    );
    assert.match(slow.output, /stopped after 1 s/);
  },
);

test(
  'run_command stops when the request is cancelled',
  { skip: process.platform === 'win32' },
  async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const started = Date.now();
    const result = await runTool(
      'run_command',
      { command: 'echo start; sleep 10' },
      { cwd: dir, approve: yes, signal: controller.signal },
    );
    assert.ok(Date.now() - started < 5000);
    assert.match(result.output, /start\n\[stopped by the user\]/);
  },
);

test('find_files skips node_modules', async () => {
  mkdirSync(join(dir, 'node_modules/pkg'), { recursive: true });
  writeFileSync(join(dir, 'node_modules/pkg/index.js'), '');
  writeFileSync(join(dir, 'main.js'), '');
  const result = await runTool('find_files', { pattern: '**/*.js' }, { cwd: dir, approve: no });
  assert.equal(result.output, 'main.js');
});

test('globs', () => {
  assert.ok(globToRegExp('*.ts').test('a.ts'));
  assert.ok(!globToRegExp('*.ts').test('a/b.ts'));
  assert.ok(globToRegExp('**/*.ts').test('a/b/c.ts'));
  assert.ok(globToRegExp('**/*.ts').test('c.ts'));
  assert.ok(globToRegExp('*.{js,mjs}').test('x.mjs'));
  assert.ok(!globToRegExp('*.{js,mjs}').test('x.ts'));
  assert.ok(globToRegExp('a,b.txt').test('a,b.txt'));
});

test('clip keeps head and tail', () => {
  const text = 'a'.repeat(100) + 'b'.repeat(100);
  const clipped = clip(text, 50);
  assert.ok(clipped.startsWith('a'.repeat(20)));
  assert.ok(clipped.endsWith('b'.repeat(30)));
  assert.match(clipped, /150 characters omitted/);
});

test('html becomes readable text', () => {
  const html = `<html><head><title>Titel</title><style>x{}</style></head><body>
    <h1>Kopf</h1><p>Text &amp; mehr&nbsp;&#8364;</p><script>alert(1)</script>
    <ul><li>eins</li><li><a href="/doc">Doku</a></li></ul></body></html>`;
  const text = htmlToText(html, 'https://example.org/start');
  assert.match(text, /^# Titel/);
  assert.match(text, /## Kopf/);
  assert.match(text, /Text & mehr €/);
  assert.match(text, /- \[Doku\]\(https:\/\/example\.org\/doc\)/);
  assert.doesNotMatch(text, /alert|x\{\}/);
});

test('search results are read from the DuckDuckGo page', () => {
  const html = `
    <div class="result results_links web-result"><div class="links_main">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fa%3Fb%3D1&amp;rut=x">Example <b>A</b></a>
      <a class="result__snippet" href="#">Snippet &amp; more</a>
    </div></div>
    <div class="result result--ad"><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a></div>`;
  assert.deepEqual(parseSearchResults(html), [
    { title: 'Example A', url: 'https://example.org/a?b=1', snippet: 'Snippet & more' },
  ]);
});
