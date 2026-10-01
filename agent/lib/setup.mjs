import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { once } from 'node:events';
import { basename, join } from 'node:path';
import { MODEL_REPO } from './config.mjs';
import { ok, progressLine, say, step, warn } from './ui.mjs';

/**
 * Downloads what the agent runs on: a llama.cpp release (llama-server, with the
 * GPU backend that fits this computer) and the GGUF model. Both resume after an
 * interruption and are only fetched once.
 */

const WINDOWS = process.platform === 'win32';
const SERVER_EXE = WINDOWS ? 'llama-server.exe' : 'llama-server';
const RELEASES_API = 'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10';
const USER_AGENT = 'jave-agent';

export class SetupError extends Error {}

function commandWorks(command, args) {
  try {
    return spawnSync(command, args, { stdio: 'ignore', timeout: 10_000 }).status === 0;
  } catch {
    return false;
  }
}

function hasVulkanLoader() {
  if (process.platform !== 'linux') return false;
  const probe = spawnSync('sh', ['-c', 'ldconfig -p 2>/dev/null | grep -q "libvulkan.so.1"']);
  if (probe.status === 0) return true;
  return ['/usr/lib/x86_64-linux-gnu', '/usr/lib/aarch64-linux-gnu', '/usr/lib64', '/usr/lib'].some(
    (dir) => existsSync(join(dir, 'libvulkan.so.1')),
  );
}

/**
 * Which release archives fit this computer, best first. Each choice names the
 * main archive and, for CUDA, the runtime libraries that go next to it.
 */
export function assetChoices({
  platform = process.platform,
  arch = process.arch,
  nvidia = false,
  vulkan = false,
} = {}) {
  const main = (suffix) => new RegExp(`^llama-b\\d+-bin-${suffix}$`);
  if (platform === 'darwin') {
    return [
      {
        label: 'macOS (Metal)',
        main: main(`macos-${arch === 'arm64' ? 'arm64' : 'x64'}\\.tar\\.gz`),
      },
    ];
  }
  if (platform === 'win32') {
    if (arch === 'arm64')
      return [{ label: 'Windows ARM (CPU)', main: main('win-cpu-arm64\\.zip') }];
    const choices = [];
    if (nvidia) {
      choices.push({
        label: 'Windows (NVIDIA CUDA 12)',
        main: main('win-cuda-12\\.\\d+-x64\\.zip'),
        extra: /^cudart-llama-bin-win-cuda-12\.\d+-x64\.zip$/,
      });
    }
    choices.push({ label: 'Windows (Vulkan-GPU, sonst CPU)', main: main('win-vulkan-x64\\.zip') });
    choices.push({ label: 'Windows (CPU)', main: main('win-cpu-x64\\.zip') });
    return choices;
  }
  if (platform === 'linux') {
    const cpuArch = arch === 'arm64' ? 'arm64' : 'x64';
    const choices = [];
    if (nvidia && cpuArch === 'x64') {
      choices.push({
        label: 'Linux (NVIDIA CUDA 12)',
        main: main('ubuntu-cuda-12\\.\\d+-x64\\.tar\\.gz'),
        extra: /^cudart-llama-b\d+-bin-ubuntu-cuda-12\.\d+-x64\.tar\.gz$/,
      });
    }
    if (vulkan)
      choices.push({
        label: 'Linux (Vulkan-GPU)',
        main: main(`ubuntu-vulkan-${cpuArch}\\.tar\\.gz`),
      });
    choices.push({ label: 'Linux (CPU)', main: main(`ubuntu-${cpuArch}\\.tar\\.gz`) });
    return choices;
  }
  return [];
}

/** The newest release that has an archive for this computer (releases are marked pre-release). */
export function pickRelease(releases, choices) {
  for (const release of releases) {
    if (release.draft) continue;
    const assets = release.assets ?? [];
    for (const choice of choices) {
      const main = assets.find((asset) => choice.main.test(asset.name));
      if (!main) continue;
      const extra = choice.extra
        ? assets.find((asset) => choice.extra.test(asset.name))
        : undefined;
      if (choice.extra && !extra) continue;
      return { tag: release.tag_name, label: choice.label, assets: [main, extra].filter(Boolean) };
    }
  }
  return null;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new SetupError(`${url} antwortet mit ${response.status}.`);
  return response.json();
}

