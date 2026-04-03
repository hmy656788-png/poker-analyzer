/**
 * Monte Carlo 胜率模拟器
 * 通过随机模拟来估算德州扑克各阶段的胜率
 */
// @ts-check

// 模拟次数常量
const SIMULATION_QUICK = 5000;
const SIMULATION_PRECISE = 20000;
const SIMULATION_DEFAULT = 10000;
const ANALYSIS_CACHE_VERSION = '20260402';
const ANALYSIS_CACHE_BASE = '/__analysis_cache__';
const ANALYSIS_CACHE_ENTRY_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const PREFLOP_PRECOMPUTE_SIMULATIONS = 18000;
const DEFAULT_PREFLOP_PRECOMPUTE_TARGETS = [
    { handKey: 'AA', numOpponents: 1, opponentProfile: 'random' },
    { handKey: 'KK', numOpponents: 1, opponentProfile: 'random' },
    { handKey: 'QQ', numOpponents: 1, opponentProfile: 'random' },
    { handKey: 'AKs', numOpponents: 1, opponentProfile: 'random' },
    { handKey: 'AQs', numOpponents: 1, opponentProfile: 'random' },
    { handKey: 'AKo', numOpponents: 1, opponentProfile: 'random' },
];

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function normalizeAnalysisCacheCards(cards) {
    return Array.isArray(cards) ? cards.filter(Boolean) : [];
}

function isPreflopCacheEligible(myHand, communityCards) {
    return normalizeAnalysisCacheCards(myHand).length === 2
        && normalizeAnalysisCacheCards(communityCards).length === 0;
}

function buildAnalysisCacheUrl(myHand, communityCards, numOpponents, opponentProfile = 'random') {
    if (!isPreflopCacheEligible(myHand, communityCards)) {
        return '';
    }

    const normalizedProfile = normalizeOpponentProfile(opponentProfile);
    const hand = normalizeAnalysisCacheCards(myHand);
    const handKey = getStartingHandKey(hand[0], hand[1]);
    const params = new URLSearchParams({
        opponents: String(Math.max(1, Number(numOpponents) || 1)),
        profile: normalizedProfile
    });

    return `${ANALYSIS_CACHE_BASE}/${ANALYSIS_CACHE_VERSION}/${handKey}.json?${params.toString()}`;
}

function createAnalysisCacheEntry(entry) {
    const cachedAtMs = Number.isFinite(Date.parse(entry && entry.cachedAt ? entry.cachedAt : ''))
        ? Date.parse(entry.cachedAt)
        : Date.now();

    return {
        ...entry,
        cacheVersion: ANALYSIS_CACHE_VERSION,
        cachedAt: new Date(cachedAtMs).toISOString(),
        expiresAt: new Date(cachedAtMs + ANALYSIS_CACHE_ENTRY_TTL_MS).toISOString()
    };
}

function isAnalysisCacheEntryValid(entry) {
    if (!entry || !entry.result) return false;
    if (entry.cacheVersion !== ANALYSIS_CACHE_VERSION) return false;

    const expiresAtMs = Date.parse(entry.expiresAt || '');
    if (Number.isFinite(expiresAtMs)) {
        return expiresAtMs > Date.now();
    }

    const cachedAtMs = Date.parse(entry.cachedAt || '');
    if (!Number.isFinite(cachedAtMs)) {
        return false;
    }

    return (Date.now() - cachedAtMs) <= ANALYSIS_CACHE_ENTRY_TTL_MS;
}

function parseStartingHandKey(handKey) {
    const key = String(handKey || '').trim().toUpperCase();
    if (!/^[2-9TJQKA]{2}[SO]?$/.test(key)) {
        return null;
    }

    const firstRank = RANK_KEY_NAMES.indexOf(key[0]);
    const secondRank = RANK_KEY_NAMES.indexOf(key[1]);
    if (firstRank === -1 || secondRank === -1) {
        return null;
    }

    const suitedToken = key[2] || '';
    return {
        handKey: key,
        firstRank,
        secondRank,
        isPair: firstRank === secondRank,
        isSuited: suitedToken === 'S',
        isOffsuit: suitedToken === 'O'
    };
}

