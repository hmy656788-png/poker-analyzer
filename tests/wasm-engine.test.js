const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('wasm monte carlo engine exports required functions and returns shaped output', async () => {
    const wasmPath = path.resolve(__dirname, '../wasm/montecarlo.wasm');
    const bytes = fs.readFileSync(wasmPath);
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const { memory, alloc, reset_alloc, seed_rng, run_simulations_random } = instance.exports;

    assert.ok(memory);
    assert.equal(typeof alloc, 'function');
    assert.equal(typeof reset_alloc, 'function');
    assert.equal(typeof seed_rng, 'function');
    assert.equal(typeof run_simulations_random, 'function');

    reset_alloc();
    seed_rng(42);

    const communityPtr = alloc(Int32Array.BYTES_PER_ELEMENT);
    const outputPtr = alloc(14 * Int32Array.BYTES_PER_ELEMENT);
    const memoryView = new Int32Array(memory.buffer);

    const ok = run_simulations_random(
        48,
        49,
        communityPtr,
        0,
        1,
        200,
        outputPtr
    );

    assert.equal(ok, 1);

    const base = outputPtr >> 2;
    const total = memoryView[base + 3];
    const handDistributionTotal = Array.from({ length: 10 }, (_, rank) => memoryView[base + 4 + rank])
        .reduce((sum, count) => sum + count, 0);

    assert.equal(total, 200);
    assert.equal(handDistributionTotal, 200);
    assert.ok(memoryView[base] > 0);
});