/** Downloads `url` to `dest` with a progress line; an interrupted download continues where it stopped. */
export async function download(url, dest, label) {
  const part = `${dest}.part`;
  let start = existsSync(part) ? statSync(part).size : 0;
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, ...(start ? { Range: `bytes=${start}-` } : {}) },
  });
  if (response.status === 416 && start) {
    // The partial file is already complete.
    renameSync(part, dest);
    return;
  }
  if (!response.ok) throw new SetupError(`Download fehlgeschlagen (${response.status}): ${url}`);
  if (start && response.status !== 206) start = 0; // the server ignored the range: start over
  const length = Number(response.headers.get('content-length') || 0);
  const total = length ? start + length : 0;
  const out = createWriteStream(part, { flags: start ? 'a' : 'w' });
  const progress = progressLine(label);
  let done = start;
  try {
    for await (const chunk of response.body) {
      if (!out.write(chunk)) await once(out, 'drain');
      done += chunk.length;
      progress.update(done, total);
    }
  } finally {
    await new Promise((resolve) => out.end(resolve));
    progress.done();
  }
  if (total && statSync(part).size !== total) {
    throw new SetupError(
      'Der Download ist unvollständig. Einfach noch einmal starten, er macht dort weiter.',
    );
  }
  renameSync(part, dest);
}

