import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

/**
 * What the agent can do on this computer. Reading, searching and the web run
 * straight away; writing files and running commands go through `approve`
 * (the owner says yes, no, or "always" in the terminal, or --auto).
 */

const WINDOWS = process.platform === 'win32';
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.pnpm-store',
  '.turbo',
  '__pycache__',
  '.venv',
  'venv',
  '.cache',
  '.jave-local',
]);
const MAX_TOOL_OUTPUT = 16_000;
const MAX_READ_LINES = 400;
const MAX_WALK = 50_000;
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

export const SHELL = WINDOWS ? 'PowerShell' : existsSync('/bin/bash') ? 'bash' : 'sh';

const fn = (name, description, properties, required = []) => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: { type: 'object', properties, required },
  },
});
const str = (description) => ({ type: 'string', description });
const int = (description) => ({ type: 'integer', description });

export const TOOL_DEFINITIONS = [
  fn('list_directory', 'List the files and folders in a directory.', {
    path: str('Directory path (default: working directory).'),
  }),
  fn(
    'read_file',
    `Read a text file. Returns numbered lines, at most ${MAX_READ_LINES} per call; use start_line to continue.`,
    {
      path: str('File path.'),
      start_line: int('First line to read (1-based).'),
      max_lines: int('How many lines.'),
    },
    ['path'],
  ),
  fn(
    'find_files',
    'Find files by name with a glob pattern, e.g. "*.pdf", "**/*.ts", "src/**/config*".',
    {
      pattern: str('Glob pattern.'),
      path: str('Directory to search in (default: working directory).'),
    },
    ['pattern'],
  ),
  fn(
    'search_files',
    'Search the contents of text files with a regular expression (like grep). Returns file:line: text.',
    {
      pattern: str('Regular expression.'),
      path: str('File or directory to search (default: working directory).'),
      file_pattern: str('Only files whose name matches this glob, e.g. "*.js".'),
      ignore_case: { type: 'boolean', description: 'Case-insensitive search.' },
    },
    ['pattern'],
  ),
  fn(
    'write_file',
    'Create a file or replace its whole content. Creates missing folders.',
    { path: str('File path.'), content: str('The complete new content.') },
    ['path', 'content'],
  ),
  fn(
    'edit_file',
    'Replace an exact piece of text in a file. old_text must match exactly once (whitespace included) unless replace_all is true. Read the file first.',
    {
      path: str('File path.'),
      old_text: str('The exact text to replace.'),
      new_text: str('The replacement text.'),
      replace_all: { type: 'boolean', description: 'Replace every occurrence.' },
    },
    ['path', 'old_text', 'new_text'],
  ),
  fn(
    'run_command',
    `Run a ${SHELL} command on this computer and return its output and exit code. Non-interactive: no input can be typed.`,
    {
      command: str(`The ${SHELL} command.`),
      cwd: str('Directory to run in (default: working directory).'),
      timeout_seconds: int('Stop after this many seconds (default 120, max 1800).'),
    },
    ['command'],
  ),
  fn(
    'fetch_url',
    'Download a web page or file from the internet and return it as readable text.',
    { url: str('http(s) URL.'), offset: int('Character offset to continue a long page.') },
    ['url'],
  ),
  fn(
    'web_search',
    'Search the web (DuckDuckGo). Returns titles, URLs and snippets; then use fetch_url to read a result.',
    { query: str('Search query.') },
    ['query'],
  ),
];

class ToolError extends Error {}

function resolvePath(path, cwd) {
  if (!path || path === '.') return cwd;
  const expanded =
    path === '~' || path.startsWith('~/') || path.startsWith('~\\')
      ? join(homedir(), path.slice(1))
      : path;
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

/** Keeps the start and the end of long output, which is where the useful parts usually are. */
export function clip(text, max = MAX_TOOL_OUTPUT) {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.4);
  const tail = max - head;
  return `${text.slice(0, head)}\n\n[… ${text.length - max} characters omitted …]\n\n${text.slice(-tail)}`;
}

/** Converts a glob (`*`, `**`, `?`, `{a,b}`) to a regular expression. */
export function globToRegExp(glob) {
  let out = '';
  let braces = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/' || glob[i + 1] === '\\') {
          i++;
          out += '(?:.*[/\\\\])?';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/\\\\]*';
      }
    } else if (c === '?') out += '[^/\\\\]';
    else if (c === '{') {
      braces++;
      out += '(?:';
    } else if (c === '}' && braces) {
      braces--;
      out += ')';
    } else if (c === ',' && braces) out += '|';
    else if (c === '/' || c === '\\') out += '[/\\\\]';
    else out += c.replace(/[.+^$()|[\]]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, WINDOWS ? 'i' : '');
}

