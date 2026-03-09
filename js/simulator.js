/**
 * Monte Carlo 胜率模拟器
 * 通过随机模拟来估算德州扑克各阶段的胜率
 */

/**
 * 运行 Monte Carlo 模拟
 * @param {Array} myHand - 我的手牌 (2张)
 * @param {Array} communityCards - 已知的公共牌 (0-5张)
 * @param {number} numOpponents - 对手数量 (1-6)
 * @param {number} numSimulations - 模拟次数
 * @returns {object} { winRate, tieRate, loseRate, handDistribution, bestHandName }
 */
function simulate(myHand, communityCards, numOpponents, numSimulations = 10000) {
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

    for (let sim = 0; sim < numSimulations; sim++) {
        const shuffled = shuffleDeck(remainingDeck);
        let drawIndex = 0;

        // 补充公共牌
        const fullCommunity = [...communityCards];
        for (let i = 0; i < communityNeeded; i++) {
            fullCommunity.push(shuffled[drawIndex++]);
        }

        // 评估我的手牌
        const myFullHand = [...myHand, ...fullCommunity];
        const myEval = getBestHand(myFullHand);
        handDistribution[myEval.handRank]++;

        // 评估所有对手的手牌
        let myResult = 'win'; // 假设赢，遇到更好或相同的降级

        for (let opp = 0; opp < numOpponents; opp++) {
            const oppHand = [shuffled[drawIndex++], shuffled[drawIndex++]];
            const oppFullHand = [...oppHand, ...fullCommunity];
            const oppEval = getBestHand(oppFullHand);

            const comparison = compareEvaluations(myEval, oppEval);
            if (comparison < 0) {
                myResult = 'lose';
                break;  // 已经输了，不需要继续比较
            } else if (comparison === 0) {
                if (myResult === 'win') myResult = 'tie';
            }
        }

        if (myResult === 'win') wins++;
        else if (myResult === 'tie') ties++;
        else losses++;
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
    return simulate(myHand, communityCards, numOpponents, 5000);
}

/**
 * 精确模拟 - 用于最终结果
 */
function preciseSimulate(myHand, communityCards, numOpponents) {
    return simulate(myHand, communityCards, numOpponents, 20000);
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
