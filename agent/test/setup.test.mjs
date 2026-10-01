import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { parseArgs, UsageError } from '../lib/config.mjs';
import { explainFailure, serverArgs, startServer } from '../lib/server.mjs';
import {
  assetChoices,
  download,
  ensureLlamaServer,
  pickModelFile,
  pickRelease,
} from '../lib/setup.mjs';
import { setOutput } from '../lib/ui.mjs';

setOutput({ write: () => true });

// Asset names as llama.cpp's release workflow publishes them.
const tag = 'b9001';
const names = [
  `llama-${tag}-bin-macos-arm64.tar.gz`,
  `llama-${tag}-bin-macos-x64.tar.gz`,
  `llama-${tag}-bin-ubuntu-x64.tar.gz`,
  `llama-${tag}-bin-ubuntu-arm64.tar.gz`,
  `llama-${tag}-bin-ubuntu-vulkan-x64.tar.gz`,
  `llama-${tag}-bin-ubuntu-cuda-12.8-x64.tar.gz`,
  `cudart-llama-${tag}-bin-ubuntu-cuda-12.8-x64.tar.gz`,
  `llama-${tag}-bin-ubuntu-cuda-13.4-x64.tar.gz`,
  `llama-${tag}-bin-win-cpu-x64.zip`,
  `llama-${tag}-bin-win-cpu-arm64.zip`,
  `llama-${tag}-bin-win-vulkan-x64.zip`,
  `llama-${tag}-bin-win-cuda-12.4-x64.zip`,
  'cudart-llama-bin-win-cuda-12.4-x64.zip',
  `llama-${tag}-bin-win-cuda-13.4-x64.zip`,
  `llama-${tag}-xcframework.zip`,
  `llama-${tag}-ui.tar.gz`,
];
const releases = [
  { tag_name: 'b9002', draft: true, assets: names.map((name) => ({ name })) },
  { tag_name: tag, draft: false, prerelease: true, assets: names.map((name) => ({ name })) },
];
const pick = (computer) => {
  const release = pickRelease(releases, assetChoices(computer));
  return release && [release.tag, ...release.assets.map((a) => a.name)];
};

test('picks the llama.cpp build that fits the computer', () => {
  assert.deepEqual(pick({ platform: 'darwin', arch: 'arm64' }), [
    tag,
    `llama-${tag}-bin-macos-arm64.tar.gz`,
  ]);
  assert.deepEqual(pick({ platform: 'win32', arch: 'x64', nvidia: true }), [
    tag,
    `llama-${tag}-bin-win-cuda-12.4-x64.zip`,
    'cudart-llama-bin-win-cuda-12.4-x64.zip',
  ]);
  assert.deepEqual(pick({ platform: 'win32', arch: 'x64' }), [
    tag,
    `llama-${tag}-bin-win-vulkan-x64.zip`,
  ]);
  assert.deepEqual(pick({ platform: 'win32', arch: 'arm64' }), [
    tag,
    `llama-${tag}-bin-win-cpu-arm64.zip`,
  ]);
  assert.deepEqual(pick({ platform: 'linux', arch: 'x64', nvidia: true }), [
    tag,
    `llama-${tag}-bin-ubuntu-cuda-12.8-x64.tar.gz`,
    `cudart-llama-${tag}-bin-ubuntu-cuda-12.8-x64.tar.gz`,
  ]);
  assert.deepEqual(pick({ platform: 'linux', arch: 'x64', vulkan: true }), [
    tag,
    `llama-${tag}-bin-ubuntu-vulkan-x64.tar.gz`,
  ]);
  assert.deepEqual(pick({ platform: 'linux', arch: 'arm64' }), [
    tag,
    `llama-${tag}-bin-ubuntu-arm64.tar.gz`,
  ]);
  assert.equal(pick({ platform: 'freebsd', arch: 'x64' }), null);
});

test('falls back when the preferred build is missing', () => {
  const withoutCuda = [
    { tag_name: tag, assets: names.filter((n) => !n.includes('cuda')).map((name) => ({ name })) },
  ];
  const release = pickRelease(
    withoutCuda,
    assetChoices({ platform: 'win32', arch: 'x64', nvidia: true }),
  );
  assert.equal(release.assets[0].name, `llama-${tag}-bin-win-vulkan-x64.zip`);
});

test('picks the model file for a quantization', () => {
  const files = [
    'README.md',
    'gemma-4-12B-it-uncensored-Q4_K_M.gguf',
    'gemma-4-12B-it-uncensored-Q8_0.gguf',
    'mmproj-gemma-4-12B-it-Q8_0.gguf',
  ];
  assert.equal(pickModelFile(files, 'Q4_K_M'), 'gemma-4-12B-it-uncensored-Q4_K_M.gguf');
  assert.equal(pickModelFile(files, 'q8_0'), 'gemma-4-12B-it-uncensored-Q8_0.gguf');
  assert.equal(pickModelFile(files, 'Q6_K'), null);
});

