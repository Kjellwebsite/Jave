#!/usr/bin/env bash
# JAVE in one line (macOS, Linux):
#
#   curl -fsSL https://raw.githubusercontent.com/Kjellwebsite/Jave/HEAD/install.sh | bash
#
# Installs into ~/JAVE: its own Node.js (unless a recent one is installed), the
# latest JAVE, and a "JAVE" starter on the desktop (macOS). Then starts JAVE
# (start.mjs). Running it again updates JAVE; settings (.env) and data stay.
set -euo pipefail

REPO="Kjellwebsite/Jave"
JAVE_DIR="${JAVE_HOME:-$HOME/JAVE}"
APP_DIR="$JAVE_DIR/app"
NODE_DIR="$JAVE_DIR/node"
NODE_MAJOR=22
# Where JAVE comes from; overridable for testing an unreleased copy.
TARBALL="${JAVE_TARBALL:-https://github.com/${REPO}/archive/HEAD.tar.gz}"

say() { printf '%s\n' "$*"; }
node_ok() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)'
}

mkdir -p "$APP_DIR"
if [ -x "$NODE_DIR/bin/node" ]; then export PATH="$NODE_DIR/bin:$PATH"; fi

if ! node_ok; then
  say "▸ Lade Node.js (einmalig) …"
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) say "✗ Dieses System wird nicht unterstützt: $(uname -s)"; exit 1 ;;
  esac
  case "$(uname -m)" in
    arm64 | aarch64) arch=arm64 ;;
    x86_64 | amd64) arch=x64 ;;
    *) say "✗ Dieser Prozessor wird nicht unterstützt: $(uname -m)"; exit 1 ;;
  esac
  # index.json lists releases newest first: the first v22 is the latest.
  version=$(curl -fsSL https://nodejs.org/dist/index.json |
    grep -o "\"version\":\"v${NODE_MAJOR}\.[0-9.]*\"" | head -1 | cut -d'"' -f4)
  rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR"
  curl -fsSL "https://nodejs.org/dist/${version}/node-${version}-${os}-${arch}.tar.gz" |
    tar -xz -C "$NODE_DIR" --strip-components=1
  export PATH="$NODE_DIR/bin:$PATH"
fi

say "▸ Lade JAVE …"
curl -fsSL "$TARBALL" | tar -xz -C "$APP_DIR" --strip-components=1

# A starter for next time: double-click on macOS, or run ~/JAVE/start.sh.
cat >"$JAVE_DIR/start.sh" <<EOF
#!/usr/bin/env bash
export PATH="$NODE_DIR/bin:\$PATH"
cd "$APP_DIR" && exec node start.mjs
EOF
chmod +x "$JAVE_DIR/start.sh"
if [ "$(uname -s)" = Darwin ] && [ -d "$HOME/Desktop" ]; then
  cp "$JAVE_DIR/start.sh" "$HOME/Desktop/JAVE.command"
  chmod +x "$HOME/Desktop/JAVE.command"
  say "✓ Zum nächsten Start: Doppelklick auf „JAVE“ auf dem Schreibtisch."
else
  say "✓ Zum nächsten Start: $JAVE_DIR/start.sh"
fi

cd "$APP_DIR"
# Piped into bash, stdin is this script: the questions need the keyboard.
if { : </dev/tty; } 2>/dev/null; then exec node start.mjs </dev/tty; else exec node start.mjs; fi
