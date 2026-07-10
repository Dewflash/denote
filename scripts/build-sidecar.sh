#!/usr/bin/env bash
# scripts/build-sidecar.sh — build the Apple Foundation Models sidecar (D11/S13) and stage it as a
# Tauri external binary. Tauri expects external binaries named `<name>-<target-triple>` and copies
# them next to the app executable at build/dev time; the Rust supervisor (src-tauri/src/sidecar.rs)
# then finds `apple-ai-sidecar` as a sibling of the running executable. Apple Silicon + macOS 26
# only (matches the app's hardware/OS floor).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR_DIR="$ROOT/sidecar/apple-ai"
OUT_DIR="$ROOT/src-tauri/binaries"

# Target triple Tauri will look for (e.g. aarch64-apple-darwin).
TRIPLE="$(rustc -Vv | sed -n 's/^host: //p')"

echo "[build-sidecar] swift build -c release ($TRIPLE)"
( cd "$SIDECAR_DIR" && swift build -c release )

BIN="$SIDECAR_DIR/.build/release/apple-ai-sidecar"
if [[ ! -x "$BIN" ]]; then
  echo "[build-sidecar] ERROR: expected product not found at $BIN" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
cp -f "$BIN" "$OUT_DIR/apple-ai-sidecar-$TRIPLE"
# Also drop the plain name so `DENOTE_SIDECAR_BIN=$OUT_DIR/apple-ai-sidecar` works in dev/tests.
cp -f "$BIN" "$OUT_DIR/apple-ai-sidecar"
echo "[build-sidecar] staged -> $OUT_DIR/apple-ai-sidecar-$TRIPLE"
