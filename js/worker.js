/**
 * Web Worker - 扑克胜率蒙特卡洛模拟
 * 用于在后台线程执行重度计算，防止阻塞 UI
 */

// 导入依赖
importScripts('poker.js', 'simulator.js');

self.onmessage = function (e) {
    const { myHand, communityCards, numOpponents, numSimulations } = e.data;

    // 定制版的模拟函数：带进度推送
    const result = runSimulationsWithProgress(myHand, communityCards, numOpponents, numSimulations);

    // 完成后发送最终结果
    self.postMessage({ type: 'DONE', result });
};

function runSimulationsWithProgress(myHand, communityCards, numOpponents, numSimulations) {
    let wins = 0;
    let ties = 0;
    let losses = 0;
    const handDistribution = {};

    Object.keys(HAND_NAMES).forEach(k => {
        handDistribution[k] = 0;
    });

    const knownCards = [...myHand, ...communityCards];
    const remainingDeck = removeCards(createDeck(), knownCards);
    const communityNeeded = 5 - communityCards.length;

    // 每完成这么多批次汇报一次进度给前端 UI
    const progressBatchSize = Math.max(1000, Math.floor(numSimulations / 20));

    for (let sim = 0; sim < numSimulations; sim++) {
        const shuffled = shuffleDeck(remainingDeck);
        let drawIndex = 0;

        const fullCommunity = [...communityCards];
        for (let i = 0; i < communityNeeded; i++) {
            fullCommunity.push(shuffled[drawIndex++]);
        }

        const myFullHand = [...myHand, ...fullCommunity];
        const myEval = getBestHand(myFullHand);
        handDistribution[myEval.handRank]++;

        let myResult = 'win';

        for (let opp = 0; opp < numOpponents; opp++) {
            const oppHand = [shuffled[drawIndex++], shuffled[drawIndex++]];
            const oppFullHand = [...oppHand, ...fullCommunity];
            const oppEval = getBestHand(oppFullHand);

            const comparison = compareEvaluations(myEval, oppEval);
            if (comparison < 0) {
                myResult = 'lose';
                break;
            } else if (comparison === 0) {
                if (myResult === 'win') myResult = 'tie';
            }
        }

        if (myResult === 'win') wins++;
        else if (myResult === 'tie') ties++;
        else losses++;

        // 汇报进度
        if (sim % progressBatchSize === 0 && sim > 0) {
            self.postMessage({
                type: 'PROGRESS',
                progress: Math.floor((sim / numSimulations) * 100)
            });
        }
    }

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

    Object.entries(handDistribution).forEach(([rank, count]) => {
        result.handDistribution[rank] = {
            count,
            percentage: (count / total * 100).toFixed(1)
        };
    });

    return result;
}