function createRepresentativeHandForKey(handKey) {
    const parsed = parseStartingHandKey(handKey);
    if (!parsed) return [];

    const { firstRank, secondRank, isPair, isSuited } = parsed;
    if (isPair) {
        return [createCard(firstRank, 0), createCard(secondRank, 1)];
    }

    return [
        createCard(firstRank, 0),
        createCard(secondRank, isSuited ? 0 : 1)
    ];
}

let _cachedDeviceProfile = null;

function detectDeviceProfile() {
    if (_cachedDeviceProfile) return _cachedDeviceProfile;

    if (typeof navigator === 'undefined') {
        _cachedDeviceProfile = {
            isMobile: false,
            cores: 4,
            memory: 4,
            saveData: false,
            multiplier: 1,
            tier: 'mid'
        };
        return _cachedDeviceProfile;
    }

    const cores = Math.max(1, Number(navigator.hardwareConcurrency) || 4);
    const memory = Math.max(1, Number(navigator.deviceMemory) || 4);
    const ua = navigator.userAgent || '';
    const isMobile = /Mobi|Android|iPhone|iPad|HarmonyOS/i.test(ua);
    const saveData = !!(navigator.connection && navigator.connection.saveData);

    let multiplier = 1;
    let tier = 'mid';

    if (isMobile) {
        multiplier *= 0.95;
        tier = 'mobile';
    }

    if (cores <= 2 || memory <= 2) {
        multiplier *= 0.75;
        tier = 'low';
    } else if (cores >= 12 && memory >= 16 && !isMobile) {
        multiplier *= 1.4;
        tier = 'ultra';
    } else if (cores >= 8 && memory >= 8 && !isMobile) {
        multiplier *= 1.28;
        tier = 'high';
    }

    if (saveData) {
        multiplier *= 0.88;
    }

    // 高性能手机可额外提升模拟量
    if (isMobile && cores >= 6 && memory >= 6 && tier !== 'low') {
        multiplier *= 1.12;
    }

    _cachedDeviceProfile = {
        isMobile,
        cores,
        memory,
        saveData,
        tier,
        multiplier: clamp(multiplier, 0.5, 1.5)
    };
    return _cachedDeviceProfile;
}

function getBaseSimulationCount(communityCardsCount, numOpponents) {
    const opponentsFactor = Math.max(1, Number(numOpponents) || 1);

    if (communityCardsCount === 0) {
        return 9000 + opponentsFactor * 1100;
    }
    if (communityCardsCount === 3) {
        return 14000 + opponentsFactor * 1800;
    }
    if (communityCardsCount === 4) {
        return 19000 + opponentsFactor * 2200;
    }
    if (communityCardsCount === 5) {
        return 25000 + opponentsFactor * 2600;
    }
    return SIMULATION_DEFAULT + opponentsFactor * 1000;
}

/**
 * 根据牌局阶段 + 对手数 + 设备性能自适应模拟次数
 * @param {number} communityCardsCount - 公共牌数量
 * @param {number} numOpponents - 对手数量
 * @param {number} runtimeScale - 运行时动态倍率
 * @returns {number} 推荐模拟次数
 */
function getSmartSimulationCount(communityCardsCount, numOpponents, runtimeScale = 1) {
    const base = getBaseSimulationCount(communityCardsCount, numOpponents);
    const profile = detectDeviceProfile();
    const dynamicScale = clamp(Number(runtimeScale) || 1, 0.75, 1.25);

    let scaled = Math.round(base * profile.multiplier * dynamicScale);

    // 8 人对战场景在非低端机上额外提高精度
    if (numOpponents >= 7 && profile.tier !== 'low') {
        scaled = Math.round(scaled * 1.10);
    }

    const minCount = profile.isMobile ? 8000 : 7000;
    const maxCount = profile.isMobile ? 52000 : 90000;
    return clamp(scaled, minCount, maxCount);
}

