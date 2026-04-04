importScripts('/js/poker.js', '/js/simulator.js');

const SW_VERSION = '20260431';
const STATIC_ASSET_VERSION = '20260431';
const STATIC_CACHE = `poker-static-${SW_VERSION}`;
const RUNTIME_CACHE = `poker-runtime-${SW_VERSION}`;
const ANALYSIS_CACHE = `poker-analysis-${SW_VERSION}`;
const OFFLINE_PAGE = '/index.html';
const MAX_PRECOMPUTE_ENTRIES = 6;

const CORE_ASSETS = [
    '/',
    '/index.html',
    '/css/style.css',
    `/css/style.css?v=${STATIC_ASSET_VERSION}`,
    '/dist/css/style.css',
    `/dist/css/style.css?v=${STATIC_ASSET_VERSION}`,
    '/css/scanner.css',
    `/css/scanner.css?v=${STATIC_ASSET_VERSION}`,
    '/js/poker.js',
    '/js/simulator.js',
    '/js/worker.js',
    '/js/app.js',
    `/js/app.js?v=${STATIC_ASSET_VERSION}`,
    '/js/modules/precompute.js',
    '/js/modules/ai-advisor.js',
    `/js/modules/ai-advisor.js?v=${STATIC_ASSET_VERSION}`,
    '/js/modules/scanner.js',
    `/js/modules/scanner.js?v=${STATIC_ASSET_VERSION}`,
    '/js/modules/install-guide.js',
    '/wasm/montecarlo.wasm',
    '/manifest.json',
];

async function writeAnalysisCacheEntry(entry) {
    const cacheUrl = buildAnalysisCacheUrl(
        entry.myHand,
        [],
        entry.numOpponents,
        entry.opponentProfile
    );

    if (!cacheUrl) return false;

    const cache = await caches.open(ANALYSIS_CACHE);
    const payload = createAnalysisCacheEntry({
        ...entry,
        cacheUrl
    });
    await cache.put(
        cacheUrl,
        new Response(JSON.stringify(payload), {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store'
            }
        })
    );
    return true;
}

async function hasAnalysisCacheEntry(cacheUrl) {
    if (!cacheUrl) return false;
    const cache = await caches.open(ANALYSIS_CACHE);
    const cached = await cache.match(cacheUrl);
    if (!cached) return false;

    try {
        const payload = await cached.json();
        if (isAnalysisCacheEntryValid(payload)) {
            return true;
        }
    } catch (error) {
        // fall through and delete the invalid entry
    }

    await cache.delete(cacheUrl);
    return false;
}

async function precomputeEntry(entry) {
    const myHand = createRepresentativeHandForKey(entry.handKey);
    if (myHand.length !== 2) return;

    const cacheUrl = buildAnalysisCacheUrl(
        myHand,
        [],
        entry.numOpponents,
        entry.opponentProfile
    );

    if (await hasAnalysisCacheEntry(cacheUrl)) return;

    const numSimulations = Math.max(
        PREFLOP_PRECOMPUTE_SIMULATIONS,
        getSmartSimulationCount(0, entry.numOpponents, 1)
    );
    const result = simulate(
        myHand,
        [],
        entry.numOpponents,
        numSimulations,
        { opponentProfile: entry.opponentProfile }
    );

    await writeAnalysisCacheEntry({
        handKey: entry.handKey,
        stage: 'preflop',
        myHand,
        communityCards: [],
        numOpponents: entry.numOpponents,
        opponentProfile: normalizeOpponentProfile(entry.opponentProfile),
        numSimulations,
        source: 'service-worker-precompute',
        result
    });
}

async function precomputePopularHands(entries) {
    const queue = Array.isArray(entries) && entries.length > 0
        ? entries.slice(0, MAX_PRECOMPUTE_ENTRIES)
        : DEFAULT_PREFLOP_PRECOMPUTE_TARGETS;

    for (const rawEntry of queue) {
        const handKey = String(rawEntry.handKey || '').toUpperCase();
        const normalizedEntry = {
            handKey,
            numOpponents: Math.max(1, Math.min(8, Number(rawEntry.numOpponents) || 1)),
            opponentProfile: normalizeOpponentProfile(rawEntry.opponentProfile || 'random')
        };

        if (!parseStartingHandKey(handKey)) continue;
        await precomputeEntry(normalizedEntry);
    }
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => cache.addAll(CORE_ASSETS))
            .catch(() => null)
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const cacheNames = await caches.keys();
        await Promise.all(
            cacheNames
                .filter((name) => name !== STATIC_CACHE && name !== RUNTIME_CACHE && name !== ANALYSIS_CACHE)
                .map((name) => caches.delete(name))
        );
        await self.clients.claim();
    })());
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
        return;
    }

    if (event.data && event.data.type === 'PRECOMPUTE_ANALYSIS') {
        event.waitUntil(precomputePopularHands(event.data.entries));
    }
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    const sameOrigin = url.origin === self.location.origin;

    if (sameOrigin && url.pathname.startsWith('/api/')) {
        event.respondWith(fetch(request));
        return;
    }

    if (request.mode === 'navigate') {
        event.respondWith(networkFirstPage(request));
        return;
    }

    if (isStaticAsset(request, url, sameOrigin)) {
        event.respondWith(staleWhileRevalidate(request, sameOrigin));
        return;
    }

    event.respondWith(networkFirstGeneric(request));
});

function isStaticAsset(request, url, sameOrigin) {
    if (request.destination === 'script' || request.destination === 'style' || request.destination === 'font' || request.destination === 'image') {
        return true;
    }
    if (!sameOrigin) return false;
    return /\.(?:js|css|png|jpg|jpeg|webp|svg|json|ico|txt|wasm)$/i.test(url.pathname);
}

async function networkFirstPage(request) {
    const cache = await caches.open(RUNTIME_CACHE);
    try {
        const fresh = await fetch(request);
        cache.put(request, fresh.clone());
        return fresh;
    } catch (error) {
        return (await cache.match(request)) || (await caches.match(OFFLINE_PAGE)) || Response.error();
    }
}

async function staleWhileRevalidate(request, sameOrigin) {
    const cacheName = sameOrigin ? STATIC_CACHE : RUNTIME_CACHE;
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);

    const fetchPromise = fetch(request)
        .then((networkResponse) => {
            if (networkResponse && networkResponse.ok) {
                cache.put(request, networkResponse.clone());
            }
            return networkResponse;
        })
        .catch(() => null);

    return cached || (await fetchPromise) || Response.error();
}

async function networkFirstGeneric(request) {
    const cache = await caches.open(RUNTIME_CACHE);
    try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) {
            cache.put(request, fresh.clone());
        }
        return fresh;
    } catch (error) {
        return (await cache.match(request)) || Response.error();
    }
}