function extract(archive, dir) {
  mkdirSync(dir, { recursive: true });
  // Windows 10+ ships bsdtar, which also unpacks zip files; a GNU tar from Git would not.
  const tar = WINDOWS
    ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
  const attempts = [[tar, ['-xf', archive, '-C', dir]]];
  if (archive.endsWith('.zip')) {
    if (WINDOWS) {
      const quote = (p) => `'${p.replace(/'/g, "''")}'`;
      attempts.push([
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(dir)} -Force`,
        ],
      ]);
    } else {
      attempts.push(['unzip', ['-o', '-q', archive, '-d', dir]]);
    }
  }
  for (const [command, args] of attempts) {
    if (commandWorks(command, args)) return;
  }
  throw new SetupError(`${basename(archive)} konnte nicht entpackt werden.`);
}

/** Moves an unpacked archive into `target`, lifting the single top-level folder tarballs have. */
function mergeInto(unpacked, target) {
  let root = unpacked;
  const entries = readdirSync(root, { withFileTypes: true });
  if (entries.length === 1 && entries[0].isDirectory()) root = join(root, entries[0].name);
  cpSync(root, target, { recursive: true, force: true, verbatimSymlinks: true });
}

function installedServer(binDir) {
  const path = join(binDir, SERVER_EXE);
  return existsSync(path) ? path : null;
}

/** Returns the path of llama-server, downloading the newest llama.cpp release when needed. */
export async function ensureLlamaServer({
  home,
  explicit,
  update = false,
  releasesUrl = RELEASES_API,
}) {
  if (explicit) {
    if (!existsSync(explicit)) throw new SetupError(`llama-server nicht gefunden: ${explicit}`);
    return explicit;
  }
  const binDir = join(home, 'llama.cpp');
  const existing = installedServer(binDir);
  if (existing && !update) return existing;

  step(update ? 'Aktualisiere llama.cpp …' : 'Lade llama.cpp (einmalig, ~50–400 MB) …');
  const nvidia = commandWorks('nvidia-smi', ['-L']);
  const choices = assetChoices({ nvidia, vulkan: hasVulkanLoader() });
  if (!choices.length) {
    throw new SetupError(
      `Für ${process.platform}/${process.arch} gibt es kein fertiges llama.cpp. ` +
        'Selbst bauen (https://github.com/ggml-org/llama.cpp) und mit --llama-server <pfad> angeben.',
    );
  }
  let releases;
  try {
    releases = await fetchJson(releasesUrl);
  } catch (error) {
    if (existing) {
      warn(`Keine Verbindung zu GitHub (${error.message}); die installierte Version bleibt.`);
      return existing;
    }
    throw new SetupError(`llama.cpp-Versionen nicht abrufbar: ${error.message}`);
  }
  const release = pickRelease(releases, choices);
  if (!release)
    throw new SetupError('In den neuesten llama.cpp-Versionen fehlt ein passendes Paket.');

  const versionFile = join(binDir, 'VERSION');
  const current = existsSync(versionFile) ? readFileSync(versionFile, 'utf8').trim() : '';
  if (existing && current === `${release.tag} ${release.label}`) {
    ok(`llama.cpp ${release.tag} ist schon aktuell.`);
    return existing;
  }

  const staging = join(home, 'llama.cpp.new');
  const downloads = join(home, 'downloads');
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  mkdirSync(downloads, { recursive: true });
  say(`  ${release.label}, Version ${release.tag}`);
  for (const asset of release.assets) {
    const archive = join(downloads, asset.name);
    if (!existsSync(archive)) await download(asset.browser_download_url, archive, asset.name);
    const unpacked = join(downloads, `${asset.name}.unpacked`);
    rmSync(unpacked, { recursive: true, force: true });
    extract(archive, unpacked);
    mergeInto(unpacked, staging);
    rmSync(unpacked, { recursive: true, force: true });
    rmSync(archive, { force: true });
  }
  const server = installedServer(staging);
  if (!server) throw new SetupError(`Im Paket fehlt ${SERVER_EXE}.`);
  if (!WINDOWS) chmodSync(server, 0o755);
  writeFileSync(join(staging, 'VERSION'), `${release.tag} ${release.label}\n`);
  rmSync(binDir, { recursive: true, force: true });
  renameSync(staging, binDir);
  ok(`llama.cpp ${release.tag} installiert.`);
  return installedServer(binDir);
}

/** The file for a quantization in the model repo's file list (no vision projector). */
export function pickModelFile(files, quant) {
  const wanted = quant.toLowerCase();
  const ggufs = files.filter((f) => f.toLowerCase().endsWith('.gguf') && !/mmproj/i.test(f));
  return ggufs.find((f) => basename(f).toLowerCase().includes(wanted)) ?? null;
}

/** Returns the path of the GGUF model, downloading it from Hugging Face when needed. */
export async function ensureModel({ home, quant, explicit }) {
  if (explicit) {
    if (!existsSync(explicit)) throw new SetupError(`Modelldatei nicht gefunden: ${explicit}`);
    return explicit;
  }
  const dir = join(home, 'models');
  mkdirSync(dir, { recursive: true });
  const local = readdirSync(dir).find(
    (f) => f.toLowerCase().endsWith('.gguf') && f.toLowerCase().includes(quant.toLowerCase()),
  );
  if (local) return join(dir, local);

  step(`Lade das Modell Gemma 4 12B uncensored (${quant}, einmalig) …`);
  let files;
  try {
    const info = await fetchJson(`https://huggingface.co/api/models/${MODEL_REPO}`);
    files = (info.siblings ?? []).map((s) => s.rfilename);
  } catch (error) {
    throw new SetupError(`Hugging Face nicht erreichbar: ${error.message}`);
  }
  const file = pickModelFile(files, quant);
  if (!file) {
    const available = files.filter((f) => f.endsWith('.gguf')).map((f) => basename(f));
    throw new SetupError(
      `Keine ${quant}-Datei im Modell. Vorhanden: ${available.join(', ') || 'keine'}`,
    );
  }
  const dest = join(dir, basename(file));
  const url = `https://huggingface.co/${MODEL_REPO}/resolve/main/${file.split('/').map(encodeURIComponent).join('/')}`;
  say(`  ${MODEL_REPO} → ${basename(file)}`);
  say('  Tipp: Abbrechen ist kein Problem, beim nächsten Start geht der Download weiter.');
  await download(url, dest, basename(file));
  ok('Modell geladen.');
  return dest;
}