/**
 * 根据本轮耗时更新下一轮自适应倍率状态
 * @param {number} currentScale
 * @param {number} fastRunStreak
 * @param {number} analysisDurationMs
 * @returns {{ scale: number, fastRunStreak: number }}
 */
function getNextRuntimeAdaptiveState(currentScale, fastRunStreak, analysisDurationMs) {
    const duration = Math.max(0, Number(analysisDurationMs) || 0);
    let nextScale = clamp(Number(currentScale) || 1, 0.75, 1.25);
    let nextFastRunStreak = Math.max(0, Number(fastRunStreak) || 0);

    if (duration > 2800) {
        return {
            scale: clamp(nextScale * 0.88, 0.75, 1.25),
            fastRunStreak: 0
        };
    }

    if (duration < 1800) {
        nextFastRunStreak += 1;
        if (nextFastRunStreak >= 2) {
            nextScale = clamp(nextScale * 1.06, 0.75, 1.25);
            nextFastRunStreak = 0;
        }
        return {
            scale: nextScale,
            fastRunStreak: nextFastRunStreak
        };
    }

    return {
        scale: nextScale,
        fastRunStreak: 0
    };
}

function takeRandomHandFromAvailable(availableCards) {
    const firstIndex = Math.floor(Math.random() * availableCards.length);
    let secondIndex = Math.floor(Math.random() * (availableCards.length - 1));

    if (secondIndex >= firstIndex) secondIndex++;

    return removeHandAtIndices(availableCards, firstIndex, secondIndex);
}

function removeHandAtIndices(availableCards, firstIndex, secondIndex) {
    let low = firstIndex;
    let high = secondIndex;

    if (low > high) {
        low = secondIndex;
        high = firstIndex;
    }

    const hand = [availableCards[low], availableCards[high]];
    availableCards.splice(high, 1);
    availableCards.splice(low, 1);
    return hand;
}

const OPPONENT_RANGE_COMBO_CACHE = new Map();

function getOpponentRangeCombos(opponentProfile = 'random') {
    const normalizedProfile = normalizeOpponentProfile(opponentProfile);
    if (normalizedProfile === 'random') {
        return null;
    }

    if (OPPONENT_RANGE_COMBO_CACHE.has(normalizedProfile)) {
        return OPPONENT_RANGE_COMBO_CACHE.get(normalizedProfile);
    }

    const rangeSet = getOpponentRangeSet(normalizedProfile);
    if (!rangeSet) {
        OPPONENT_RANGE_COMBO_CACHE.set(normalizedProfile, null);
        return null;
    }

    const deck = createDeck();
    const combos = [];

    for (let i = 0; i < deck.length - 1; i++) {
        for (let j = i + 1; j < deck.length; j++) {
            if (!rangeSet.has(getStartingHandKey(deck[i], deck[j]))) continue;
            combos.push([cardToInt(deck[i]), cardToInt(deck[j])]);
        }
    }

    OPPONENT_RANGE_COMBO_CACHE.set(normalizedProfile, combos);
    return combos;
}

function drawOpponentHandFromRange(availableCards, opponentProfile = 'random') {
    const rangeSet = getOpponentRangeSet(opponentProfile);

    if (!rangeSet || availableCards.length <= 2) {
        return takeRandomHandFromAvailable(availableCards);
    }

    const rangeCombos = getOpponentRangeCombos(opponentProfile);
    if (rangeCombos && rangeCombos.length > 0) {
        const availableIndexByCardInt = new Map();
        for (let index = 0; index < availableCards.length; index++) {
            availableIndexByCardInt.set(cardToInt(availableCards[index]), index);
        }

        const matchedPairs = [];
        for (let comboIndex = 0; comboIndex < rangeCombos.length; comboIndex++) {
            const [firstCard, secondCard] = rangeCombos[comboIndex];
            if (!availableIndexByCardInt.has(firstCard) || !availableIndexByCardInt.has(secondCard)) {
                continue;
            }
            matchedPairs.push([
                availableIndexByCardInt.get(firstCard),
                availableIndexByCardInt.get(secondCard)
            ]);
        }

        if (matchedPairs.length > 0) {
            const pair = matchedPairs[Math.floor(Math.random() * matchedPairs.length)];
            return removeHandAtIndices(availableCards, pair[0], pair[1]);
        }
    }

    return takeRandomHandFromAvailable(availableCards);
}

