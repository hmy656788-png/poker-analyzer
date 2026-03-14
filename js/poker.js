/**
 * 德州扑克核心逻辑模块
 * 包含牌型表示、评估和比较功能
 */

// 优化12: LRU 缓存用于牌型评估
class LRUCache {
    constructor(capacity = 1000) {
        this.capacity = capacity;
        this.cache = new Map();
    }

    get(key) {
        if (!this.cache.has(key)) return null;
        const value = this.cache.get(key);
        // 移到最后（最近使用）
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }

    set(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.capacity) {
            // 删除最旧的（第一个）
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }

    clear() {
        this.cache.clear();
    }
}

// 全局缓存实例
const handEvalCache = new LRUCache(1000);

// 花色定义
const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
const SUIT_SYMBOLS = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
const SUIT_COLORS = { spades: '#e0e0e0', hearts: '#ff4757', diamonds: '#3498db', clubs: '#2ecc71' };

// 牌面定义 (0=2, 1=3, ..., 12=A)
const RANK_NAMES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_KEY_NAMES = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

// 牌型等级
const HAND_RANKS = {
    ROYAL_FLUSH: 9,
    STRAIGHT_FLUSH: 8,
    FOUR_OF_A_KIND: 7,
    FULL_HOUSE: 6,
    FLUSH: 5,
    STRAIGHT: 4,
    THREE_OF_A_KIND: 3,
    TWO_PAIR: 2,
    ONE_PAIR: 1,
    HIGH_CARD: 0
};

const HAND_NAMES = {
    9: '皇家同花顺',
    8: '同花顺',
    7: '四条',
    6: '葫芦',
    5: '同花',
    4: '顺子',
    3: '三条',
    2: '两对',
    1: '一对',
    0: '高牌'
};

const HAND_NAMES_EN = {
    9: 'Royal Flush',
    8: 'Straight Flush',
    7: 'Four of a Kind',
    6: 'Full House',
    5: 'Flush',
    4: 'Straight',
    3: 'Three of a Kind',
    2: 'Two Pair',
    1: 'One Pair',
    0: 'High Card'
};

/**
 * 创建一张牌
 * @param {number} rank - 0-12 (2 到 A)
 * @param {number} suit - 0-3 (spades, hearts, diamonds, clubs)
 */
function createCard(rank, suit) {
    return { rank, suit };
}

/**
 * 获取牌的显示名称
 */
function getCardName(card) {
    return RANK_NAMES[card.rank] + SUIT_SYMBOLS[SUITS[card.suit]];
}

/**
 * 创建完整的52张牌组
 */
function createDeck() {
    const deck = [];
    for (let suit = 0; suit < 4; suit++) {
        for (let rank = 0; rank < 13; rank++) {
            deck.push(createCard(rank, suit));
        }
    }
    return deck;
}

/**
 * Fisher-Yates 洗牌算法
 */
