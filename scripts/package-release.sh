#!/usr/bin/env bash
# Build the double-clickable macOS app and DMG without starting a dev server.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE_ROOT="${TMPDIR:-/tmp}/denote-swift-cache"

# SwiftPM's compiler cache is outside the repository by default. Keep it in a writable temp
# directory for CI/sandboxed build environments; normal macOS shells may override these paths.
export SWIFT_MODULECACHE_PATH="${SWIFT_MODULECACHE_PATH:-$CACHE_ROOT/swift-module-cache}"
export CLANG_MODULE_CACHE_PATH="${CLANG_MODULE_CACHE_PATH:-$CACHE_ROOT/clang-module-cache}"
mkdir -p "$SWIFT_MODULECACHE_PATH" "$CLANG_MODULE_CACHE_PATH"

cd "$ROOT"
pnpm tauri build "$@"

echo
echo "Release artifacts:"
echo "  $ROOT/src-tauri/target/release/bundle/macos/DeNote.app"
echo "  $ROOT/src-tauri/target/release/bundle/dmg/DeNote_0.1.0_aarch64.dmg"