function calculateDecisionMetrics(winRate, potSize, callAmount) {
    const equity = Math.max(0, Math.min(1, parseFloat(winRate) / 100));
    const pot = Math.max(0, Number(potSize) || 0);
    const call = Math.max(0, Number(callAmount) || 0);
    const finalPot = pot + call;
    const requiredEquity = (call > 0 && finalPot > 0) ? (call / finalPot) : 0;
    const callEV = call > 0 ? (equity * finalPot) - call : equity * pot;
    const edge = equity - requiredEquity;

    let action = '继续观察';
    let level = 'medium';
    let note = '当前没有明确的跟注成本，建议结合位置和牌面主动性决定下注还是控池。';

    if (call === 0) {
        if (equity >= 0.65) {
            action = '偏向主动下注';
            level = 'excellent';
            note = '你的牌力已经足够领先，主动下注通常能从更差牌中拿到价值。';
        } else if (equity >= 0.5) {
            action = '可小注拿价值';
            level = 'good';
            note = '牌力略优于场均，对宽范围对手可以尝试延续下注。';
        } else if (equity >= 0.35) {
            action = '偏向过牌控池';
            level = 'medium';
            note = '牌力中等，过牌保留范围并控制底池规模会更稳。';
        } else {
            action = '谨慎继续';
            level = 'weak';
            note = '当前没有免费价值，建议少投入筹码，等待更好转机。';
        }
    } else if (callEV >= 3 || edge >= 0.08) {
        action = '盈利跟注，可考虑加注';
        level = 'excellent';
        note = '你的胜率明显高于底池赔率门槛，这个跟注在简化模型下非常赚钱。';
    } else if (callEV > 0 || edge >= 0.02) {
        action = '可以跟注';
        level = 'good';
        note = '你的胜率已经覆盖所需门槛，跟注为正 EV，但优势还没有大到必须做大底池。';
    } else if (callEV > -1 || edge >= -0.02) {
        action = '接近临界，读牌决定';
        level = 'medium';
        note = '这是一个很薄的决定，位置优势、对手激进频率和后手深度会明显影响结果。';
    } else {
        action = '偏向弃牌';
        level = 'bad';
        note = '当前胜率不足以支撑跟注成本，除非你有额外读牌信息，否则投入不划算。';
    }

    return {
        equity,
        pot,
        call,
        finalPot,
        requiredEquity,
        callEV,
        edge,
        action,
        level,
        note,
        potOddsPct: (requiredEquity * 100).toFixed(1),
        requiredEquityPct: (requiredEquity * 100).toFixed(1),
        callEVBB: callEV.toFixed(1),
        finalPotBB: finalPot.toFixed(1)
    };
}

/**
 * 运行 Monte Carlo 模拟（优化版）
 * 使用整数编码 + 部分洗牌 + 零分配
 * @param {Array} myHand - 我的手牌 (2张, 对象格式)
 * @param {Array} communityCards - 已知的公共牌 (0-5张, 对象格式)
 * @param {number} numOpponents - 对手数量 (1-8)
 * @param {number} numSimulations - 模拟次数
 * @param {{ opponentProfile?: string, onProgress?: (completed: number, total: number) => void }} options - 额外参数
 * @returns {{ winRate: string, tieRate: string, loseRate: string, wins: number, ties: number, losses: number, total: number, handDistribution: Record<string, any>, engine?: string }}
 */
