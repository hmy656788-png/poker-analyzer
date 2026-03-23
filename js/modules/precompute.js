// js/modules/precompute.js

export function setupPrecompute({ 
    isPreflopCacheEligible, normalizeOpponentProfile, getStartingHandKey, 
    DEFAULT_PREFLOP_PRECOMPUTE_TARGETS, buildAnalysisCacheUrl, ANALYSIS_CACHE_NAME
}) {
    const HOT_HAND_USAGE_KEY = 'poker.hotPreflopUsage.v1';
    const PRECOMPUTE_IDLE_DELAY_MS = 1200;
    
    let popularPrecomputeTimer = null;
    let popularPrecomputeSignature = '';

    function createIdleHandle(callback, timeout = PRECOMPUTE_IDLE_DELAY_MS) {
        if (typeof window.requestIdleCallback === 'function') {
            return window.requestIdleCallback(callback, { timeout });
        }
        return window.setTimeout(callback, timeout);
    }

    function cancelIdleHandle(handle) {
        if (!handle) return;
        if (typeof window.cancelIdleCallback === 'function') {
            window.cancelIdleCallback(handle);
            return;
        }
        clearTimeout(handle);
    }

    function getUsageStore() {
        try {
            return JSON.parse(localStorage.getItem(HOT_HAND_USAGE_KEY) || '{}');
        } catch (error) {
            return {};
        }
    }

    function setUsageStore(store) {
        try {
            localStorage.setItem(HOT_HAND_USAGE_KEY, JSON.stringify(store));
        } catch (error) {
            // ignore persistence failures
        }
    }

    function recordPreflopUsage(myHand, numOpponents, opponentProfile) {
        if (!isPreflopCacheEligible(myHand, [])) return;

        const normalizedProfile = normalizeOpponentProfile(opponentProfile);
        const handKey = getStartingHandKey(myHand[0], myHand[1]);
        const usageStore = getUsageStore();
        const usageKey = `${handKey}|${Math.max(1, Number(numOpponents) || 1)}|${normalizedProfile}`;
        const current = usageStore[usageKey];

        usageStore[usageKey] = {
            handKey,
            numOpponents: Math.max(1, Number(numOpponents) || 1),
            opponentProfile: normalizedProfile,
            count: (current && current.count ? current.count : 0) + 1,
            lastSeenAt: Date.now()
        };

        setUsageStore(usageStore);
    }

    function getPopularPrecomputeEntries(limit = 6) {
        const usageStore = Object.values(getUsageStore());
        if (usageStore.length === 0) {
            return DEFAULT_PREFLOP_PRECOMPUTE_TARGETS.slice(0, limit);
        }

        return usageStore
            .sort((a, b) => {
                if (b.count !== a.count) return b.count - a.count;
                return (b.lastSeenAt || 0) - (a.lastSeenAt || 0);
            })
            .slice(0, limit)
            .map((entry) => ({
                handKey: entry.handKey,
                numOpponents: entry.numOpponents,
                opponentProfile: entry.opponentProfile
            }));
    }

    function schedulePopularPrecompute(force = false) {
        if (!('serviceWorker' in navigator)) return;

        const entries = getPopularPrecomputeEntries();
        const nextSignature = JSON.stringify(entries);
        if (!force && nextSignature === popularPrecomputeSignature) {
            return;
        }

        popularPrecomputeSignature = nextSignature;
        if (popularPrecomputeTimer) {
            cancelIdleHandle(popularPrecomputeTimer);
        }

        popularPrecomputeTimer = createIdleHandle(() => {
            navigator.serviceWorker.ready
                .then((registration) => {
                    const target = registration.active || registration.waiting || registration.installing;
                    if (target) {
                        target.postMessage({
                            type: 'PRECOMPUTE_ANALYSIS',
                            entries
                        });
                    }
                })
                .catch(() => {
                    // ignore unavailable service worker
                });
        });
    }

    async function readCachedAnalysisEntry(myHand, communityCards, numOpponents, opponentProfile) {
        if (!('caches' in window)) return null;

        const cacheUrl = buildAnalysisCacheUrl(myHand, communityCards, numOpponents, opponentProfile);
        if (!cacheUrl) return null;

        try {
            const response = await caches.match(cacheUrl);
            if (!response) return null;
            const payload = await response.json();
            if (!payload || !payload.result) return null;
            return payload;
        } catch (error) {
            return null;
        }
    }

    async function writeCachedAnalysisEntry(payload) {
        if (!('caches' in window)) return;

        const cacheUrl = buildAnalysisCacheUrl(
            payload.myHand,
            payload.communityCards,
            payload.numOpponents,
            payload.opponentProfile
        );

        if (!cacheUrl) return;

        try {
            const cache = await caches.open(ANALYSIS_CACHE_NAME);
            await cache.put(
                cacheUrl,
                new Response(JSON.stringify({
                    ...payload,
                    cacheUrl
                }), {
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-store'
                    }
                })
            );
        } catch (error) {
            // ignore cache write failures
        }
    }

    return {
        recordPreflopUsage,
        schedulePopularPrecompute,
        readCachedAnalysisEntry,
        writeCachedAnalysisEntry
    };
}
