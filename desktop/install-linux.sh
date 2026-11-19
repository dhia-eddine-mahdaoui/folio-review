#!/bin/sh
set -eu
base=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
target="${XDG_DATA_HOME:-$HOME/.local/share}/folio-review"
apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$target" "$apps"
cp -R "$base/app/." "$target/"
"$target/node" "$target/desktop/agents.mjs" install
cp "$base/uninstall-linux.sh" "$target/uninstall.sh"
cat > "$apps/folio-review.desktop" <<ENTRY
[Desktop Entry]
Type=Application
Name=Folio Review
Exec="$target/node" "$target/desktop/launch.mjs"
Icon=$target/dist/client/folio.svg
Categories=Office;
Terminal=false
ENTRY
printf 'Installed Folio in %s\n' "$target"
