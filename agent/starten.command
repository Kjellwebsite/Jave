#!/usr/bin/env bash
# JAVE Agent: double-click on macOS, or run in a terminal. Works in your home
# folder; uses the Node.js that the JAVE installer put in ~/JAVE/node if needed.
AGENT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="${JAVE_HOME:-$HOME/JAVE}/node/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js fehlt. Zuerst JAVE installieren, siehe START-HIER.md"
  exit 1
fi
cd "$HOME" || exit 1
exec node "$AGENT_DIR/agent.mjs" "$@"
