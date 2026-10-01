/** Terminal output: colors only on a real terminal, and never when NO_COLOR is set. */

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (COLOR ? `\x1b[${code}m${text}\x1b[0m` : String(text));

export const bold = paint('1');
export const dim = paint('2');
export const red = paint('31');
export const green = paint('32');
export const yellow = paint('33');
export const cyan = paint('36');
export const magenta = paint('35');

let output = process.stdout;
/** Sends all output elsewhere (tests capture it). */
export function setOutput(stream) {
  output = stream;
}

export const write = (text) => output.write(text);
export const say = (text = '') => output.write(`${text}\n`);
export const step = (text) => say(`\n${cyan('▸')} ${text}`);
export const ok = (text) => say(`${green('✓')} ${text}`);
export const warn = (text) => say(`${yellow('!')} ${text}`);

export function formatBytes(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.round(bytes / 1e3)} KB`;
}

/** A single self-overwriting progress line for downloads. */
export function progressLine(label) {
  let last = 0;
  const started = Date.now();
  return {
    update(done, total) {
      const now = Date.now();
      if (now - last < 250 && done !== total) return;
      last = now;
      const seconds = Math.max((now - started) / 1000, 0.001);
      const speed = `${formatBytes(done / seconds)}/s`;
      const part = total
        ? `${((done / total) * 100).toFixed(1)} % von ${formatBytes(total)}`
        : formatBytes(done);
      const text = `  ${label}: ${part} · ${speed}`;
      if (process.stdout.isTTY) write(`\r${text}\x1b[K`);
      else if (done === total) say(text);
    },
    done() {
      if (process.stdout.isTTY) write('\n');
    },
  };
}

/** A spinner for waits without a percentage (loading the model). */
export function spinner(label) {
  if (!process.stdout.isTTY) {
    say(`  ${label} …`);
    return {
      stop(finalText) {
        if (finalText) ok(finalText);
      },
    };
  }
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const started = Date.now();
  let i = 0;
  const timer = setInterval(() => {
    const seconds = Math.round((Date.now() - started) / 1000);
    write(`\r  ${cyan(frames[i++ % frames.length])} ${label} (${seconds} s)\x1b[K`);
  }, 100);
  return {
    stop(finalText) {
      clearInterval(timer);
      write('\r\x1b[K');
      if (finalText) ok(finalText);
    },
  };
}
