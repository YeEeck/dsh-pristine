#!/usr/bin/env bash
# Remove the Pristine preset from the DeepSeek Harness user preset root.
set -eu

PRESET_ID='pristine'
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
TARGET="$DSH_HOME_DIR/.agent-presets/$PRESET_ID"

usage() {
  cat <<EOF
Usage: $0 [--yes] [--help]

Remove the Pristine preset from \$DSH_HOME/.agent-presets/$PRESET_ID/
(default DSH_HOME: ~/.dsh).

Options:
  --yes    Skip the confirmation prompt.
  --help   Show this help.
EOF
}

YES=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES=1 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "error: unknown option: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

if [ ! -e "$TARGET" ] && [ ! -L "$TARGET" ]; then
  echo "nothing to remove: $TARGET"
  exit 0
fi

if [ "$YES" -eq 0 ]; then
  printf 'remove %s? [y/N] ' "$TARGET"
  read -r answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) echo 'aborted'; exit 0 ;;
  esac
fi

if [ -L "$TARGET" ]; then
  rm "$TARGET"
else
  rm -rf "$TARGET"
fi

echo "removed $TARGET"
