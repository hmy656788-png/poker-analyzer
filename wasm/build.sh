#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
LLVM_BIN="${LLVM_BIN:-/opt/homebrew/opt/llvm/bin}"
LLD_BIN="${LLD_BIN:-/opt/homebrew/opt/lld/bin}"
CLANG="$LLVM_BIN/clang"
WASM_LD="$LLD_BIN/wasm-ld"
SOURCE="$ROOT_DIR/wasm/montecarlo.c"
OUTPUT="$ROOT_DIR/wasm/montecarlo.wasm"

if [ ! -x "$CLANG" ]; then
    echo "missing clang at $CLANG" >&2
    exit 1
fi

if [ ! -x "$WASM_LD" ]; then
    echo "missing wasm-ld at $WASM_LD" >&2
    exit 1
fi

"$CLANG" \
    --target=wasm32-unknown-unknown \
    -O3 \
    -nostdlib \
    -Wl,--no-entry \
    -Wl,--strip-all \
    -Wl,--export-memory \
    -Wl,--export=alloc \
    -Wl,--export=reset_alloc \
    -Wl,--export=seed_rng \
    -Wl,--export=run_simulations_random \
    -Wl,--initial-memory=262144 \
    -Wl,--max-memory=262144 \
    -o "$OUTPUT" \
    "$SOURCE"

echo "built $OUTPUT"