function shuffleDeck(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * 从牌组中移除指定的牌
 */
function removeCards(deck, cardsToRemove) {
    return deck.filter(card =>
        !cardsToRemove.some(c => c.rank === card.rank && c.suit === card.suit)
    );
}

/**
 * 评估5张牌的牌型
 * 返回 { handRank, values } 用于比较
 * values 数组按照重要性排列，用于同牌型比较
 */
function evaluate5Cards(cards) {
    const sorted = [...cards].sort((a, b) => b.rank - a.rank);
    const ranks = sorted.map(c => c.rank);
    const suits = sorted.map(c => c.suit);

    // 检查同花
    const isFlush = suits.every(s => s === suits[0]);

    // 检查顺子
    let isStraight = false;
    let straightHighCard = ranks[0];

    // 普通顺子
    if (ranks[0] - ranks[4] === 4 && new Set(ranks).size === 5) {
        isStraight = true;
    }
    // A-2-3-4-5 (Wheel)
    if (ranks[0] === 12 && ranks[1] === 3 && ranks[2] === 2 && ranks[3] === 1 && ranks[4] === 0) {
        isStraight = true;
        straightHighCard = 3; // 5 高
    }

    // 计算每个点数出现的次数
    const rankCount = {};
    ranks.forEach(r => { rankCount[r] = (rankCount[r] || 0) + 1; });
    const counts = Object.entries(rankCount)
        .map(([rank, count]) => ({ rank: parseInt(rank), count }))
        .sort((a, b) => b.count - a.count || b.rank - a.rank);

    // 判断牌型
    if (isFlush && isStraight) {
        if (straightHighCard === 12) {
            return { handRank: HAND_RANKS.ROYAL_FLUSH, values: [12] };
        }
        return { handRank: HAND_RANKS.STRAIGHT_FLUSH, values: [straightHighCard] };
    }

    if (counts[0].count === 4) {
        return {
            handRank: HAND_RANKS.FOUR_OF_A_KIND,
            values: [counts[0].rank, counts[1].rank]
        };
    }

    if (counts[0].count === 3 && counts[1].count === 2) {
        return {
            handRank: HAND_RANKS.FULL_HOUSE,
            values: [counts[0].rank, counts[1].rank]
        };
    }

    if (isFlush) {
        return { handRank: HAND_RANKS.FLUSH, values: ranks };
    }

    if (isStraight) {
        return { handRank: HAND_RANKS.STRAIGHT, values: [straightHighCard] };
    }

    if (counts[0].count === 3) {
        return {
            handRank: HAND_RANKS.THREE_OF_A_KIND,
            values: [counts[0].rank, ...counts.slice(1).map(c => c.rank)]
        };
    }

    if (counts[0].count === 2 && counts[1].count === 2) {
        return {
            handRank: HAND_RANKS.TWO_PAIR,
            values: [counts[0].rank, counts[1].rank, counts[2].rank]
        };
    }

    if (counts[0].count === 2) {
        return {
            handRank: HAND_RANKS.ONE_PAIR,
            values: [counts[0].rank, ...counts.slice(1).map(c => c.rank)]
        };
    }

    return { handRank: HAND_RANKS.HIGH_CARD, values: ranks };
}

/**
 * 从N张牌(5-7张)中找出最佳牌型
 * 优化12: 使用 LRU 缓存避免重复评估
 */
function getBestHand(cards) {
    // 生成缓存键：将牌排序后转为字符串
    const cacheKey = cards
        .map(c => c.rank * 4 + c.suit)
        .sort((a, b) => a - b)
        .join(',');

    // 尝试从缓存获取
    const cached = handEvalCache.get(cacheKey);
    if (cached) return cached;

    // 未命中缓存，执行实际评估
    const result = getBestHandUncached(cards);

    // 存入缓存
    handEvalCache.set(cacheKey, result);
    return result;
}

/**
 * 实际的牌型评估逻辑（无缓存）
 */
function getBestHandUncached(cards) {
    // 统计每个点数和花色的出现次数
    const rankCounts = new Array(13).fill(0);
    const suitCounts = new Array(4).fill(0);
    const suitCards = [[], [], [], []];

    for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        rankCounts[c.rank]++;
        suitCounts[c.suit]++;
        suitCards[c.suit].push(c.rank);
    }

    // 检查是否有同花 (>=5张同花色)
    let flushSuit = -1;
    for (let s = 0; s < 4; s++) {
        if (suitCounts[s] >= 5) {
            flushSuit = s;
            break;
        }
    }

    // 检查同花顺 / 皇家同花顺
    if (flushSuit !== -1) {
        const fRanks = suitCards[flushSuit].sort((a, b) => b - a);
        let consecutiveCount = 1;
        let straightHigh = -1;
        let isStraightFlush = false;

        for (let i = 1; i < fRanks.length; i++) {
            if (fRanks[i - 1] - fRanks[i] === 1) {
                consecutiveCount++;
                if (consecutiveCount === 5) {
                    isStraightFlush = true;
                    straightHigh = fRanks[i - 4];
                    break;
                }
            } else if (fRanks[i - 1] !== fRanks[i]) {
                consecutiveCount = 1;
            }
        }

        // 检查 A-2-3-4-5 同花顺 (Wheel)
        if (!isStraightFlush && fRanks[0] === 12 &&
            fRanks.includes(3) && fRanks.includes(2) &&
            fRanks.includes(1) && fRanks.includes(0)) {
            isStraightFlush = true;
            straightHigh = 3;
        }

        if (isStraightFlush) {
            if (straightHigh === 12) {
                return { handRank: HAND_RANKS.ROYAL_FLUSH, values: [12] };
            }
            return { handRank: HAND_RANKS.STRAIGHT_FLUSH, values: [straightHigh] };
        }
    }

    // 统计四条、三条、对子
    let quadRank = -1;
    const tripRanks = [];
    const pairRanks = [];

    for (let r = 12; r >= 0; r--) {
        if (rankCounts[r] === 4) quadRank = r;
        else if (rankCounts[r] === 3) tripRanks.push(r);
        else if (rankCounts[r] === 2) pairRanks.push(r);
    }

    // 四条
    if (quadRank !== -1) {
        let kicker = -1;
        for (let r = 12; r >= 0; r--) {
            if (r !== quadRank && rankCounts[r] > 0) { kicker = r; break; }
        }
        return { handRank: HAND_RANKS.FOUR_OF_A_KIND, values: [quadRank, kicker] };
    }

    // 葫芦 (三条 + 对子，或两个三条)
    if (tripRanks.length > 0) {
        const maxTrip = tripRanks[0];
        let pairForFullHouse = -1;

        if (tripRanks.length > 1) {
            pairForFullHouse = tripRanks[1];
        } else if (pairRanks.length > 0) {
            pairForFullHouse = pairRanks[0];
        }

        if (pairForFullHouse !== -1) {
            return { handRank: HAND_RANKS.FULL_HOUSE, values: [maxTrip, pairForFullHouse] };
        }
    }

    // 同花
    if (flushSuit !== -1) {
        const top5 = suitCards[flushSuit].sort((a, b) => b - a).slice(0, 5);
        return { handRank: HAND_RANKS.FLUSH, values: top5 };
    }

    // 优化10: 使用位运算检查顺子
    let rankBits = 0;
    for (let r = 0; r < 13; r++) {
        if (rankCounts[r] > 0) {
            rankBits |= (1 << r);
        }
    }

    let straightHigh = -1;
    // 检查普通顺子 (从高到低)
    const straightPatterns = [
        0x1F00, // A-K-Q-J-T (bits 12-8)
        0x0F80, // K-Q-J-T-9 (bits 11-7)
        0x07C0, // Q-J-T-9-8 (bits 10-6)
        0x03E0, // J-T-9-8-7 (bits 9-5)
        0x01F0, // T-9-8-7-6 (bits 8-4)
        0x00F8, // 9-8-7-6-5 (bits 7-3)
        0x007C, // 8-7-6-5-4 (bits 6-2)
        0x003E, // 7-6-5-4-3 (bits 5-1)
        0x001F, // 6-5-4-3-2 (bits 4-0)
    ];

    for (let i = 0; i < straightPatterns.length; i++) {
        if ((rankBits & straightPatterns[i]) === straightPatterns[i]) {
            straightHigh = 12 - i;
            break;
        }
    }

    // 检查 A-2-3-4-5 顺子 (Wheel) - bit pattern: 0x100F
    if (straightHigh === -1 && (rankBits & 0x100F) === 0x100F) {
        straightHigh = 3;
    }

    if (straightHigh !== -1) {
        return { handRank: HAND_RANKS.STRAIGHT, values: [straightHigh] };
    }

    // 三条 (无对子配合)
    if (tripRanks.length > 0) {
        const trip = tripRanks[0];
        const kickers = [];
        for (let r = 12; r >= 0 && kickers.length < 2; r--) {
            if (r !== trip && rankCounts[r] > 0) kickers.push(r);
        }
        return { handRank: HAND_RANKS.THREE_OF_A_KIND, values: [trip, ...kickers] };
    }

    // 两对
    if (pairRanks.length >= 2) {
        const pair1 = pairRanks[0];
        const pair2 = pairRanks[1];
        let kicker = -1;
        for (let r = 12; r >= 0; r--) {
            if (r !== pair1 && r !== pair2 && rankCounts[r] > 0) { kicker = r; break; }
        }
        return { handRank: HAND_RANKS.TWO_PAIR, values: [pair1, pair2, kicker] };
    }

    // 一对
    if (pairRanks.length === 1) {
        const pair = pairRanks[0];
        const kickers = [];
        for (let r = 12; r >= 0 && kickers.length < 3; r--) {
            if (r !== pair && rankCounts[r] > 0) kickers.push(r);
        }
        return { handRank: HAND_RANKS.ONE_PAIR, values: [pair, ...kickers] };
    }

    // 高牌
    const kickers = [];
    for (let r = 12; r >= 0 && kickers.length < 5; r--) {
        if (rankCounts[r] > 0) kickers.push(r);
    }
    return { handRank: HAND_RANKS.HIGH_CARD, values: kickers };
}

