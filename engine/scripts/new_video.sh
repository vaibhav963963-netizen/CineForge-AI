#!/bin/bash
# Copy a style's hand-made example into the workspace projects folder (for hand-editing a style example).
#   bash new_video.sh <style> <short-name>      → <workspace>/projects/<short-name>/
#   bash new_video.sh --list                    the styles
# Normal production does not use this: the studio dashboard creates projects (projects/<id>/) and builds them from
# the storyboard. Projects are always created inside the workspace; there is no ~/faceless-shorts fallback.
set -eu
SKILL="$(cd "$(dirname "$0")/.." && pwd)"
if [ "${1:-}" = "--list" ]; then for d in "$SKILL"/styles/*/; do echo "$(basename "$d")"; done; exit 0; fi
USAGE="usage: new_video.sh <style> <short-name>   (styles: $(ls "$SKILL/styles" | tr '\n' ' '))"
STYLE="${1:?$USAGE}"; NAME="${2:?$USAGE}"
PARENT="$(cd "$SKILL/../projects" && pwd)"
SRC="$SKILL/styles/$STYLE/example"
[ -d "$SRC" ] || { echo "no style '$STYLE' ($USAGE)" >&2; exit 2; }
DST="$PARENT/$NAME"
[ -e "$DST" ] && { echo "$DST already exists: pick another name" >&2; exit 2; }
cp -R "$SRC" "$DST"; mkdir -p "$DST/renders" "$DST/review"
rm -f "$DST/data/narration.wav" "$DST/data/mix.wav"
echo "$DST"
