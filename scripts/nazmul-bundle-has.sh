#!/bin/bash
# Proof helper for docs/nazmul-mods.md: does the BUILT desktop app contain a string?
#   nazmul-bundle-has.sh [--asar] [--absent] [-F] <pattern>
# Looks in the renderer bundle (or app.asar with --asar). PASEO_APP overrides the app path.
APP="${PASEO_APP:-packages/desktop/release/mac-arm64/Paseo.app}"
target=renderer; want=present; flags=(-q)
while [ $# -gt 1 ]; do
  case "$1" in
    --asar) target=asar ;;
    --absent) want=absent ;;
    -F) flags+=(-F) ;;
  esac
  shift
done
[ -d "$APP" ] || { echo "no built app at $APP (run npm run build:desktop first)" >&2; exit 2; }
if [ "$target" = asar ]; then
  strings "$APP/Contents/Resources/app.asar" | grep "${flags[@]}" -e "$1"; found=$?
else
  bundle=$(find "$APP/Contents/Resources/app-dist" -name 'index-*.js' | head -1)
  grep "${flags[@]}" -e "$1" "$bundle"; found=$?
fi
if [ "$want" = present ]; then exit $found; else [ $found -ne 0 ]; fi