function* walk(root, limit = MAX_WALK) {
  const stack = [root];
  let seen = 0;
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (++seen > limit) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(path);
      } else if (entry.isFile()) {
        yield path;
      }
    }
  }
}

function isBinary(buffer) {
  const sample = buffer.subarray(0, 8000);
  return sample.includes(0);
}

function listDirectory({ path }, { cwd }) {
  const dir = resolvePath(path, cwd);
  const entries = readdirSync(dir, { withFileTypes: true });
  const rows = entries
    .sort(
      (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
    )
    .slice(0, 300)
    .map((entry) => {
      if (entry.isDirectory()) return `${entry.name}/`;
      try {
        return `${entry.name}  (${statSync(join(dir, entry.name)).size} bytes)`;
      } catch {
        return entry.name;
      }
    });
  const more = entries.length > 300 ? `\n… and ${entries.length - 300} more` : '';
  return `${dir}\n${rows.join('\n') || '(empty)'}${more}`;
}

function readFile({ path, start_line, max_lines }, { cwd }) {
  const file = resolvePath(path, cwd);
  const size = statSync(file).size;
  if (size > 20_000_000)
    throw new ToolError(`File is ${size} bytes; too big. Use search_files or run_command.`);
  const buffer = readFileSync(file);
  if (isBinary(buffer)) return `${file} is a binary file (${size} bytes).`;
  const lines = buffer.toString('utf8').split(/\r?\n/);
  const start = Math.max(1, Number(start_line) || 1);
  const count = Math.min(Math.max(1, Number(max_lines) || MAX_READ_LINES), 2000);
  const end = Math.min(lines.length, start + count - 1);
  const width = String(end).length;
  const body = lines
    .slice(start - 1, end)
    .map(
      (line, i) =>
        `${String(start + i).padStart(width)}| ${line.length > 2000 ? `${line.slice(0, 2000)}…` : line}`,
    )
    .join('\n');
  const note =
    end < lines.length
      ? `\n(lines ${start}-${end} of ${lines.length}; continue with start_line=${end + 1})`
      : '';
  return clip(body, 60_000) + note;
}

function findFiles({ pattern, path }, { cwd }) {
  const root = resolvePath(path, cwd);
  const byName = !/[/\\]/.test(pattern);
  const regex = globToRegExp(pattern);
  const hits = [];
  for (const file of walk(root)) {
    const rel = relative(root, file);
    const subject = byName ? file.slice(dirname(file).length + 1) : rel;
    if (regex.test(subject)) hits.push(rel);
    if (hits.length >= 200) break;
  }
  return hits.length
    ? hits.join('\n') + (hits.length >= 200 ? '\n(first 200 results)' : '')
    : 'No files found.';
}

function searchFiles({ pattern, path, file_pattern, ignore_case }, { cwd }) {
  const flags = ignore_case ? 'i' : '';
  let regex;
  try {
    regex = new RegExp(pattern, flags);
  } catch {
    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  }
  const target = resolvePath(path, cwd);
  const nameFilter = file_pattern ? globToRegExp(file_pattern) : null;
  const files = statSync(target).isFile() ? [target] : walk(target);
  const base = statSync(target).isFile() ? dirname(target) : target;
  const hits = [];
  for (const file of files) {
    if (nameFilter && !nameFilter.test(file.slice(dirname(file).length + 1))) continue;
    let buffer;
    try {
      if (statSync(file).size > 2_000_000) continue;
      buffer = readFileSync(file);
    } catch {
      continue;
    }
    if (isBinary(buffer)) continue;
    const lines = buffer.toString('utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        hits.push(`${relative(base, file) || file}:${i + 1}: ${lines[i].trim().slice(0, 300)}`);
        if (hits.length >= 150) break;
      }
    }
    if (hits.length >= 150) break;
  }
  return hits.length
    ? hits.join('\n') + (hits.length >= 150 ? '\n(first 150 matches)' : '')
    : 'No matches.';
}

