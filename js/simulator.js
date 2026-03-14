/**
 * Monte Carlo 胜率模拟器
 * 通过随机模拟来估算德州扑克各阶段的胜率
 */

// 模拟次数常量
const SIMULATION_QUICK = 5000;
const SIMULATION_PRECISE = 20000;
const SIMULATION_DEFAULT = 10000;

/**
 * 优化20: 根据阶段智能调整模拟次数
 * @param {number} communityCardsCount - 公共牌数量
 * @param {number} numOpponents - 对手数量
 * @returns {number} 推荐的模拟次数
 */
function getSmartSimulationCount(communityCardsCount, numOpponents) {
    // 翻前：变化空间大，但组合相对固定，5000次足够
    if (communityCardsCount === 0) {
        return 5000;
    }
    // 翻牌：3张公共牌，还有很多变数，10000次
    else if (communityCardsCount === 3) {
        return 10000 + numOpponents * 1000;
    }
    // 转牌：4张公共牌，变数减少，15000次
    else if (communityCardsCount === 4) {
        return 15000 + numOpponents * 1500;
    }
    // 河牌：5张公共牌，结果确定，需要更精确，30000次
    else if (communityCardsCount === 5) {
        return 25000 + numOpponents * 2000;
    }
    return SIMULATION_DEFAULT;
}

/**
 * 运行 Monte Carlo 模拟
 * @param {Array} myHand - 我的手牌 (2张)
 * @param {Array} communityCards - 已知的公共牌 (0-5张)
 * @param {number} numOpponents - 对手数量 (1-6)
 * @param {number} numSimulations - 模拟次数
 * @returns {object} { winRate, tieRate, loseRate, handDistribution, bestHandName }
 */
function simulate(myHand, communityCards, numOpponents, numSimulations = SIMULATION_DEFAULT) {
    let wins = 0;
    let ties = 0;
    let losses = 0;
    const handDistribution = {};

    // 初始化手牌分布统计
    Object.keys(HAND_NAMES).forEach(k => {
        handDistribution[k] = 0;
    });

    const knownCards = [...myHand, ...communityCards];
    const remainingDeck = removeCards(createDeck(), knownCards);
    const communityNeeded = 5 - communityCards.length;

    // 优化1: 预分配数组池，减少 GC 压力
    const deckSize = remainingDeck.length;
    const shuffledPool = new Array(deckSize);

    for (let sim = 0; sim < numSimulations; sim++) {
        // 优化1: 使用预分配的数组进行洗牌
        for (let i = 0; i < deckSize; i++) {
            shuffledPool[i] = remainingDeck[i];
        }
        // Fisher-Yates 洗牌（内联优化）
        for (let i = deckSize - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const temp = shuffledPool[i];
            shuffledPool[i] = shuffledPool[j];
            shuffledPool[j] = temp;
        }

        let drawIndex = 0;

        // 补充公共牌
        const fullCommunity = [...communityCards];
        for (let i = 0; i < communityNeeded; i++) {
            fullCommunity.push(shuffledPool[drawIndex++]);
        }

        // 评估我的手牌
        const myFullHand = [...myHand, ...fullCommunity];
        const myEval = getBestHand(myFullHand);
        handDistribution[myEval.handRank]++;

        // 评估所有对手的手牌
        let myResult = 'win'; // 假设赢，遇到更好或相同的降级
        let tieCount = 0; // 优化2: 追踪平局数量

        for (let opp = 0; opp < numOpponents; opp++) {
            const oppHand = [shuffledPool[drawIndex++], shuffledPool[drawIndex++]];
            const oppFullHand = [...oppHand, ...fullCommunity];
            const oppEval = getBestHand(oppFullHand);

            const comparison = compareEvaluations(myEval, oppEval);
            if (comparison < 0) {
                myResult = 'lose';
                break;  // 已经输了，不需要继续比较
            } else if (comparison === 0) {
                tieCount++;
                if (myResult === 'win') myResult = 'tie';
            }
        }

        if (myResult === 'win') {
            wins++;
        } else if (myResult === 'tie') {
            // 按分池权重计算：我分到的部分算入胜率(Equity)，其余部分算入平局权重
            const myShare = 1 / (tieCount + 1);
            wins += myShare;
            ties += (1 - myShare);
        } else {
            losses++;
        }
    }

    // 计算百分比
    const total = numSimulations;
    const result = {
        winRate: (wins / total * 100).toFixed(1),
        tieRate: (ties / total * 100).toFixed(1),
        loseRate: (losses / total * 100).toFixed(1),
        wins,
        ties,
        losses,
        total,
        handDistribution: {}
    };

    // 转换手牌分布为百分比
    Object.entries(handDistribution).forEach(([rank, count]) => {
        result.handDistribution[rank] = {
            count,
            percentage: (count / total * 100).toFixed(1)
        };
    });

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
function getAdvice(winRate) {
    const rate = parseFloat(winRate);
    if (rate >= 70) return { text: '极强牌力，可以加注', level: 'excellent', emoji: '🔥' };
    if (rate >= 55) return { text: '强牌力，适合跟注或加注', level: 'good', emoji: '💪' };
    if (rate >= 45) return { text: '中等牌力，可以跟注', level: 'medium', emoji: '🤔' };
    if (rate >= 35) return { text: '较弱牌力，谨慎跟注', level: 'weak', emoji: '⚠️' };
    return { text: '弱牌力，建议弃牌', level: 'bad', emoji: '🚫' };
}