/**
 * 比较两个牌型评估结果
 * 返回 > 0 则 a 赢，< 0 则 b 赢，= 0 则平
 */
function compareEvaluations(a, b) {
    if (a.handRank !== b.handRank) {
        return a.handRank - b.handRank;
    }
    for (let i = 0; i < Math.min(a.values.length, b.values.length); i++) {
        if (a.values[i] !== b.values[i]) {
            return a.values[i] - b.values[i];
        }
    }
    return 0;
}

// 起手牌强度预计算表（2人桌，对手1人时的大致胜率）
// 格式: [rank1][rank2][suited?] => winRate
const PREFLOP_CHART = generatePreflopChart();

function generatePreflopChart() {
    // 基于已知的起手牌排名数据的近似胜率值
    const chart = {};

    // 顶级起手牌 (Tier 1: >65%)
    const tier1 = { 'AA': 85, 'KK': 82, 'QQ': 80, 'JJ': 77, 'AKs': 67, 'AQs': 66, 'AKo': 65 };

    // 强起手牌 (Tier 2: 58-64%)
    const tier2 = {
        'TT': 75, 'AJs': 65, 'KQs': 63, 'ATs': 64, 'AQo': 64,
        '99': 72, 'KJs': 62, 'AJo': 63, 'KTs': 61, 'QJs': 60,
    };

    // 中等以上 (Tier 3: 54-58%)
    const tier3 = {
        '88': 69, 'QTs': 59, 'KQo': 61, 'A9s': 61, 'ATo': 62,
        'A8s': 60, 'KJo': 60, 'QJo': 58, 'JTs': 57, 'A7s': 59,
        '77': 66, 'A6s': 58, 'A5s': 58, 'KTo': 59, 'QTo': 57,
    };

    // 中等 (Tier 4: 50-54%)
    const tier4 = {
        '66': 63, 'A4s': 57, 'A3s': 56, 'JTo': 56, 'K9s': 57,
        'A2s': 55, 'T9s': 54, 'K8s': 55, 'Q9s': 55, 'J9s': 54,
        '55': 60, 'K7s': 54, 'T8s': 52, 'K6s': 53, 'Q8s': 53,
        '98s': 52, 'J8s': 53, 'K5s': 52, 'K9o': 55, 'K4s': 51,
    };

    // 中下 (Tier 5: 46-50%)
    const tier5 = {
        '44': 57, '87s': 50, 'K3s': 50, 'Q7s': 51, 'Q9o': 53,
        'K2s': 49, 'T9o': 52, 'J9o': 52, '97s': 49, 'T7s': 50,
        '76s': 49, 'Q6s': 50, 'J7s': 49, '33': 54, 'Q5s': 49,
        'J8o': 51, '86s': 48, '98o': 50, 'Q4s': 48, 'T8o': 50,
        'Q3s': 47, 'Q2s': 47, '96s': 47, 'J6s': 48, 'T6s': 48,
    };

    // 弱 (Tier 6: 42-46%)
    const tier6 = {
        '22': 50, '75s': 47, 'J5s': 47, '65s': 46, '87o': 48,
        'J4s': 46, '85s': 46, '54s': 46, 'T5s': 46, 'J3s': 46,
        '76o': 47, 'T4s': 45, '97o': 47, 'J2s': 45, '64s': 45,
        'T3s': 44, '95s': 45, 'T2s': 44, '53s': 44, '86o': 46,
        '74s': 44, '43s': 44, '84s': 43, '63s': 43, 'Q7o': 49,
        'Q6o': 48, 'Q5o': 47, 'Q4o': 46, 'Q3o': 45, 'Q2o': 45,
    };

    // 很弱 (Tier 7: <42%)
    const tier7 = {
        '65o': 44, '75o': 45, '54o': 44, '96o': 45, '73s': 43,
        '52s': 43, '93s': 42, '42s': 42, '62s': 42, '92s': 41,
        '83s': 41, '94o': 43, '72s': 40, '82s': 40, 'T7o': 48,
        'T6o': 46, 'T5o': 44, 'T4o': 43, 'T3o': 42, 'T2o': 42,
        'J7o': 47, 'J6o': 46, 'J5o': 45, 'J4o': 44, 'J3o': 44,
        'J2o': 43, '64o': 43, '53o': 42, '43o': 42, '32s': 40,
        '32o': 38, '42o': 40, '52o': 41, '62o': 40, '72o': 38,
        '82o': 38, '92o': 39, '73o': 41, '83o': 39, '93o': 40,
        '84o': 41, '94o': 43, '74o': 42, '85o': 44, '95o': 43,
    };

    const allTiers = [tier1, tier2, tier3, tier4, tier5, tier6, tier7];
    allTiers.forEach(tier => {
        Object.entries(tier).forEach(([key, value]) => {
            chart[key] = value;
        });
    });

    return chart;
}

