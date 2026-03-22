interface CardLike {
    rank: number;
    suit: number;
}

interface NavigatorConnectionLike {
    saveData?: boolean;
}

interface Navigator {
    standalone?: boolean;
    deviceMemory?: number;
    connection?: NavigatorConnectionLike;
}

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

interface Window {
    __POKER_ERROR_MONITORING__?: boolean;
}

declare const SUITS: string[];
declare const SUIT_SYMBOLS: Record<string, string>;
declare const RANK_NAMES: string[];
declare const RANK_KEY_NAMES: string[];
declare const HAND_NAMES: Record<number, string> | string[];
declare const HAND_NAMES_EN: Record<number, string> | string[];
declare const ANALYSIS_CACHE_VERSION: string;
declare const PREFLOP_PRECOMPUTE_SIMULATIONS: number;
declare const DEFAULT_PREFLOP_PRECOMPUTE_TARGETS: Array<{ handKey: string; numOpponents: number; opponentProfile: string }>;

declare function createCard(rank: number, suit: number): CardLike;
declare function cardToInt(card: CardLike): number;
declare function intToCard(intCard: number): CardLike;
declare function createIntDeck(): number[];
declare function removeIntCards(deck: number[], cardsToRemove: number[]): number[];
declare function getBestHand(cards: CardLike[]): { handRank: number };
declare function getBestHandFast(cards: number[], length: number): number;
declare function normalizeOpponentProfile(profileName?: string): string;
declare function getOpponentProfile(profileName?: string): { label: string; description: string };
declare function getOpponentRangeSet(profileName?: string): Set<string> | null;
declare function getStartingHandKey(card1: CardLike, card2: CardLike): string;
declare function generateStartingHandGrid(numOpponents?: number): Array<Array<{ key: string; baseWinRate: number; winRate: string }>>;
declare function getSmartSimulationCount(communityCardsCount: number, numOpponents: number, runtimeScale?: number): number;
declare function getNextRuntimeAdaptiveState(currentScale: number, fastRunStreak: number, analysisDurationMs: number): { scale: number; fastRunStreak: number };
declare function calculateDecisionMetrics(winRate: string | number, potSize: number, callAmount: number): {
    action: string;
    level: string;
    note: string;
    potOddsPct: string;
    requiredEquityPct: string;
    callEVBB: string;
    finalPotBB: string;
    callEV: number;
};
declare function simulate(myHand: CardLike[], communityCards: CardLike[], numOpponents: number, numSimulations?: number, options?: { opponentProfile?: string }): {
    winRate: string;
    tieRate: string;
    loseRate: string;
    wins: number;
    ties: number;
    losses: number;
    total: number;
    handDistribution: Record<string, { count: number; percentage: string }>;
};
declare function evaluateCurrentHand(myHand: CardLike[], communityCards: CardLike[]): { handRank: number; handName: string; handNameEn: string } | null;
declare function getAdvice(winRate: string | number, decisionMetrics?: unknown): { text: string; level: string; emoji: string };
declare function buildAnalysisCacheUrl(myHand: CardLike[], communityCards: CardLike[], numOpponents: number, opponentProfile?: string): string;
declare function isPreflopCacheEligible(myHand: CardLike[], communityCards: CardLike[]): boolean;
declare function parseStartingHandKey(handKey: string): {
    handKey: string;
    firstRank: number;
    secondRank: number;
    isPair: boolean;
    isSuited: boolean;
    isOffsuit: boolean;
} | null;
declare function createRepresentativeHandForKey(handKey: string): CardLike[];
