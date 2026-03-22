/**
 * Web Worker - 扑克胜率蒙特卡洛模拟
 * 高性能优化版：整数编码 + 部分洗牌 + 零分配
 */
// @ts-check

// 导入依赖
importScripts('poker.js', 'simulator.js');

let wasmEnginePromise = null;

function getRandomSeed(workerId) {
    const timeSeed = Math.floor(Date.now() % 0x7fffffff);
    return ((workerId + 1) * 2654435761 + timeSeed) >>> 0;
}

async function loadWasmEngine() {
    if (typeof WebAssembly === 'undefined') return null;

    try {
        const wasmUrl = new URL('../wasm/montecarlo.wasm', self.location.href).toString();
        const response = await fetch(wasmUrl);
        if (!response.ok) {
            throw new Error(`WASM fetch failed: ${response.status}`);
        }

        let instance;
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                const streamingResult = await WebAssembly.instantiateStreaming(response, {});
                instance = streamingResult.instance;
            } catch (streamingError) {
                const fallbackResponse = await fetch(wasmUrl);
                const bytes = await fallbackResponse.arrayBuffer();
                const nonStreamingResult = await WebAssembly.instantiate(bytes, {});
                instance = nonStreamingResult.instance;
            }
        } else {
            const bytes = await response.arrayBuffer();
            const nonStreamingResult = await WebAssembly.instantiate(bytes, {});
            instance = nonStreamingResult.instance;
        }

        const exports = instance.exports;
        if (!exports || !exports.memory || !exports.alloc || !exports.reset_alloc || !exports.seed_rng || !exports.run_simulations_random) {
            return null;
        }

        return exports;
    } catch (error) {
        console.warn('WASM 引擎初始化失败，回退到 JS 模拟器:', error);
        return null;
    }
}

function getWasmEngine() {
    if (!wasmEnginePromise) {
        wasmEnginePromise = loadWasmEngine();
    }
    return wasmEnginePromise;
}

function runSimulationsWithWasm(
    myHandInt,
    communityInt,
    numOpponents,
    numSimulations,
    workerId = 0
) {
    return getWasmEngine().then((wasm) => {
        if (!wasm) return null;

        wasm.reset_alloc();
        wasm.seed_rng(getRandomSeed(workerId));

        const communityPtr = wasm.alloc(Math.max(communityInt.length, 1) * Int32Array.BYTES_PER_ELEMENT);
        const outputPtr = wasm.alloc(14 * Int32Array.BYTES_PER_ELEMENT);
        const memory = new Int32Array(wasm.memory.buffer);

        for (let i = 0; i < communityInt.length; i++) {
            memory[(communityPtr >> 2) + i] = communityInt[i];
        }

        const ok = wasm.run_simulations_random(
            myHandInt[0],
            myHandInt[1],
            communityPtr,
            communityInt.length,
            numOpponents,
            numSimulations,
            outputPtr
        );

        if (!ok) return null;

        const outIndex = outputPtr >> 2;
        const winUnits = memory[outIndex];
        const tieUnits = memory[outIndex + 1];
        const lossUnits = memory[outIndex + 2];
        const total = memory[outIndex + 3];
        const wins = winUnits / 1000;
        const ties = tieUnits / 1000;
        const losses = lossUnits / 1000;
        const handDistribution = {};

        for (let rank = 0; rank < 10; rank++) {
            const count = memory[outIndex + 4 + rank];
            handDistribution[rank] = {
                count,
                percentage: (count / total * 100).toFixed(1)
            };
        }

        return {
            engine: 'wasm',
            winRate: (wins / total * 100).toFixed(1),
            tieRate: (ties / total * 100).toFixed(1),
            loseRate: (losses / total * 100).toFixed(1),
            wins,
            ties,
            losses,
            total,
            handDistribution
        };
    });
}

self.onmessage = async function (e) {
    const {
        myHand,
        communityCards,
        numOpponents,
        numSimulations,
        opponentProfile,
        workerId = 0
    } = e.data;

    // 将对象牌转为整数编码
    const myHandInt = myHand.map(c => cardToInt(c));
    const communityInt = communityCards.map(c => cardToInt(c));
    const normalizedProfile = normalizeOpponentProfile(opponentProfile);

    let result = null;
    if (normalizedProfile === 'random') {
        result = await runSimulationsWithWasm(
            myHandInt,
            communityInt,
            numOpponents,
            numSimulations,
            workerId
        );
    }

    if (!result) {
        result = simulate(
            myHand,
            communityCards,
            numOpponents,
            numSimulations,
            {
                opponentProfile: normalizedProfile,
                onProgress: (completed, total) => {
                    self.postMessage({
                        type: 'PROGRESS',
                        workerId,
                        completed,
                        total
                    });
                }
            }
        );
        result.engine = 'js';
    }

    self.postMessage({
        type: 'DONE',
        workerId,
        completed: numSimulations,
        total: numSimulations,
        result
    });
};