/**
 * 获取起手牌的字符串表示
 * @param {object} card1 
 * @param {object} card2 
 * @returns {string} 如 "AKs" 或 "AKo" 或 "AA"
 */
function getStartingHandKey(card1, card2) {
    let r1 = card1.rank;
    let r2 = card2.rank;
    const suited = card1.suit === card2.suit;

    if (r1 < r2) [r1, r2] = [r2, r1];

    const n1 = RANK_KEY_NAMES[r1];
    const n2 = RANK_KEY_NAMES[r2];

    if (r1 === r2) return n1 + n2;
    return n1 + n2 + (suited ? 's' : 'o');
}

/**
 * 生成完整的 13x13 起手牌网格数据
 */
function generateStartingHandGrid(numOpponents = 1) {
    const grid = [];
    // 行：从 A 到 2
    for (let i = 12; i >= 0; i--) {
        const row = [];
        for (let j = 12; j >= 0; j--) {
            let key;
            if (i === j) {
                key = RANK_KEY_NAMES[i] + RANK_KEY_NAMES[j];
            } else if (i > j) {
                // 上三角：suited
                key = RANK_KEY_NAMES[i] + RANK_KEY_NAMES[j] + 's';
            } else {
                // 下三角：offsuit
                key = RANK_KEY_NAMES[j] + RANK_KEY_NAMES[i] + 'o';
            }
            let baseWinRate = PREFLOP_CHART[key] || 40;

            // 优化11: 改进多人底池胜率计算
            // 使用更准确的公式：考虑对手之间的互相淘汰
            // 公式: W_n = W_2 * (1 - (1-W_2) * 0.5)^(n-1)
            // 其中 W_2 是单挑胜率，n 是对手数量
            let winRate;
            if (numOpponents === 1) {
                winRate = baseWinRate;
            } else {
                const w2 = baseWinRate / 100;
                // 每增加一个对手，胜率衰减因子
                const decayFactor = Math.pow(1 - (1 - w2) * 0.5, numOpponents - 1);
                winRate = Math.round(w2 * decayFactor * 100);
            }

            row.push({ key, winRate, baseWinRate, row: 12 - i, col: 12 - j });
        }
        grid.push(row);
    }
    return grid;
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SUITS, SUIT_SYMBOLS, SUIT_COLORS, RANK_NAMES,
        HAND_RANKS, HAND_NAMES, HAND_NAMES_EN,
        createCard, getCardName, createDeck, shuffleDeck, removeCards,
        evaluate5Cards, getBestHand, compareEvaluations,
        PREFLOP_CHART, getStartingHandKey, generateStartingHandGrid
    };
}