test('parses the command line', () => {
  const options = parseArgs(['--auto', '--kontext=8192', '--port', '9000', 'räum', 'auf']);
  assert.equal(options.command, 'chat');
  assert.equal(options.auto, true);
  assert.equal(options.ctx, 8192);
  assert.equal(options.port, 9000);
  assert.equal(options.prompt, 'räum auf');
  assert.equal(parseArgs(['server']).command, 'server');
  assert.equal(parseArgs(['erkläre', 'server']).prompt, 'erkläre server');
  assert.throws(() => parseArgs(['--kontext', 'viel']), UsageError);
  assert.throws(() => parseArgs(['--port']), UsageError);
  assert.throws(() => parseArgs(['--unbekannt']), UsageError);
});

test('server arguments and failure advice', () => {
  const args = serverArgs({ modelPath: 'm.gguf', port: 8088, ctx: 16384, gpuLayers: '20' });
  assert.deepEqual(args.slice(0, 2), ['-m', 'm.gguf']);
  assert.ok(args.includes('--jinja'));
  assert.deepEqual(args.slice(-2), ['-ngl', '20']);
  assert.match(explainFailure('error: unknown model architecture: gemma4unified'), /update/);
  assert.match(explainFailure("couldn't bind HTTP server socket"), /Port/);
  assert.match(
    explainFailure('ggml_backend_cuda_buffer_type_alloc_buffer: cudaMalloc failed: out of memory'),
    /Speicher/,
  );
});

describe('downloads', { skip: process.platform === 'win32' }, () => {
  const home = mkdtempSync(join(tmpdir(), 'jave-agent-setup-'));
  const payload = Buffer.from('x'.repeat(100_000));
  let server;
  let origin;
  const served = [];

  before(async () => {
    // A release archive like llama.cpp's: one top-level folder with the binaries.
    const pack = join(home, 'pack');
    mkdirSync(join(pack, 'llama-b1'), { recursive: true });
    writeFileSync(join(pack, 'llama-b1', 'llama-server'), '#!/bin/sh\necho server\n');
    writeFileSync(join(pack, 'llama-b1', 'libggml.so'), 'lib');
    execFileSync('tar', ['-czf', join(home, 'archive.tar.gz'), '-C', pack, 'llama-b1']);
    const archive = readFileSync(join(home, 'archive.tar.gz'));
    server = createServer((req, res) => {
      served.push(`${req.url} ${req.headers.range ?? ''}`.trim());
      if (req.url === '/releases') {
        const suffixes = [
          'macos-arm64',
          'macos-x64',
          'ubuntu-x64',
          'ubuntu-arm64',
          'ubuntu-vulkan-x64',
          'ubuntu-vulkan-arm64',
        ];
        const assets = suffixes.map((s) => ({
          name: `llama-b1-bin-${s}.tar.gz`,
          browser_download_url: `${origin}/archive/${s}`,
        }));
        res.end(JSON.stringify([{ tag_name: 'b1', draft: false, prerelease: true, assets }]));
      } else if (req.url.startsWith('/archive/')) {
        res.end(archive);
      } else if (req.url === '/blob') {
        const range = /bytes=(\d+)-/.exec(req.headers.range ?? '');
        if (range) {
          const start = Number(range[1]);
          res.writeHead(206, { 'Content-Length': payload.length - start });
          res.end(payload.subarray(start));
        } else {
          res.writeHead(200, { 'Content-Length': payload.length });
          res.end(payload);
        }
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => {
    server.close();
    rmSync(home, { recursive: true, force: true });
  });

  test('an interrupted download continues where it stopped', async () => {
    const dest = join(home, 'model.gguf');
    writeFileSync(`${dest}.part`, payload.subarray(0, 40_000));
    await download(`${origin}/blob`, dest, 'model');
    assert.deepEqual(readFileSync(dest), payload);
    assert.ok(served.includes('/blob bytes=40000-'));
    assert.ok(!existsSync(`${dest}.part`));
  });

  test('installs llama-server from a release archive, once', async () => {
    const path = await ensureLlamaServer({ home, releasesUrl: `${origin}/releases` });
    assert.equal(path, join(home, 'llama.cpp', 'llama-server'));
    assert.equal(execFileSync(path, { encoding: 'utf8' }), 'server\n');
    assert.ok(existsSync(join(home, 'llama.cpp', 'libggml.so')));
    assert.match(readFileSync(join(home, 'llama.cpp', 'VERSION'), 'utf8'), /^b1 /);
    const requests = served.length;
    assert.equal(await ensureLlamaServer({ home, releasesUrl: `${origin}/releases` }), path);
    assert.equal(served.length, requests, 'no network when already installed');
  });
});

describe('stopping the model server', () => {
  // A server that ignores SIGTERM, like a llama-server stuck in its shutdown.
  test('stop ends a server that ignores SIGTERM', { skip: process.platform === 'win32' }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jave-stop-'));
    const fake = join(dir, 'llama-server');
    writeFileSync(
      fake,
      `#!${process.execPath}\nprocess.on('SIGTERM', () => {});\nsetInterval(() => {}, 1000);\n`,
      { mode: 0o755 },
    );
    try {
      const { child, stop } = await startServer({
        serverPath: fake,
        modelPath: 'none.gguf',
        port: 1,
        ctx: 512,
        foreground: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve(signal)));
      stop();
      stop(); // the agent stops it in `finally` and again on process exit
      const signal = await Promise.race([
        exited,
        new Promise((resolve) => setTimeout(() => resolve('still running'), 3000)),
      ]);
      if (signal === 'still running') child.kill('SIGKILL');
      assert.equal(signal, 'SIGKILL');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