function simulate(myHand, communityCards, numOpponents, numSimulations = SIMULATION_DEFAULT, options = {}) {
    // 转为整数编码
    const myHandInt = myHand.map(c => cardToInt(c));
    const communityInt = communityCards.map(c => cardToInt(c));

    let wins = 0;
    let ties = 0;
    let losses = 0;
    const handDistribution = new Int32Array(10);
    const opponentProfile = normalizeOpponentProfile(options.opponentProfile || 'random');
    const rangeSet = getOpponentRangeSet(opponentProfile);

    const knownInts = [...myHandInt, ...communityInt];
    const remainingDeck = removeIntCards(createIntDeck(), knownInts);
    const deckSize = remainingDeck.length;
    const communityNeeded = 5 - communityInt.length;
    const cardsNeeded = communityNeeded + numOpponents * 2;

    // 预分配工作数组
    const deck = new Array(deckSize);
    const fullCommunity = new Array(5);
    const myFullHand = new Array(7);
    const oppFullHand = new Array(7);

    myFullHand[0] = myHandInt[0];
    myFullHand[1] = myHandInt[1];
    for (let i = 0; i < communityInt.length; i++) {
        fullCommunity[i] = communityInt[i];
        myFullHand[2 + i] = communityInt[i];
    }

    for (let sim = 0; sim < numSimulations; sim++) {
        for (let i = 0; i < deckSize; i++) deck[i] = remainingDeck[i];

        // 部分 Fisher-Yates 洗牌
        const shuffleEnd = Math.min(cardsNeeded, deckSize);
        for (let i = 0; i < shuffleEnd; i++) {
            const j = i + Math.floor(Math.random() * (deckSize - i));
            const temp = deck[i]; deck[i] = deck[j]; deck[j] = temp;
        }

        let drawIndex = 0;

        for (let i = 0; i < communityNeeded; i++) {
            const card = deck[drawIndex++];
            fullCommunity[communityInt.length + i] = card;
            myFullHand[2 + communityInt.length + i] = card;
        }

        const myEval = getBestHandFast(myFullHand, 7);
        handDistribution[myEval >> 20]++;

        let myResult = 0;
        let tieCount = 0;

        for (let opp = 0; opp < numOpponents; opp++) {
            let oppCard0, oppCard1;

            if (!rangeSet) {
                oppCard0 = deck[drawIndex++];
                oppCard1 = deck[drawIndex++];
            } else {
                let found = false;
                for (let attempt = 0; attempt < 15; attempt++) {
                    const idx0 = drawIndex + Math.floor(Math.random() * (deckSize - drawIndex));
                    let idx1 = drawIndex + Math.floor(Math.random() * (deckSize - drawIndex - 1));
                    if (idx1 >= idx0) idx1++;

                    const c0 = deck[idx0], c1 = deck[idx1];
                    const key = getStartingHandKeyFromInt(c0, c1);
                    if (rangeSet.has(key)) {
                        deck[idx0] = deck[drawIndex]; deck[drawIndex] = c0; oppCard0 = c0; drawIndex++;
                        if (idx1 === drawIndex - 1) {
                            deck[idx0] = deck[drawIndex]; deck[drawIndex] = c1;
                        } else {
                            deck[idx1] = deck[drawIndex]; deck[drawIndex] = c1;
                        }
                        oppCard1 = c1; drawIndex++;
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    let fallbackFound = false;
                    for (let i = drawIndex; i < deckSize - 1 && !fallbackFound; i++) {
                        for (let j = i + 1; j < deckSize; j++) {
                            const key = getStartingHandKeyFromInt(deck[i], deck[j]);
                            if (rangeSet.has(key)) {
                                const c0 = deck[i]; deck[i] = deck[drawIndex]; deck[drawIndex] = c0; oppCard0 = c0; drawIndex++;
                                const c1 = deck[j]; deck[j] = deck[drawIndex]; deck[drawIndex] = c1; oppCard1 = c1; drawIndex++;
                                fallbackFound = true; break;
                            }
                        }
                    }
                    if (!fallbackFound) { oppCard0 = deck[drawIndex++]; oppCard1 = deck[drawIndex++]; }
                }
            }

            oppFullHand[0] = oppCard0;
            oppFullHand[1] = oppCard1;
            for (let k = 0; k < 5; k++) oppFullHand[2 + k] = fullCommunity[k];

            const oppEval = getBestHandFast(oppFullHand, 7);

            if (myEval < oppEval) { myResult = 2; break; }
            else if (myEval === oppEval) { tieCount++; if (myResult === 0) myResult = 1; }
        }

        if (myResult === 0) { wins++; }
        else if (myResult === 1) {
            const myShare = 1 / (tieCount + 1);
            wins += myShare;
            ties += (1 - myShare);
        } else { losses++; }

        if (options.onProgress && sim % Math.max(300, Math.floor(numSimulations / 24)) === 0 && sim > 0) {
            options.onProgress(sim + 1, numSimulations);
        }
    }

    const total = numSimulations;
    const result = {
        winRate: (wins / total * 100).toFixed(1),
        tieRate: (ties / total * 100).toFixed(1),
        loseRate: (losses / total * 100).toFixed(1),
        wins, ties, losses, total,
        handDistribution: {}
    };

    for (let rank = 0; rank < 10; rank++) {
        result.handDistribution[rank] = {
            count: handDistribution[rank],
            percentage: (handDistribution[rank] / total * 100).toFixed(1)
        };
    }

    return result;
}

/**
 * 快速模拟 - 用于实时预览，较少的模拟次数
 */
function quickSimulate(myHand, communityCards, numOpponents) {
    return simulate(myHand, communityCards, numOpponents, SIMULATION_QUICK);
}

/**
 * 精确模拟 - 用于最终结果
 */
function preciseSimulate(myHand, communityCards, numOpponents) {
    return simulate(myHand, communityCards, numOpponents, SIMULATION_PRECISE);
}

/**
 * 评估当前手牌的最佳牌型（如果有足够的牌）
 * 优化版：统一使用 getBestHand 处理 5-7 张牌
 */
function evaluateCurrentHand(myHand, communityCards) {
    const totalCards = [...myHand, ...communityCards];
    if (totalCards.length < 5) return null;

    const best = getBestHand(totalCards);
    return {
        handRank: best.handRank,
        handName: HAND_NAMES[best.handRank],
        handNameEn: HAND_NAMES_EN[best.handRank]
    };
}

/**
 * 获取出牌建议（简单版）
 */
function getAdvice(winRate, decisionMetrics = null) {
    const rate = parseFloat(winRate);
    if (decisionMetrics) {
        const emojiByLevel = {
            excellent: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>',
            good: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>',
            medium: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
            weak: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
            bad: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
        };

        return {
            text: `${decisionMetrics.action} · ${decisionMetrics.note}`,
            level: decisionMetrics.level,
            emoji: emojiByLevel[decisionMetrics.level] || '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
        };
    }

    if (rate >= 70) return { text: '极强牌力，可以加注', level: 'excellent', emoji: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>' };
    if (rate >= 55) return { text: '强牌力，适合跟注或加注', level: 'good', emoji: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>' };
    if (rate >= 45) return { text: '中等牌力，可以跟注', level: 'medium', emoji: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>' };
    if (rate >= 35) return { text: '较弱牌力，谨慎跟注', level: 'weak', emoji: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' };
    return { text: '弱牌力，建议弃牌', level: 'bad', emoji: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ANALYSIS_CACHE_VERSION,
        ANALYSIS_CACHE_ENTRY_TTL_MS,
        PREFLOP_PRECOMPUTE_SIMULATIONS,
        DEFAULT_PREFLOP_PRECOMPUTE_TARGETS,
        clamp,
        detectDeviceProfile,
        getBaseSimulationCount,
        getSmartSimulationCount,
        getNextRuntimeAdaptiveState,
        buildAnalysisCacheUrl,
        createAnalysisCacheEntry,
        isAnalysisCacheEntryValid,
        isPreflopCacheEligible,
        parseStartingHandKey,
        createRepresentativeHandForKey,
        calculateDecisionMetrics,
        simulate,
        quickSimulate,
        preciseSimulate,
        evaluateCurrentHand,
        getAdvice
    };
}