async function writeFile({ path, content }, { cwd, approve }) {
  if (typeof content !== 'string') throw new ToolError('content must be a string.');
  const file = resolvePath(path, cwd);
  const exists = existsSync(file);
  const lines = content.split('\n').length;
  const preview = content
    .split('\n')
    .slice(0, 12)
    .map((line) => `+ ${line}`);
  if (lines > 12) preview.push(`  … (${lines} lines)`);
  const allowed = await approve({
    kind: 'write',
    title: `${exists ? 'Datei überschreiben' : 'Datei anlegen'}: ${file}`,
    preview,
  });
  if (!allowed) return 'The user declined this action.';
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return `${exists ? 'Replaced' : 'Created'} ${file} (${lines} lines).`;
}

async function editFile({ path, old_text, new_text, replace_all }, { cwd, approve }) {
  const file = resolvePath(path, cwd);
  if (typeof old_text !== 'string' || typeof new_text !== 'string' || old_text === '') {
    throw new ToolError('old_text and new_text must be strings, old_text not empty.');
  }
  const original = readFileSync(file, 'utf8');
  // The model often writes \n where the file has \r\n: match line endings of the file.
  const crlf = original.includes('\r\n');
  const from = crlf && !old_text.includes('\r\n') ? old_text.replace(/\n/g, '\r\n') : old_text;
  const to = crlf && !new_text.includes('\r\n') ? new_text.replace(/\n/g, '\r\n') : new_text;
  const count = original.split(from).length - 1;
  if (count === 0)
    throw new ToolError('old_text was not found. Read the file again and copy the text exactly.');
  if (count > 1 && !replace_all) {
    throw new ToolError(
      `old_text occurs ${count} times. Include more surrounding text, or set replace_all.`,
    );
  }
  const preview = [
    ...old_text
      .split('\n')
      .slice(0, 10)
      .map((line) => `- ${line}`),
    ...new_text
      .split('\n')
      .slice(0, 10)
      .map((line) => `+ ${line}`),
  ];
  const allowed = await approve({ kind: 'write', title: `Datei ändern: ${file}`, preview });
  if (!allowed) return 'The user declined this action.';
  writeFileSync(
    file,
    replace_all ? original.split(from).join(to) : original.replace(from, () => to),
  );
  return `Edited ${file} (${replace_all ? count : 1} replacement${count > 1 && replace_all ? 's' : ''}).`;
}

function killTree(child) {
  if (child.exitCode !== null) return;
  if (WINDOWS) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

async function runCommand(
  { command, cwd: dir, timeout_seconds },
  { cwd, approve, signal, onOutput },
) {
  if (typeof command !== 'string' || !command.trim()) throw new ToolError('command is empty.');
  const where = resolvePath(dir, cwd);
  const allowed = await approve({
    kind: 'run',
    title: `Befehl ausführen (${SHELL}, in ${where}):`,
    preview: [command],
  });
  if (!allowed) return 'The user declined this action.';
  const seconds = Math.min(Math.max(Number(timeout_seconds) || 120, 1), 1800);
  const [file, args] = WINDOWS
    ? [
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          // Base64 (UTF-16LE) survives any quotes in the command, which -Command would mangle.
          '-EncodedCommand',
          Buffer.from(
            `$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; ${command}`,
            'utf16le',
          ).toString('base64'),
        ],
      ]
    : [SHELL === 'bash' ? '/bin/bash' : '/bin/sh', ['-c', command]];
  const child = spawn(file, args, {
    cwd: where,
    env: { ...process.env, PAGER: 'cat', GIT_PAGER: 'cat', TERM: 'dumb' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !WINDOWS,
    windowsHide: true,
  });
  let output = '';
  const collect = (chunk) => {
    const text = chunk.toString('utf8');
    if (output.length < 400_000) output += text;
    onOutput?.(text);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  let reason = '';
  const timer = setTimeout(() => {
    reason = `\n[stopped after ${seconds} s]`;
    killTree(child);
  }, seconds * 1000);
  const onAbort = () => {
    reason = '\n[stopped by the user]';
    killTree(child);
  };
  signal?.addEventListener('abort', onAbort);
  const code = await new Promise((done) => {
    child.on('error', (error) => {
      output += String(error.message);
      done(-1);
    });
    child.on('close', (exitCode) => done(exitCode));
  });
  clearTimeout(timer);
  signal?.removeEventListener('abort', onAbort);
  return `${clip(output.trimEnd() || '(no output)')}${reason}\n[exit code ${code ?? 'killed'}]`;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Readable text from HTML: no scripts, styles or tags; links kept as [text](url). */
export function htmlToText(html, baseUrl) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  let text = html
    .replace(/<(script|style|noscript|svg|template|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<a\s[^>]*href="([^"#][^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
      const inner = label.replace(/<[^>]+>/g, '').trim();
      if (!inner) return '';
      try {
        const url = new URL(href.replace(/&amp;/g, '&'), baseUrl);
        return /^https?:$/.test(url.protocol) ? `[${inner}](${url.href})` : inner;
      } catch {
        return inner;
      }
    })
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<(br|hr)[^>]*>/gi, '\n')
    .replace(
      /<\/(p|div|section|article|h[1-6]|tr|ul|ol|table|header|footer|main|nav|blockquote|pre)>/gi,
      '\n',
    )
    .replace(/<h[1-6][^>]*>/gi, '\n## ')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (entity, code) => {
      if (code[0] === '#') {
        const n =
          code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(n) ? String.fromCodePoint(n) : entity;
      }
      return ENTITIES[code.toLowerCase()] ?? entity;
    })
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (title) text = `# ${title}\n\n${text}`;
  return text;
}

