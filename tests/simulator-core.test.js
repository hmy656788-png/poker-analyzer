const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSimulator(overrides = {}) {
    const pokerCode = fs.readFileSync(path.resolve(__dirname, '../js/poker.js'), 'utf8');
    const simulatorCode = fs.readFileSync(path.resolve(__dirname, '../js/simulator.js'), 'utf8');
    const context = {
        console,
        Math,
        URLSearchParams,
        navigator: {
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
            hardwareConcurrency: 4,
            deviceMemory: 4,
            connection: { saveData: false },
            ...overrides,
        },
        setTimeout,
        clearTimeout,
    };

    vm.createContext(context);
    vm.runInContext(pokerCode, context);
    vm.runInContext(simulatorCode, context);
    return context;
}

test('mobile simulation count respects min/max bounds with runtime scale', () => {
    const simulator = loadSimulator();

    const lowerBound = simulator.getSmartSimulationCount(0, 1, 0.1);
    const upperBound = simulator.getSmartSimulationCount(5, 8, 9);

    assert.equal(lowerBound, 8000);
    assert.equal(upperBound, 52000);
});

test('high-end mobile devices receive extra simulation multiplier', () => {
    const baseline = loadSimulator({
        hardwareConcurrency: 4,
        deviceMemory: 4,
    });
    const highEnd = loadSimulator({
        hardwareConcurrency: 8,
        deviceMemory: 8,
    });

    const baselineCount = baseline.getSmartSimulationCount(3, 4, 1);
    const highEndCount = highEnd.getSmartSimulationCount(3, 4, 1);

    assert.ok(highEndCount > baselineCount);
});

test('8-player boost does not apply on low-tier devices', () => {
    const lowTier = loadSimulator({
        hardwareConcurrency: 2,
        deviceMemory: 2,
    });

    const count = lowTier.getSmartSimulationCount(5, 7, 1);
    assert.equal(count, 30780);
});

test('runtime adaptive state reduces load after slow run', () => {
    const simulator = loadSimulator();
    const next = simulator.getNextRuntimeAdaptiveState(1, 1, 3000);

    assert.equal(next.fastRunStreak, 0);
    assert.equal(next.scale, 0.88);
});

test('runtime adaptive state increases load after two fast runs', () => {
    const simulator = loadSimulator();

    const first = simulator.getNextRuntimeAdaptiveState(1, 0, 1500);
    const second = simulator.getNextRuntimeAdaptiveState(first.scale, first.fastRunStreak, 1600);

    assert.equal(first.fastRunStreak, 1);
    assert.equal(first.scale, 1);
    assert.equal(second.fastRunStreak, 0);
    assert.equal(second.scale, 1.06);
});

test('analysis cache url is stable for equivalent preflop hands', () => {
    const simulator = loadSimulator();
    const handA = [simulator.createCard(12, 0), simulator.createCard(11, 0)];
    const handB = [simulator.createCard(11, 0), simulator.createCard(12, 0)];

    assert.equal(
        simulator.buildAnalysisCacheUrl(handA, [], 3, 'random'),
        simulator.buildAnalysisCacheUrl(handB, [], 3, 'random')
    );
});

test('representative hand parsing preserves suitedness and pairs', () => {
    const simulator = loadSimulator();
    const suited = simulator.createRepresentativeHandForKey('AKs');
    const pair = simulator.createRepresentativeHandForKey('QQ');

    assert.equal(simulator.getStartingHandKey(suited[0], suited[1]), 'AKs');
    assert.equal(simulator.getStartingHandKey(pair[0], pair[1]), 'QQ');
});
