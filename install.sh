#!/usr/bin/env bash
# Install the Pristine preset into the DeepSeek Harness user preset root.
#
#   ./install.sh           snapshot copy (default)
#   ./install.sh --link    symlink preset/ so git pull updates apply immediately
#
# The preset root resolves from $DSH_HOME (default ~/.dsh):
#   $DSH_HOME/.agent-presets/pristine/
set -eu

PRESET_ID='pristine'
MODE='copy'

usage() {
  cat <<EOF
Usage: $0 [--link] [--help]

Install the Pristine preset under \$DSH_HOME/.agent-presets/$PRESET_ID/
(default DSH_HOME: ~/.dsh).

Options:
  --link   Symlink preset/ into the preset root instead of copying, so
           git pull updates take effect immediately.
  --help   Show this help.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --link) MODE='link' ;;
    --help|-h) usage; exit 0 ;;
    *) echo "error: unknown option: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PRESET_SRC="$SCRIPT_DIR/preset"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PRESET_ROOT="$DSH_HOME_DIR/.agent-presets"
TARGET="$PRESET_ROOT/$PRESET_ID"

[ -f "$PRESET_SRC/agent.cordis.yml" ] || {
  echo "error: preset/agent.cordis.yml not found next to this script" >&2
  exit 1
}

if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
  if [ -d "$TARGET" ] && diff -rq "$PRESET_SRC" "$TARGET" >/dev/null 2>&1; then
    echo "Pristine preset is already installed at $TARGET"
    exit 0
  fi
  echo "error: $TARGET already exists and differs; run ./uninstall.sh first" >&2
  exit 1
fi

mkdir -p "$PRESET_ROOT"

if [ "$MODE" = 'link' ]; then
  ln -s "$PRESET_SRC" "$TARGET"
else
  cp -R "$PRESET_SRC" "$TARGET"
fi

for file in agent.cordis.yml preset.yml warmup-bootstrap.mjs; do
  [ -f "$TARGET/$file" ] || {
    echo "error: verification failed: $file missing after install" >&2
    exit 1
  }
done

echo "installed Pristine preset at $TARGET ($MODE)"
echo "next: fully restart DeepSeek Harness, create a blank session, and select 'Pristine'"