async function fetchUrl({ url, offset }, { signal }) {
  let target;
  try {
    target = new URL(url);
  } catch {
    throw new ToolError('Not a valid URL.');
  }
  if (!/^https?:$/.test(target.protocol)) throw new ToolError('Only http and https URLs.');
  const response = await fetch(target, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/json,text/plain,*/*' },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
    redirect: 'follow',
  });
  const type = response.headers.get('content-type') ?? '';
  const buffer = Buffer.from(await response.arrayBuffer());
  const status = `HTTP ${response.status} ${response.url}`;
  if (!/text|json|xml|javascript|html/i.test(type) && isBinary(buffer)) {
    return `${status}\nBinary content (${type || 'unknown type'}, ${buffer.length} bytes).`;
  }
  const raw = buffer.toString('utf8');
  const text =
    /html/i.test(type) || /^\s*<(!doctype|html)/i.test(raw) ? htmlToText(raw, response.url) : raw;
  const start = Math.max(0, Number(offset) || 0);
  const page = text.slice(start, start + 20_000);
  const more =
    start + 20_000 < text.length
      ? `\n\n[${text.length - start - 20_000} more characters: offset=${start + 20_000}]`
      : '';
  return `${status}\n\n${page}${more}`;
}

/** Results from DuckDuckGo's HTML page: [{ title, url, snippet }]. */
export function parseSearchResults(html) {
  const results = [];
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/i).slice(1);
  for (const block of blocks) {
    const link = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(
      block,
    );
    if (!link) continue;
    let href = link[1].replace(/&amp;/g, '&');
    const redirect = /[?&]uddg=([^&]+)/.exec(href);
    if (redirect) href = decodeURIComponent(redirect[1]);
    if (href.startsWith('//')) href = `https:${href}`;
    if (/duckduckgo\.com\/y\.js/.test(href)) continue; // ads
    const snippet =
      /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(a|div|td)>/i.exec(block)?.[1] ?? '';
    results.push({
      title: htmlToText(link[2]),
      url: href,
      snippet: htmlToText(snippet),
    });
  }
  return results;
}

async function webSearch({ query }, { signal }) {
  if (typeof query !== 'string' || !query.trim()) throw new ToolError('query is empty.');
  const response = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'User-Agent': BROWSER_UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ q: query }).toString(),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
  });
  const results = parseSearchResults(await response.text()).slice(0, 8);
  if (!results.length) {
    return 'No results (the search may be rate-limited). Try other words, or fetch_url a site directly.';
  }
  return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n');
}

const HANDLERS = {
  list_directory: listDirectory,
  read_file: readFile,
  find_files: findFiles,
  search_files: searchFiles,
  write_file: writeFile,
  edit_file: editFile,
  run_command: runCommand,
  fetch_url: fetchUrl,
  web_search: webSearch,
};

/** Runs one tool call and returns its result as text for the model; failures become text too. */
export async function runTool(name, args, context) {
  const handler = HANDLERS[name];
  if (!handler)
    return {
      ok: false,
      output: `Unknown tool "${name}". Available: ${Object.keys(HANDLERS).join(', ')}.`,
    };
  try {
    return { ok: true, output: await handler(args ?? {}, context) };
  } catch (error) {
    if (error.name === 'AbortError' || context.signal?.aborted) throw error;
    const message =
      error instanceof ToolError
        ? error.message
        : `${error.code ? `${error.code}: ` : ''}${error.message}`;
    return { ok: false, output: `Error: ${message}` };
  }
}
