#!/bin/sh
set -eu
target="${XDG_DATA_HOME:-$HOME/.local/share}/folio-review"
"$target/node" "$target/desktop/agents.mjs" remove
rm -f "${XDG_DATA_HOME:-$HOME/.local/share}/applications/folio-review.desktop"
for entry in node_modules server desktop src dist licenses; do rm -rf -- "$target/$entry"; done
rm -f -- "$target/node" "$target/package.json" "$target/folio" "$target/installed-agent-skills.json" "$target/uninstall.sh"
rmdir "$target" || true
