/**
 * 德州扑克胜率分析器 - UI 交互逻辑
 * 连接 poker.js 和 simulator.js 到 HTML 界面
 */
// @ts-check

const app = (() => {
    let signatureTimer = null;
    let popularPrecomputeTimer = null;
    let popularPrecomputeSignature = '';
    let reportedErrorCount = 0;
    const reportedErrorFingerprints = new Set();
    const APP_BUILD = '20260317';
    const ANALYSIS_CACHE_NAME = `poker-analysis-${ANALYSIS_CACHE_VERSION}`;
    const INSTALL_GUIDE_DISMISS_KEY = 'poker.installGuideDismissAt';
    const INSTALL_GUIDE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
    const HOT_HAND_USAGE_KEY = 'poker.hotPreflopUsage.v1';
    const MAX_REPORTED_ERRORS = 5;
    const PRECOMPUTE_IDLE_DELAY_MS = 1200;
    const CLIENT_ERROR_ENDPOINT = '/api/client-error';

    // ===== 状态管理 =====
    const state = {
        hand: [null, null],          // 2张手牌
        community: [null, null, null, null, null], // 5张公共牌
        activeSlotType: 'hand',      // 当前激活的槽位类型: 'hand' | 'community'
        activeSlotIndex: 0,          // 当前激活的槽位索引
        currentStage: 'flop',        // 公共牌阶段: 'flop' | 'turn' | 'river'
        numOpponents: 1,
        suitFilter: [true, true, true, true], // 花色过滤器 [spades, hearts, diamonds, clubs]
        situationEnabled: false,
        situation: {
            position: 'BTN',
            potSize: 10,
            callAmount: 5,
            effectiveStackBB: 100,
            opponentProfile: 'tag',
        },
        isCalculating: false,
        currentWorkers: [],          // 优化3: 支持多个 Worker
        analysisRunId: 0,
        lastAnalysis: null,
        lastPlacedSlotKey: null,
        isSelectingCard: false,
        selectionToken: 0,
        adaptiveRuntimeScale: 1,
        fastRunStreak: 0,
        lastAnalysisDurationMs: 0,
        deferredInstallPrompt: null,
        isMobileDevice: false,
        isIOSDevice: false,
        isIOSSafari: false,
    };

    // ===== DOM 缓存 =====
    const DOM = {};
    function getEl(id) {
        if (!DOM[id]) {
            const el = document.getElementById(id);
            if (el) DOM[id] = el;
            return el;
        }
        return DOM[id];
    }

    // ===== 初始化 =====
    function init() {
        initErrorMonitoring();
        detectPlatformFlags();
        renderCardPicker();
        renderPreflopGrid();
        updateAnalyzeButton();
        updateStageCounts();
        updateStageProgress();
        syncSituationInputs();
        renderSituationMode();
        startSignatureTypewriter();
        initInstallGuide();
        schedulePopularPrecompute();
    }

    function startSignatureTypewriter() {
        const nameEl = getEl('signatureName');
        if (!nameEl) return;
        const lineEl = getEl('signatureLine');

        const fullName = nameEl.dataset.name || nameEl.textContent.trim() || 'Ricardo.He';
        if (signatureTimer) {
            clearInterval(signatureTimer);
            signatureTimer = null;
        }

        if (lineEl) lineEl.classList.remove('typing-done');

        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            nameEl.textContent = fullName;
            if (lineEl) lineEl.classList.add('typing-done');
            return;
        }

        nameEl.textContent = '';
        let charIndex = 0;

        signatureTimer = setInterval(() => {
            charIndex += 1;
            nameEl.textContent = fullName.slice(0, charIndex);
            if (charIndex >= fullName.length) {
                clearInterval(signatureTimer);
                signatureTimer = null;
                if (lineEl) lineEl.classList.add('typing-done');
            }
        }, 130);
    }

    function prefersReducedMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }



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

    function canReportClientError() {
        return reportedErrorCount < MAX_REPORTED_ERRORS;
    }

    function sendClientError(payload) {
        if (!canReportClientError()) return;

        const body = JSON.stringify(payload);
        reportedErrorCount += 1;

        if (navigator.sendBeacon) {
            const blob = new Blob([body], { type: 'application/json' });
            navigator.sendBeacon(CLIENT_ERROR_ENDPOINT, blob);
            return;
        }

        fetch(CLIENT_ERROR_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true
        }).catch(() => {
            // ignore telemetry delivery failures
        });
    }

    function reportClientError(type, detail = {}) {
        const message = String(detail.message || detail.reason || 'Unknown error').slice(0, 300);
        const fingerprint = [
            type,
            message,
            detail.source || detail.filename || '',
            detail.lineno || 0,
            detail.colno || 0
        ].join('|');

        if (!message || reportedErrorFingerprints.has(fingerprint) || !canReportClientError()) {
            return;
        }

        reportedErrorFingerprints.add(fingerprint);
        sendClientError({
            type,
            message,
            source: detail.source || detail.filename || '',
            lineno: detail.lineno || 0,
            colno: detail.colno || 0,
            stack: detail.stack ? String(detail.stack).slice(0, 3000) : '',
            url: window.location.href,
            userAgent: navigator.userAgent,
            build: APP_BUILD,
            timestamp: new Date().toISOString()
        });
    }

    function initErrorMonitoring() {
        if (window.__POKER_ERROR_MONITORING__) return;
        window.__POKER_ERROR_MONITORING__ = true;

        window.addEventListener('error', (event) => {
            reportClientError('error', {
                message: event.message,
                source: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                stack: event.error && event.error.stack
            });
        });

        window.addEventListener('unhandledrejection', (event) => {
            const reason = event.reason;
            reportClientError('unhandledrejection', {
                message: reason && reason.message ? reason.message : String(reason),
                stack: reason && reason.stack ? reason.stack : ''
            });
        });
    }

    function getDismissedInstallAt() {
        try {
            return Number(localStorage.getItem(INSTALL_GUIDE_DISMISS_KEY) || 0);
        } catch (error) {
            return 0;
        }
    }

    function setDismissedInstallAt(timestamp) {
        try {
            localStorage.setItem(INSTALL_GUIDE_DISMISS_KEY, String(timestamp));
        } catch (error) {
            // ignore write failures
        }
    }

    function isStandaloneMode() {
        return !!(
            (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
            (window.navigator && window.navigator.standalone)
        );
    }

    function detectPlatformFlags() {
        const userAgent = navigator.userAgent || '';
        const touchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
        const isIOS = /iPhone|iPad|iPod/i.test(userAgent) || touchMac;
        const isSafariEngine = /Safari/i.test(userAgent);
        const isKnownAltIOSBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|YaBrowser|Quark|QQBrowser|UCBrowser|MicroMessenger/i.test(userAgent);

        state.isIOSDevice = isIOS;
        state.isIOSSafari = isIOS && isSafariEngine && !isKnownAltIOSBrowser;
        state.isMobileDevice = /Android|iPhone|iPad|iPod|Mobile|Phone|IEMobile|Opera Mini/i.test(userAgent) || touchMac;
    }

    function getInstallGuideMode() {
        if (!state.isMobileDevice || isStandaloneMode()) return 'none';
        if (state.deferredInstallPrompt) return 'native';
        if (state.isIOSDevice && state.isIOSSafari) return 'ios_safari';
        if (state.isIOSDevice) return 'ios_other';
        return 'none';
    }

    function shouldBlockInstallGuide() {
        if (isStandaloneMode()) return true;
        const dismissedAt = getDismissedInstallAt();
        return dismissedAt > 0 && (Date.now() - dismissedAt) < INSTALL_GUIDE_COOLDOWN_MS;
    }

    function setInstallGuideSteps(stepItems) {
        const stepList = getEl('installGuideSteps');
        if (!stepList) return;

        if (!stepItems || stepItems.length === 0) {
            stepList.hidden = true;
            stepList.innerHTML = '';
            return;
        }

        stepList.innerHTML = stepItems.map((item) => `<li>${item}</li>`).join('');
        stepList.hidden = false;
    }

    function setInstallGuideHint(text) {
        const hint = getEl('installGuideHint');
        if (!hint) return;

        if (!text) {
            hint.hidden = true;
            hint.textContent = '';
            return;
        }

        hint.textContent = text;
        hint.hidden = false;
    }

    function updateInstallGuideContent(mode) {
        const title = getEl('installGuideTitle');
        const description = getEl('installGuideDesc');
        const primaryButton = getEl('installGuidePrimary');
        if (!title || !description || !primaryButton) return;

        if (mode === 'native') {
            title.textContent = '添加到主屏幕';
            description.textContent = '支持一键安装，完成后可像原生 App 一样从桌面秒开。';
            primaryButton.textContent = '一键添加';
            setInstallGuideSteps([]);
            setInstallGuideHint('');
            return;
        }

        if (mode === 'ios_safari') {
            title.textContent = '添加到主屏幕（Safari）';
            description.textContent = 'iPhone 需要手动添加，按下面 3 步即可完成。';
            primaryButton.textContent = '我知道了';
            setInstallGuideSteps([
                '点击底部工具栏的“分享”按钮',
                '在菜单中选择“添加到主屏幕”',
                '点右上角“添加”，返回桌面即可打开',
            ]);
            setInstallGuideHint('提示：如果看不到“分享”按钮，请先向下轻滑让工具栏出现。');
            return;
        }

        title.textContent = '请切换 Safari 安装';
        description.textContent = '你当前不在 Safari，iOS 仅支持在 Safari 中添加到主屏幕。';
        primaryButton.textContent = '复制链接';
        setInstallGuideSteps([
            '点击“复制链接”',
            '打开 Safari 并粘贴访问当前页面',
            '在 Safari 里点击“分享”→“添加到主屏幕”',
        ]);
        setInstallGuideHint('复制后可直接粘贴到 Safari 地址栏。');
    }

    async function copyTextToClipboard(text) {
        if (!text) return false;
        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch (error) {
                // fallback below
            }
        }

        try {
            const input = document.createElement('textarea');
            input.value = text;
            input.setAttribute('readonly', 'readonly');
            input.style.position = 'fixed';
            input.style.opacity = '0';
            document.body.appendChild(input);
            input.select();
            const success = document.execCommand('copy');
            document.body.removeChild(input);
            return success;
        } catch (error) {
            return false;
        }
    }

    function updateInstallEntry() {
        const mode = getInstallGuideMode();
        const guide = getEl('installGuide');
        const fab = getEl('installFab');

        if (mode === 'none' && guide) {
            guide.hidden = true;
        }

        if (mode !== 'none') {
            updateInstallGuideContent(mode);
        }

        if (!fab) return;
        const isGuideVisible = !!(guide && !guide.hidden);
        fab.hidden = mode === 'none' || isGuideVisible;
        if (mode === 'native') {
            fab.textContent = '一键添加到桌面';
        } else if (mode === 'ios_other') {
            fab.textContent = '部署到桌面';
        } else {
            fab.textContent = '查看安装步骤';
        }
    }

    function showInstallGuide(force = false) {
        if (!force && shouldBlockInstallGuide()) return;
        if (getInstallGuideMode() === 'none') return;

        const guide = getEl('installGuide');
        if (!guide) return;

        updateInstallGuideContent(getInstallGuideMode());
        guide.hidden = false;
        updateInstallEntry();
    }

    function hideInstallGuide() {
        const guide = getEl('installGuide');
        if (!guide) return;
        guide.hidden = true;
        updateInstallEntry();
    }

    function dismissInstallGuide() {
        setDismissedInstallAt(Date.now());
        hideInstallGuide();
    }

    async function installApp() {
        const promptEvent = state.deferredInstallPrompt;
        if (!promptEvent) {
            showInstallGuide(true);
            return;
        }

        try {
            await promptEvent.prompt();
            const choice = await promptEvent.userChoice;
            state.deferredInstallPrompt = null;
            if (choice && choice.outcome === 'accepted') {
                hideInstallGuide();
            } else {
                dismissInstallGuide();
            }
        } catch (error) {
            dismissInstallGuide();
        }
    }

    async function handleInstallPrimaryAction() {
        const mode = getInstallGuideMode();

        if (mode === 'native') {
            await installApp();
            return;
        }

        if (mode === 'ios_other') {
            const copied = await copyTextToClipboard(window.location.href);
            if (copied) {
                setInstallGuideHint('链接已复制，请切换到 Safari 粘贴打开后安装。');
            } else {
                setInstallGuideHint('复制失败，请手动复制当前网址并在 Safari 中打开。');
            }
            return;
        }

        dismissInstallGuide();
    }

    async function quickInstall() {
        if (state.deferredInstallPrompt) {
            await installApp();
            return;
        }
        showInstallGuide(true);
    }

    function initInstallGuide() {
        updateInstallEntry();

        window.addEventListener('beforeinstallprompt', (event) => {
            event.preventDefault();
            state.deferredInstallPrompt = event;
            updateInstallEntry();
            showInstallGuide();
        });

        window.addEventListener('appinstalled', () => {
            state.deferredInstallPrompt = null;
            hideInstallGuide();
            updateInstallEntry();
        });

        window.addEventListener('pageshow', () => {
            updateInstallEntry();
        });
    }

    function toSlotKey(type, index) {
        return `${type}-${index}`;
    }

    function markPlacedSlot(type, index) {
        state.lastPlacedSlotKey = toSlotKey(type, index);
        setTimeout(() => {
            if (state.lastPlacedSlotKey === toSlotKey(type, index)) {
                state.lastPlacedSlotKey = null;
            }
        }, 280);
    }

    function shouldAnimatePlacedSlot(type, index) {
        return state.lastPlacedSlotKey === toSlotKey(type, index) && !prefersReducedMotion();
    }

    // ===== 扑克牌选择器 =====
    function renderCardPicker() {
        const container = getEl('cardPicker');
        if (!container) return;
        container.innerHTML = '';

        const suitOrder = [0, 1, 2, 3]; // spades, hearts, diamonds, clubs

        for (const suitIdx of suitOrder) {
            if (!state.suitFilter[suitIdx]) continue;

            for (let rank = 12; rank >= 0; rank--) {
                const card = createCard(rank, suitIdx);
                const isPicked = isCardSelected(card);
                const suitName = SUITS[suitIdx];

                const el = document.createElement('div');
                el.className = `pick-card ${suitName}${isPicked ? ' picked' : ''}`;
                el.dataset.card = `${rank}-${suitIdx}`;
                el.innerHTML = `
                    <span class="pick-rank">${RANK_NAMES[rank]}</span>
                    <span class="pick-suit">${SUIT_SYMBOLS[suitName]}</span>
                `;
                el.onclick = () => selectCard(rank, suitIdx);
                container.appendChild(el);
            }
        }
    }

    function isCardSelected(card) {
        for (const c of state.hand) {
            if (c && c.rank === card.rank && c.suit === card.suit) return true;
        }
        for (const c of state.community) {
            if (c && c.rank === card.rank && c.suit === card.suit) return true;
        }
        return false;
    }

    function animatePickCard(rank, suit, cb) {
        const cell = document.querySelector(`.pick-card[data-card="${rank}-${suit}"]`);
        if (!cell || prefersReducedMotion()) {
            cb();
            return;
        }

        cell.classList.add('selecting');
        setTimeout(cb, 110);
    }

    // ===== 选牌逻辑 =====
    function selectCard(rank, suit) {
        if (state.isSelectingCard) return;
        const card = createCard(rank, suit);
        if (isCardSelected(card)) return;

        const token = state.selectionToken + 1;
        state.selectionToken = token;
        state.isSelectingCard = true;
        animatePickCard(rank, suit, () => {
            try {
                if (token !== state.selectionToken) return;
                if (isCardSelected(card)) return;
                vibrate('light');
                if (state.lastAnalysis) invalidateAnalysisResults();
                const { activeSlotType, activeSlotIndex } = state;

                if (activeSlotType === 'hand') {
                    state.hand[activeSlotIndex] = card;
                    markPlacedSlot('hand', activeSlotIndex);
                    renderHandSlots();
                    // 自动推进到下一个空手牌槽位
                    const nextEmpty = state.hand.findIndex(c => c === null);
                    if (nextEmpty !== -1) {
                        activateSlot('hand', nextEmpty);
                    } else {
                        // 手牌满了，切到公共牌第一个空位
                        const commEmpty = getVisibleCommunitySlots().find(i => state.community[i] === null);
                        if (commEmpty !== undefined) {
                            activateSlot('community', commEmpty);
                        }
                    }
                } else {
                    // 检查当前阶段是否允许填入这个位置
                    const visibleSlots = getVisibleCommunitySlots();
                    if (!visibleSlots.includes(activeSlotIndex)) return;

                    state.community[activeSlotIndex] = card;
                    markPlacedSlot('community', activeSlotIndex);
                    renderCommunitySlots();
                    // 自动推进到下一个空公共牌位
                    const nextEmpty = visibleSlots.find(i => state.community[i] === null);
                    if (nextEmpty !== undefined) {
                        activateSlot('community', nextEmpty);
                    } else if (state.currentStage === 'river') {
                        // 回河牌阶段最后一张牌填满时，自动触发分析！
                        setTimeout(() => {
                            const btn = /** @type {HTMLButtonElement | null} */ (getEl('analyzeBtn'));
                            if (btn && !btn.disabled) btn.click();
                        }, 280);
                    }
                }

                renderCardPicker();
                updateAnalyzeButton();
                updateStageCounts();
                updateStageProgress();
            } finally {
                if (token === state.selectionToken) {
                    state.isSelectingCard = false;
                }
            }
        });
    }

    function getVisibleCommunitySlots() {
        // 根据当前阶段返回可见的公共牌槽位索引
        switch (state.currentStage) {
            case 'flop': return [0, 1, 2];
            case 'turn': return [0, 1, 2, 3];
            case 'river': return [0, 1, 2, 3, 4];
            default: return [0, 1, 2];
        }
    }

    // ===== 槽位管理 =====
    function activateSlot(type, index) {
        state.activeSlotType = type;
        state.activeSlotIndex = index;
        renderHandSlots();
        renderCommunitySlots();
    }

    function clearCardAtSlot(type, index) {
        if (type === 'hand') {
            state.hand[index] = null;
            if (state.lastAnalysis) invalidateAnalysisResults();
            activateSlot('hand', index);
            renderCardPicker();
            updateAnalyzeButton();
            updateStageProgress();
            return;
        }

        state.community[index] = null;
        if (state.lastAnalysis) invalidateAnalysisResults();
        activateSlot('community', index);
        renderCardPicker();
        updateAnalyzeButton();
        updateStageCounts();
        updateStageProgress();
    }

    function removeCardFromSlot(type, index, slotEl) {
        vibrate('light');
        if (!slotEl || prefersReducedMotion()) {
            clearCardAtSlot(type, index);
            return;
        }

        if (slotEl.dataset.clearing === '1') return;
        slotEl.dataset.clearing = '1';
        slotEl.classList.add('is-clearing');
        setTimeout(() => clearCardAtSlot(type, index), 170);
    }

    function renderHandSlots() {
        const container = getEl('handCards');
        if (!container) return;

        container.innerHTML = '';
        for (let i = 0; i < 2; i++) {
            const card = state.hand[i];
            const isActive = state.activeSlotType === 'hand' && state.activeSlotIndex === i;

            if (card) {
                const suitName = SUITS[card.suit];
                const el = document.createElement('div');
                const placingClass = shouldAnimatePlacedSlot('hand', i) ? ' is-placing' : '';
                el.className = `selected-card-slot filled${isActive ? ' active-slot' : ''}${placingClass}`;
                el.innerHTML = `
                    <div class="poker-card ${suitName}">
                        <span class="rank">${RANK_NAMES[card.rank]}</span>
                        <span class="suit">${SUIT_SYMBOLS[suitName]}</span>
                    </div>
                `;
                el.onclick = () => removeCardFromSlot('hand', i, el);
                container.appendChild(el);
            } else {
                const el = document.createElement('div');
                el.className = `selected-card-slot${isActive ? ' active-slot' : ''}`;
                el.textContent = '+';
                el.onclick = () => activateSlot('hand', i);
                container.appendChild(el);
            }
        }
    }

    function renderCommunitySlots() {
        const container = getEl('communityCards');
        if (!container) return;

        const visibleSlots = getVisibleCommunitySlots();
        container.innerHTML = '';

        for (let i = 0; i < 5; i++) {
            const card = state.community[i];
            const isVisible = visibleSlots.includes(i);
            const isActive = state.activeSlotType === 'community' && state.activeSlotIndex === i;

            const el = document.createElement('div');

            if (!isVisible) {
                el.className = 'selected-card-slot';
                el.style.display = 'none';
                container.appendChild(el);
                continue;
            }

            if (card) {
                const suitName = SUITS[card.suit];
                const placingClass = shouldAnimatePlacedSlot('community', i) ? ' is-placing' : '';
                el.className = `selected-card-slot filled${isActive ? ' active-slot' : ''}${placingClass}`;
                el.innerHTML = `
                    <div class="poker-card ${suitName}">
                        <span class="rank">${RANK_NAMES[card.rank]}</span>
                        <span class="suit">${SUIT_SYMBOLS[suitName]}</span>
                    </div>
                `;
                el.onclick = () => removeCardFromSlot('community', i, el);
            } else {
                el.className = `selected-card-slot${isActive ? ' active-slot' : ''}`;
                el.textContent = '+';
                el.onclick = () => activateSlot('community', i);
            }

            container.appendChild(el);
        }

        updateBoardTexture();
    }

    // ===== 牌面纹理 =====
    function updateBoardTexture() {
        const panel = getEl('boardTexturePanel');
        if (!panel) return;

        const validCards = state.community.filter(Boolean);
        if (validCards.length < 3) {
            panel.style.display = 'none';
            return;
        }

        const texture = analyzeBoardTexture(validCards);
        if (!texture) {
            panel.style.display = 'none';
            return;
        }

        getEl('textureLabel').textContent = texture.label;
        getEl('textureScore').textContent = texture.wetness;
        
        const bar = getEl('textureBar');
        bar.style.width = `${texture.wetness}%`;
        bar.className = `texture-bar-fill ${texture.colorClass}`;

        const badgesContainer = getEl('textureBadges');
        badgesContainer.innerHTML = '';
        texture.badges.forEach(b => {
            const span = document.createElement('span');
            span.className = `texture-badge ${b.type}`;
            span.textContent = b.text;
            badgesContainer.appendChild(span);
        });

        panel.style.display = 'block';
    }

    // ===== 花色过滤 =====
    function filterSuit(suitIdx) {
        vibrate('medium');
        state.suitFilter[suitIdx] = !state.suitFilter[suitIdx];

        // 至少保留一个花色
        if (state.suitFilter.every(v => !v)) {
            state.suitFilter[suitIdx] = true;
            return;
        }

        // 更新按钮状态
        const btns = document.querySelectorAll('#suitFilter .suit-btn');
        btns.forEach((btn, i) => {
            btn.classList.toggle('active', state.suitFilter[i]);
        });

        renderCardPicker();
    }

    // ===== 阶段切换 =====
    function switchStage(stage) {
        vibrate('medium');
        state.currentStage = stage;

        // 更新Tab样式
        document.querySelectorAll('.stage-tab').forEach(tab => {
            tab.classList.toggle('active', tab.getAttribute('data-stage') === stage);
        });

        // 更新标签文案
        const labels = { flop: '翻牌 - 选择3张公共牌', turn: '转牌 - 选择第4张', river: '河牌 - 选择第5张' };
        const labelEl = getEl('communityLabel');
        if (labelEl) labelEl.textContent = labels[stage];

        // 切到新阶段时，自动激活新增的空槽位
        const visibleSlots = getVisibleCommunitySlots();
        const emptySlot = visibleSlots.find(i => state.community[i] === null);
        if (emptySlot !== undefined) {
            activateSlot('community', emptySlot);
        }

        renderCommunitySlots();
        updateStageCounts();
        updateStageProgress();
    }

    function updateStageCounts() {
        const flopFilled = [0, 1, 2].filter(i => state.community[i] !== null).length;
        const turnFilled = state.community[3] !== null ? 1 : 0;
        const riverFilled = state.community[4] !== null ? 1 : 0;

        const flopEl = getEl('flopCount');
        const turnEl = getEl('turnCount');
        const riverEl = getEl('riverCount');

        if (flopEl) flopEl.textContent = `(${flopFilled}/3)`;
        if (turnEl) turnEl.textContent = `(${turnFilled}/1)`;
        if (riverEl) riverEl.textContent = `(${riverFilled}/1)`;
    }

    function updateStageProgress() {
        const handFilled = state.hand.filter(c => c !== null).length;
        const flopFilled = [0, 1, 2].filter(i => state.community[i] !== null).length;
        const turnFilled = state.community[3] !== null ? 1 : 0;
        const riverFilled = state.community[4] !== null ? 1 : 0;

        // 判定各阶段状态
        const stages = {
            preflop: handFilled === 2 ? 'completed' : (handFilled > 0 ? 'current' : 'pending'),
            flop: flopFilled === 3 ? 'completed' : (handFilled === 2 && flopFilled > 0 ? 'current' : (handFilled === 2 ? 'current' : 'pending')),
            turn: turnFilled === 1 ? 'completed' : (flopFilled === 3 ? 'current' : 'pending'),
            river: riverFilled === 1 ? 'completed' : (turnFilled === 1 ? 'current' : 'pending'),
        };

        // 修正：翻前如果完成了，翻牌变成current
        if (stages.preflop === 'completed' && stages.flop === 'pending') {
            stages.flop = 'current';
        }

        const stageNames = ['preflop', 'flop', 'turn', 'river'];
        stageNames.forEach(name => {
            const dots = document.querySelectorAll(`.stage-dot[data-stage="${name}"]`);
            const names = document.querySelectorAll(`.stage-name[data-stage="${name}"]`);
            dots.forEach(dot => {
                dot.className = `stage-dot ${stages[name]}`;
            });
            names.forEach(n => {
                n.className = `stage-name`;
                if (stages[name] === 'completed') n.classList.add('completed');
                if (stages[name] === 'current') n.classList.add('active');
            });
        });

        // 更新连接线
        const lineStages = [
            { line: 'flop-line', from: 'preflop', to: 'flop' },
            { line: 'turn-line', from: 'flop', to: 'turn' },
            { line: 'river-line', from: 'turn', to: 'river' },
        ];
        lineStages.forEach(({ line, from }) => {
            const lineEl = document.querySelector(`.stage-line[data-stage="${line}"]`);
            if (lineEl) {
                lineEl.className = `stage-line${stages[from] === 'completed' ? ' completed' : ''}`;
            }
        });
    }

    // ===== 分析按钮 =====
    function updateAnalyzeButton() {
        const btn = /** @type {HTMLButtonElement | null} */ (getEl('analyzeBtn'));
        if (!btn) return;
        const handReady = state.hand.every(c => c !== null);
        btn.disabled = !handReady || state.isCalculating;
    }

    function syncSituationInputs() {
        const positionSelect = /** @type {HTMLSelectElement | null} */ (getEl('positionSelect'));
        const opponentProfileSelect = /** @type {HTMLSelectElement | null} */ (getEl('opponentProfileSelect'));
        const potSizeInput = /** @type {HTMLInputElement | null} */ (getEl('potSizeInput'));
        const callAmountInput = /** @type {HTMLInputElement | null} */ (getEl('callAmountInput'));
        const stackInput = /** @type {HTMLInputElement | null} */ (getEl('stackInput'));

        if (positionSelect) positionSelect.value = state.situation.position;
        if (opponentProfileSelect) opponentProfileSelect.value = state.situation.opponentProfile;
        if (potSizeInput) potSizeInput.value = String(state.situation.potSize);
        if (callAmountInput) callAmountInput.value = String(state.situation.callAmount);
        if (stackInput) stackInput.value = String(state.situation.effectiveStackBB);
    }

    function renderSituationMode() {
        const toggleBtn = getEl('situationToggleBtn');
        const content = getEl('situationContent');

        if (toggleBtn) {
            toggleBtn.textContent = state.situationEnabled ? '已开启 · 点击关闭' : '已关闭 · 点击开启';
            toggleBtn.classList.toggle('active', state.situationEnabled);
            toggleBtn.setAttribute('aria-pressed', state.situationEnabled ? 'true' : 'false');
        }
        if (content) content.hidden = !state.situationEnabled;
    }

    function hideDecisionPanel() {
        const decisionPanel = getEl('decisionPanel');
        if (decisionPanel) decisionPanel.className = 'decision-panel';
    }

    function toggleSituationMode() {
        state.situationEnabled = !state.situationEnabled;
        renderSituationMode();

        if (!state.lastAnalysis) return;

        if (!state.situationEnabled) {
            state.lastAnalysis.decision = null;
            hideDecisionPanel();
            renderAdvice(getAdvice(state.lastAnalysis.result.winRate));
            return;
        }

        const updatedDecision = calculateDecisionMetrics(
            state.lastAnalysis.result.winRate,
            state.situation.potSize,
            state.situation.callAmount
        );
        state.lastAnalysis.decision = updatedDecision;
        state.lastAnalysis.situation = getSituationSnapshot();
        renderDecisionPanel(updatedDecision, state.lastAnalysis.situation);
        renderAdvice(getAdvice(state.lastAnalysis.result.winRate, updatedDecision));
    }

    function getSituationSnapshot() {
        return {
            ...state.situation,
            numOpponents: state.numOpponents,
            enabled: state.situationEnabled
        };
    }

    function formatChips(value) {
        const numeric = Number(value) || 0;
        return `${numeric.toFixed(1)} 积分`;
    }

    function getStageText(communityCount) {
        if (communityCount >= 5) return '河牌 (River)';
        if (communityCount >= 4) return '转牌 (Turn)';
        if (communityCount >= 3) return '翻牌 (Flop)';
        return '翻前 (Preflop)';
    }

    function invalidateAnalysisResults() {
        if (state.isCalculating) {
            cancelAnalysis();
        }
        state.lastAnalysis = null;
        hideResults();
    }

    function updateSituationField(field, value) {
        if (field === 'position' || field === 'opponentProfile') {
            state.situation[field] = value;
        } else if (field === 'effectiveStackBB' && (value === '' || value === null || value === undefined)) {
            state.situation[field] = 100;
        } else {
            const numericValue = Math.max(0, Number(value) || 0);
            state.situation[field] = numericValue;
        }

        if (!state.lastAnalysis || !state.situationEnabled) return;

        if (field === 'opponentProfile') {
            invalidateAnalysisResults();
            return;
        }

        const updatedDecision = calculateDecisionMetrics(
            state.lastAnalysis.result.winRate,
            state.situation.potSize,
            state.situation.callAmount
        );
        state.lastAnalysis.decision = updatedDecision;
        state.lastAnalysis.situation = getSituationSnapshot();
        renderDecisionPanel(updatedDecision, state.lastAnalysis.situation);

        const advice = getAdvice(state.lastAnalysis.result.winRate, updatedDecision);
        renderAdvice(advice);
    }

    function cancelAnalysis() {
        state.analysisRunId += 1;
        state.selectionToken += 1;
        state.isSelectingCard = false;
        state.isCalculating = false;
        // 优化6: 清理所有 Worker 和事件监听器
        if (state.currentWorkers && state.currentWorkers.length > 0) {
            state.currentWorkers.forEach(worker => {
                if (worker) {
                    worker.onmessage = null;
                    worker.onerror = null;
                    worker.terminate();
                }
            });
            state.currentWorkers = [];
        }
        updateAnalyzeButton();
    }

    function getParallelPlan(totalSimulations, numOpponents) {
        const cores = Math.max(1, Number(navigator.hardwareConcurrency) || 4);
        const maxWorkers = Math.max(1, Math.min(8, cores - 1 || 1));

        let preferredWorkers = 2;
        if (numOpponents >= 7) preferredWorkers = 6;
        else if (numOpponents >= 5) preferredWorkers = 5;
        else if (numOpponents >= 3) preferredWorkers = 4;
        else preferredWorkers = 3;

        const minSimsPerWorker = numOpponents >= 6 ? 2200 : 3000;
        const capByWorkload = Math.max(1, Math.floor(totalSimulations / minSimsPerWorker));
        const workerCount = Math.max(1, Math.min(preferredWorkers, maxWorkers, capByWorkload));

        const chunks = [];
        let remaining = totalSimulations;
        for (let i = 0; i < workerCount; i++) {
            const chunk = Math.ceil(remaining / (workerCount - i));
            chunks.push(chunk);
            remaining -= chunk;
        }

        return { workerCount, chunks };
    }

    function nowMs() {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }

    function updateRuntimeScale(analysisDurationMs) {
        const duration = Math.max(0, Number(analysisDurationMs) || 0);
        state.lastAnalysisDurationMs = duration;
        const adaptiveState = getNextRuntimeAdaptiveState(
            state.adaptiveRuntimeScale,
            state.fastRunStreak,
            duration
        );
        state.adaptiveRuntimeScale = adaptiveState.scale;
        state.fastRunStreak = adaptiveState.fastRunStreak;
    }

    // ===== 模拟分析 =====
    async function analyze() {
        const handReady = state.hand.every(c => c !== null);
        if (!handReady || state.isCalculating) return;

        const runId = state.analysisRunId + 1;
        state.analysisRunId = runId;
        state.isCalculating = true;
        updateAnalyzeButton();

        // 显示加载状态
        const resultEmpty = getEl('resultEmpty');
        const calculating = getEl('calculating');
        const resultContent = getEl('resultContent');
        const progressSpan = getEl('analyzeProgress');

        if (resultEmpty) resultEmpty.style.display = 'none';
        if (calculating) {
            calculating.style.display = 'flex';
            if (progressSpan) {
                progressSpan.textContent = '准备启动计算引擎...';
            }
        }
        if (resultContent) {
            resultContent.classList.remove('result-enter');
            resultContent.style.display = 'none';
        }

        const handCards = state.hand.slice();
        const communityCards = state.community.filter(c => c !== null);
        const situation = getSituationSnapshot();
        const opponentProfile = state.situationEnabled ? situation.opponentProfile : 'random';
        recordPreflopUsage(handCards, state.numOpponents, opponentProfile);
        schedulePopularPrecompute(true);
        const totalSimulations = getSmartSimulationCount(
            communityCards.length,
            state.numOpponents,
            state.adaptiveRuntimeScale
        );
        const plan = getParallelPlan(totalSimulations, state.numOpponents);
        let switchedToFallback = false;
        const analysisStartedAt = nowMs();

        const finish = (result, usedSimulations) => {
            if (runId !== state.analysisRunId) return;
            const elapsedMs = nowMs() - analysisStartedAt;
            updateRuntimeScale(elapsedMs);
            state.isCalculating = false;
            updateAnalyzeButton();
            state.currentWorkers = [];
            if (calculating) calculating.style.display = 'none';
            displayResults(result, communityCards, usedSimulations);

            if (isPreflopCacheEligible(handCards, communityCards)) {
                writeCachedAnalysisEntry({
                    cachedAt: new Date().toISOString(),
                    myHand: handCards,
                    communityCards,
                    numOpponents: state.numOpponents,
                    opponentProfile,
                    numSimulations: usedSimulations,
                    source: result.engine === 'wasm' ? 'wasm-runtime' : 'runtime',
                    result
                }).catch(() => {
                    // ignore cache write failures
                });
            }
        };

        const runSingleThreadFallback = () => {
            if (switchedToFallback) return;
            switchedToFallback = true;
            setTimeout(() => {
                if (runId !== state.analysisRunId) return;
                const result = simulate(handCards, communityCards, state.numOpponents, totalSimulations, {
                    opponentProfile
                });
                finish(result, totalSimulations);
            }, 50);
        };

        const cachedResult = await readCachedAnalysisEntry(
            handCards,
            communityCards,
            state.numOpponents,
            opponentProfile
        );

        if (runId !== state.analysisRunId) return;

        if (cachedResult && runId === state.analysisRunId) {
            state.isCalculating = false;
            updateAnalyzeButton();
            state.currentWorkers = [];
            if (calculating) calculating.style.display = 'none';
            if (progressSpan) {
                progressSpan.textContent = '已命中预计算缓存';
            }
            displayResults(
                cachedResult.result,
                communityCards,
                cachedResult.numSimulations || cachedResult.result.total
            );
            return;
        }

        if (!window.Worker || plan.workerCount <= 1) {
            runSingleThreadFallback();
            return;
        }

        try {
            const workers = [];
            const results = new Array(plan.workerCount);
            const progressByWorker = new Array(plan.workerCount).fill(0);
            let completedWorkers = 0;

            const refreshProgress = () => {
                if (!progressSpan) return;
                const completed = progressByWorker.reduce((sum, value) => sum + value, 0);
                const progressPct = Math.min(99, Math.floor((completed / totalSimulations) * 100));
                progressSpan.textContent = `多线程模拟中... ${progressPct}% · ${plan.workerCount} 线程`;
            };

            for (let i = 0; i < plan.workerCount; i++) {
                const worker = new Worker('js/worker.js');
                workers.push(worker);

                worker.onmessage = function (e) {
                    if (runId !== state.analysisRunId) {
                        worker.onmessage = null;
                        worker.onerror = null;
                        worker.terminate();
                        return;
                    }

                    const data = e.data || {};
                    const workerId = Number.isInteger(data.workerId) ? data.workerId : i;
                    if (data.type === 'PROGRESS') {
                        progressByWorker[workerId] = Math.min(plan.chunks[workerId], data.completed || 0);
                        refreshProgress();
                        return;
                    }

                    if (data.type === 'DONE') {
                        progressByWorker[workerId] = plan.chunks[workerId];
                        results[workerId] = data.result;
                        completedWorkers++;
                        refreshProgress();

                        if (completedWorkers === plan.workerCount) {
                            workers.forEach((w) => {
                                w.onmessage = null;
                                w.onerror = null;
                                w.terminate();
                            });
                            finish(mergeResults(results), totalSimulations);
                        }
                    }
                };

                worker.onerror = function (error) {
                    console.error('Worker 模拟计算错误:', error);
                    reportClientError('worker-error', {
                        message: error && error.message ? error.message : 'Worker simulation failure',
                        source: 'js/worker.js'
                    });
                    if (runId !== state.analysisRunId) return;
                    if (switchedToFallback) return;

                    workers.forEach((w) => {
                        w.onmessage = null;
                        w.onerror = null;
                        w.terminate();
                    });
                    state.currentWorkers = [];
                    runSingleThreadFallback();
                };

                worker.postMessage({
                    workerId: i,
                    myHand: handCards,
                    communityCards,
                    numOpponents: state.numOpponents,
                    numSimulations: plan.chunks[i],
                    opponentProfile
                });
            }

            state.currentWorkers = workers;
            if (progressSpan) {
                progressSpan.textContent = `已启动 ${plan.workerCount} 个线程 · 共 ${totalSimulations.toLocaleString()} 次模拟`;
            }
        } catch (err) {
            console.error('无法启动 Web Worker:', err);
            state.currentWorkers = [];
            runSingleThreadFallback();
        }
    }

    // 优化3: 合并多个 Worker 的结果
    function mergeResults(results) {
        let totalWins = 0;
        let totalTies = 0;
        let totalLosses = 0;
        let totalSims = 0;
        const mergedHandDist = {};

        results.forEach(result => {
            totalWins += result.wins;
            totalTies += result.ties;
            totalLosses += result.losses;
            totalSims += result.total;

            Object.entries(result.handDistribution).forEach(([rank, data]) => {
                if (!mergedHandDist[rank]) {
                    mergedHandDist[rank] = { count: 0, percentage: 0 };
                }
                mergedHandDist[rank].count += data.count;
            });
        });

        // 重新计算百分比
        Object.keys(mergedHandDist).forEach(rank => {
            mergedHandDist[rank].percentage = (mergedHandDist[rank].count / totalSims * 100).toFixed(1);
        });

        return {
            winRate: (totalWins / totalSims * 100).toFixed(1),
            tieRate: (totalTies / totalSims * 100).toFixed(1),
            loseRate: (totalLosses / totalSims * 100).toFixed(1),
            wins: totalWins,
            ties: totalTies,
            losses: totalLosses,
            total: totalSims,
            handDistribution: mergedHandDist
        };
    }

    function renderAdvice(advice) {
        const adviceCard = getEl('adviceCard');
        const adviceEmoji = getEl('adviceEmoji');
        const adviceText = getEl('adviceText');

        if (adviceCard) {
            adviceCard.className = `advice-card ${advice.level} fade-in`;
        }
        if (adviceEmoji) adviceEmoji.innerHTML = advice.emoji;
        if (adviceText) adviceText.textContent = advice.text;
    }

    function renderDecisionPanel(decision, situation) {
        if (!state.situationEnabled || !decision) {
            hideDecisionPanel();
            return;
        }

        const panel = getEl('decisionPanel');
        const actionEl = getEl('decisionAction');
        const summaryEl = getEl('decisionSummary');
        const potOddsEl = getEl('potOddsValue');
        const requiredEl = getEl('requiredEquityValue');
        const callEvEl = getEl('callEvValue');
        const finalPotEl = getEl('finalPotValue');
        const noteEl = getEl('decisionNote');
        const opponentProfile = getOpponentProfile(situation.opponentProfile);

        if (!panel) return;

        panel.className = `decision-panel visible ${decision.level}`;
        if (actionEl) actionEl.textContent = decision.action;
        if (summaryEl) {
            summaryEl.textContent = `${situation.position} 位，对阵 ${situation.numOpponents} 位对手，范围按 ${opponentProfile.label} 估算，你的剩余积分 ${formatChips(situation.effectiveStackBB)}。`;
        }
        if (potOddsEl) potOddsEl.textContent = `${decision.potOddsPct}%`;
        if (requiredEl) requiredEl.textContent = `${decision.requiredEquityPct}%`;
        if (callEvEl) {
            const prefix = decision.callEV >= 0 ? '+' : '';
            callEvEl.textContent = `${prefix}${decision.callEVBB} 积分`;
        }
        if (finalPotEl) finalPotEl.textContent = `${decision.finalPotBB} 积分`;
        if (noteEl) noteEl.textContent = decision.note;
    }

    // ===== 显示结果 =====
    function displayResults(result, communityCards, totalSimulations) {
        vibrate('success');
        const resultContent = getEl('resultContent');
        if (resultContent) {
            resultContent.style.display = 'block';
            triggerResultReveal(resultContent);
            // 在移动端自动滚动到结果面板
            if (window.innerWidth <= 768) {
                setTimeout(() => {
                    document.querySelector('.right-column').scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
            }
        }

        // 更新 footer 显示实际模拟次数
        const footer = document.querySelector('.footer p');
        if (footer && totalSimulations) {
            footer.textContent = `基于 Monte Carlo 模拟算法 · 本次模拟 ${totalSimulations.toLocaleString()} 次 · 仅供参考学习`;
        }

        const winRate = parseFloat(result.winRate);
        const tieRate = parseFloat(result.tieRate);
        const loseRate = parseFloat(result.loseRate);
        const situation = getSituationSnapshot();
        const decision = state.situationEnabled
            ? calculateDecisionMetrics(result.winRate, situation.potSize, situation.callAmount)
            : null;

        state.lastAnalysis = {
            result,
            decision,
            situation,
            communityCount: communityCards.length
        };

        // 胜率大数字 (带数字跳动动画)
        const winRateNumber = getEl('winRateNumber');
        if (winRateNumber) {
            animateNumber(winRateNumber, 0, winRate, 800, '%');
            winRateNumber.className = 'win-rate-number count-animate';
            // 颜色等级
            if (winRate >= 70) winRateNumber.classList.add('excellent');
            else if (winRate >= 55) winRateNumber.classList.add('good');
            else if (winRate >= 45) winRateNumber.classList.add('medium');
            else if (winRate >= 35) winRateNumber.classList.add('weak');
            else winRateNumber.classList.add('bad');
        }

        // 胜/平/负条
        const winBar = getEl('winBar');
        const tieBar = getEl('tieBar');
        const loseBar = getEl('loseBar');
        const winValue = getEl('winValue');
        const tieValue = getEl('tieValue');
        const loseValue = getEl('loseValue');

        if (winBar) winBar.style.width = '0%';
        if (tieBar) tieBar.style.width = '0%';
        if (loseBar) loseBar.style.width = '0%';
        requestAnimationFrame(() => {
            if (winBar) winBar.style.width = `${winRate}%`;
            if (tieBar) tieBar.style.width = `${tieRate}%`;
            if (loseBar) loseBar.style.width = `${loseRate}%`;
        });
        if (winValue) winValue.textContent = `${result.winRate}%`;
        if (tieValue) tieValue.textContent = `${result.tieRate}%`;
        if (loseValue) loseValue.textContent = `${result.loseRate}%`;

        renderDecisionPanel(decision, situation);

        // 建议
        const advice = state.situationEnabled
            ? getAdvice(result.winRate, decision)
            : getAdvice(result.winRate);
        renderAdvice(advice);

        // 当前牌型
        const currentHandInfo = getEl('currentHandInfo');
        if (communityCards.length >= 3) {
            const handEval = evaluateCurrentHand(state.hand, communityCards);
            if (handEval && currentHandInfo) {
                currentHandInfo.style.display = 'block';
                const nameEl = getEl('currentHandName');
                const nameEnEl = getEl('currentHandNameEn');
                if (nameEl) nameEl.textContent = handEval.handName;
                if (nameEnEl) nameEnEl.textContent = handEval.handNameEn;
            }
        } else if (currentHandInfo) {
            currentHandInfo.style.display = 'none';
        }

        // 牌型分布
        renderHandDistribution(result.handDistribution);
    }

    function renderHandDistribution(distribution) {
        const container = getEl('handDistList');
        if (!container) return;

        container.innerHTML = '';

        // 按牌型等级从高到低排列
        const entries = Object.entries(distribution)
            .sort((a, b) => parseInt(b[0]) - parseInt(a[0]));

        // 找出最大的百分比（用于缩放条形图）
        let maxPct = 0;
        entries.forEach(([, data]) => {
            const pct = parseFloat(data.percentage);
            if (pct > maxPct) maxPct = pct;
        });

        entries.forEach(([rank, data]) => {
            const pct = parseFloat(data.percentage);
            const scaledWidth = maxPct > 0 ? (pct / maxPct * 100) : 0;
            const name = HAND_NAMES[rank];

            const item = document.createElement('div');
            item.className = 'hand-dist-item';
            item.innerHTML = `
                <span class="hand-dist-name">${name}</span>
                <div class="hand-dist-bar">
                    <div class="hand-dist-fill" style="width:${scaledWidth}%"></div>
                </div>
                <span class="hand-dist-pct">${data.percentage}%</span>
            `;
            container.appendChild(item);
        });
    }

    // ===== 起手牌热力图 =====
    function renderPreflopGrid() {
        const container = getEl('preflopGrid');
        if (!container) return;

        const grid = generateStartingHandGrid(state.numOpponents);
        container.innerHTML = '';

        grid.forEach(row => {
            row.forEach(cell => {
                const el = document.createElement('div');
                const tier = getTier(cell.baseWinRate);
                const isPair = cell.key.length === 2;
                el.className = `preflop-cell tier-${tier}${isPair ? ' pair' : ''}`;
                el.innerHTML = `
                    <span class="cell-label">${cell.key}</span>
                    <span class="cell-rate">${cell.winRate}%</span>
                `;

                // Tooltip
                el.onmouseenter = (e) => showTooltip(e, cell);
                el.onmousemove = (e) => moveTooltip(e);
                el.onmouseleave = () => hideTooltip();

                // 点击选中起手牌
                el.onclick = () => selectStartingHand(cell.key);

                container.appendChild(el);
            });
        });
    }

    function getTier(winRate) {
        if (winRate > 65) return 1;
        if (winRate >= 58) return 2;
        if (winRate >= 54) return 3;
        if (winRate >= 50) return 4;
        if (winRate >= 46) return 5;
        if (winRate >= 42) return 6;
        return 7;
    }

    function selectStartingHand(key) {
        // 解析起手牌 key (如 "AKs" "AKo" "AA")
        const r1Name = key[0];
        const r2Name = key.length >= 2 ? key[1] : key[0];
        const isSuited = key.endsWith('s');
        const isPair = key.length === 2;

        const toRank = (name) => {
            if (name === 'T') return 8;
            return RANK_NAMES.indexOf(name);
        };
        const r1 = toRank(r1Name);
        const r2 = toRank(r2Name);

        if (r1 === -1 || r2 === -1) return;

        // 重置当前选择
        resetAll();

        if (isPair) {
            // 配对：选择不同花色
            state.hand[0] = createCard(r1, 0); // spades
            state.hand[1] = createCard(r2, 1); // hearts
        } else if (isSuited) {
            // 同花
            state.hand[0] = createCard(r1, 0);
            state.hand[1] = createCard(r2, 0);
        } else {
            // 杂色
            state.hand[0] = createCard(r1, 0);
            state.hand[1] = createCard(r2, 1);
        }

        markPlacedSlot('hand', 0);
        markPlacedSlot('hand', 1);
        renderHandSlots();
        renderCardPicker();
        updateAnalyzeButton();
        updateStageProgress();

        // 滚动到手牌区
        const handPanel = getEl('handPanel');
        if (handPanel) handPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ===== Tooltip =====
    function showTooltip(e, cell) {
        const tooltip = getEl('tooltip');
        if (!tooltip) return;

        const ttHand = getEl('ttHand');
        const ttRate = getEl('ttRate');
        const ttType = getEl('ttType');

        if (ttHand) ttHand.textContent = cell.key;
        if (ttRate) ttRate.textContent = `胜率: ${cell.winRate}%`;
        if (ttType) {
            const isPair = cell.key.length === 2;
            const isSuited = cell.key.endsWith('s');
            ttType.textContent = isPair ? '口袋对' : (isSuited ? '同花' : '杂色');
        }

        tooltip.style.display = 'block';
        moveTooltip(e);
    }

    function moveTooltip(e) {
        const tooltip = getEl('tooltip');
        if (!tooltip) return;
        tooltip.style.left = (e.clientX + 12) + 'px';
        tooltip.style.top = (e.clientY + 12) + 'px';
    }

    function hideTooltip() {
        const tooltip = getEl('tooltip');
        if (tooltip) tooltip.style.display = 'none';
    }

    function animateClearSlots(containerId) {
        if (prefersReducedMotion()) return Promise.resolve();
        const container = getEl(containerId);
        if (!container) return Promise.resolve();

        const filledSlots = Array.from(container.querySelectorAll('.selected-card-slot.filled'));
        if (!filledSlots.length) return Promise.resolve();

        filledSlots.forEach((slot, index) => {
            setTimeout(() => slot.classList.add('is-clearing'), index * 34);
        });

        return new Promise((resolve) => {
            setTimeout(resolve, 190 + filledSlots.length * 34);
        });
    }

    // ===== 清除与重置 =====
    async function clearHand() {
        cancelAnalysis();
        await animateClearSlots('handCards');
        state.lastPlacedSlotKey = null;
        state.hand = [null, null];
        activateSlot('hand', 0);
        renderCardPicker();
        updateAnalyzeButton();
        updateStageProgress();
        invalidateAnalysisResults();
    }

    async function clearCommunity() {
        cancelAnalysis();
        await animateClearSlots('communityCards');
        state.lastPlacedSlotKey = null;
        state.community = [null, null, null, null, null];
        const visibleSlots = getVisibleCommunitySlots();
        if (visibleSlots.length > 0) {
            activateSlot('community', visibleSlots[0]);
        }
        renderCardPicker();
        updateStageCounts();
        updateStageProgress();
        invalidateAnalysisResults();
    }

    function resetAll() {
        cancelAnalysis();
        state.lastPlacedSlotKey = null;
        state.hand = [null, null];
        state.community = [null, null, null, null, null];
        state.currentStage = 'flop';
        state.activeSlotType = 'hand';
        state.activeSlotIndex = 0;
        state.numOpponents = 1;
        state.situation = {
            position: 'BTN',
            potSize: 10,
            callAmount: 5,
            effectiveStackBB: 100,
            opponentProfile: 'tag',
        };

        // 恢复 UI 状态
        const slider = /** @type {HTMLInputElement | null} */ (getEl('opponentSlider'));
        const count = getEl('opponentCount');
        if (slider) slider.value = '1';
        if (count) count.textContent = '1';
        syncSituationInputs();
        renderSituationMode();

        // 重置阶段 Tab
        document.querySelectorAll('.stage-tab').forEach(tab => {
            tab.classList.toggle('active', tab.getAttribute('data-stage') === 'flop');
        });

        const labelEl = getEl('communityLabel');
        if (labelEl) labelEl.textContent = '翻牌 - 选择3张公共牌';

        renderHandSlots();
        renderCommunitySlots();
        renderCardPicker();
        updateAnalyzeButton();
        updateStageCounts();
        updateStageProgress();
        invalidateAnalysisResults();
    }

    function hideResults() {
        const resultEmpty = getEl('resultEmpty');
        const calculating = getEl('calculating');
        const resultContent = getEl('resultContent');
        const currentHandInfo = getEl('currentHandInfo');

        if (resultEmpty) resultEmpty.style.display = 'block';
        if (calculating) calculating.style.display = 'none';
        if (resultContent) {
            resultContent.classList.remove('result-enter');
            resultContent.style.display = 'none';
        }
        if (currentHandInfo) currentHandInfo.style.display = 'none';
        hideDecisionPanel();
    }

    // ===== 动画辅助 =====
    function triggerResultReveal(container) {
        if (!container) return;
        container.classList.remove('result-enter');
        if (prefersReducedMotion()) return;
        void container.offsetWidth;
        container.classList.add('result-enter');
    }

    function animateNumber(element, start, end, duration, suffix = '') {
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            // easeOutQuart
            const easeProgress = 1 - Math.pow(1 - progress, 4);
            const current = (start + (end - start) * easeProgress).toFixed(1);

            element.textContent = `${current}${suffix}`;

            if (progress < 1) {
                window.requestAnimationFrame(step);
            } else {
                element.textContent = `${end.toFixed(1)}${suffix}`;
            }
        };
        window.requestAnimationFrame(step);
    }

    // ===== 震动反馈 (Haptic) =====
    function vibrate(type = 'light') {
        if (!navigator.vibrate) return;
        try {
            switch (type) {
                case 'light': navigator.vibrate(15); break;
                case 'medium': navigator.vibrate(30); break;
                case 'heavy': navigator.vibrate(50); break;
                case 'success': navigator.vibrate([20, 50, 20]); break;
                default: navigator.vibrate(15);
            }
        } catch (e) { }
    }

    // ===== 对手数量 =====
    function updateOpponents(n) {
        state.numOpponents = parseInt(n);
        const count = getEl('opponentCount');
        if (count) count.textContent = n;

        const preflopTitle = getEl('preflopTitle');
        if (preflopTitle) {
            preflopTitle.textContent = `起手牌强度表（翻前 · ${n}位对手）`;
        }

        renderPreflopGrid();
        if (state.lastAnalysis) {
            invalidateAnalysisResults();
        }
    }

    // ===== DeepSeek AI 策略顾问 =====
    // 接口已迁移至安全的后端 Cloudflare Pages Functions
    const AI_API_URL = '/api/chat';

    function buildAIPrompt() {
        const hand = state.hand.filter(c => c !== null).map(c =>
            `${RANK_NAMES[c.rank]}${SUIT_SYMBOLS[SUITS[c.suit]]}`
        );
        const community = state.community.filter(c => c !== null).map(c =>
            `${RANK_NAMES[c.rank]}${SUIT_SYMBOLS[SUITS[c.suit]]}`
        );
        const lastAnalysis = state.lastAnalysis;
        const situation = getSituationSnapshot();
        const opponentProfile = getOpponentProfile(situation.opponentProfile);
        const winRate = lastAnalysis ? `${lastAnalysis.result.winRate}%` : '?';
        const tieRate = lastAnalysis ? `${lastAnalysis.result.tieRate}%` : '?';
        const loseRate = lastAnalysis ? `${lastAnalysis.result.loseRate}%` : '?';
        const currentHandNameEl = getEl('currentHandName');
        const currentHandName = currentHandNameEl ? currentHandNameEl.textContent : '';
        const decision = state.situationEnabled
            ? (lastAnalysis && lastAnalysis.decision
                ? lastAnalysis.decision
                : calculateDecisionMetrics(0, situation.potSize, situation.callAmount))
            : null;
        const stageText = getStageText(community.length);
        const potSize = Math.max(0, Number(situation.potSize) || 0);
        const stack = Math.max(1, Number(situation.effectiveStackBB) || 100);
        const smallBet = (potSize * 0.33).toFixed(1);
        const midBet = (potSize * 0.6).toFixed(1);
        const largeBet = (potSize * 0.9).toFixed(1);
        const raiseToMin = (potSize + Number(smallBet)).toFixed(1);
        const raiseToMax = (potSize + Number(largeBet)).toFixed(1);
        const situationLines = state.situationEnabled
            ? `- **我的位置**: ${situation.position}
- **对手画像**: ${opponentProfile.label}（${opponentProfile.description}）
- **当前底池**: ${formatChips(situation.potSize)}
- **需跟注金额**: ${formatChips(situation.callAmount)}
- **你的剩余积分**: ${formatChips(situation.effectiveStackBB)}
- **底池赔率**: ${decision.potOddsPct}%
- **最低所需胜率**: ${decision.requiredEquityPct}%
- **简化 Call EV**: ${decision.callEVBB} 积分
- **程序建议动作**: ${decision.action}`
            : `- **牌局信息模式**: 已关闭（默认按 100BB 深码、单挑常规对抗给建议）`;

        return `你是一位世界级的德州扑克策略大师和教练。请根据以下牌局信息，给出详细的策略分析和操作建议。

## 当前牌局信息
- **我的手牌**: ${hand.join(' ')}
- **公共牌**: ${community.length > 0 ? community.join(' ') : '暂无（翻前）'}
- **当前阶段**: ${stageText}
- **对手数量**: ${state.numOpponents}人
- **模拟胜率**: 胜${winRate} / 平${tieRate} / 负${loseRate}
${situationLines}
${currentHandName ? `- **当前最佳牌型**: ${currentHandName}` : ''}
- **可参考下注尺寸（按当前底池）**:
  - 小注约 1/3 Pot: ${smallBet} 积分
  - 中注约 2/3 Pot: ${midBet} 积分
  - 大注约 90% Pot: ${largeBet} 积分
  - 进攻加注目标区间: ${raiseToMin} - ${raiseToMax} 积分
- **有效后手参考**: ${stack.toFixed(1)} 积分

## 输出要求（必须量化）
1. 请明确给出主动作：Fold / Check / Call / Bet / Raise 之一。
2. 必须给频率建议（百分比），例如“Raise 35%，Call 45%，Fold 20%”。
3. 必须给具体下注或加注尺寸（积分），并说明为何选小/中/大尺寸。
4. 必须给诈唬频率建议（总诈唬占比 + 半诈唬占比），并指出最适合诈唬的组合特征（例如阻断牌）。
5. 必须给下一街计划：被跟注后转牌或河牌怎么继续（哪些牌继续开火、哪些牌减速）。
6. 必须给 exploit 调整：针对当前对手画像如何偏离 GTO（至少2条）。
7. 明确指出风险牌面和反制点（至少2条）。

## 输出格式（严格按以下标题）
### 1) 主线决策
### 2) 下注/加注尺寸方案
### 3) 诈唬与半诈唬频率
### 4) 下一街执行计划
### 5) 对手画像 Exploit
### 6) 风险警报

请用简洁中文输出，优先引用胜率、底池赔率、EV 来支撑结论；如果信息不足，请写出你采用的假设。`;
    }

    async function askAI() {
        const btn = getEl('aiAdvisorBtn');
        const overlay = getEl('aiPanelOverlay');
        const panel = getEl('aiPanel');
        const typing = getEl('aiTyping');
        const content = getEl('aiContent');

        if (!btn || !panel) return;

        vibrate('medium');

        // 显示面板
        btn.classList.add('loading');
        overlay.style.display = 'block';
        panel.style.display = 'flex';
        typing.classList.remove('hidden');
        content.classList.remove('visible');
        content.innerHTML = '';

        // 优化5: 添加超时控制
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

        try {
            const prompt = buildAIPrompt();

            const response = await fetch(AI_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: [
                        {
                            role: 'system',
                            content: '你是高水平德州扑克教练。回答必须量化：动作频率、下注尺寸、诈唬频率、下一街计划都要给出具体数字，结论要与胜率/EV一致，输出适合手机阅读。'
                        },
                        { role: 'user', content: prompt }
                    ],
                    stream: true,
                    max_tokens: 1500,
                    temperature: 0.7,
                }),
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`API 请求失败: ${response.status}`);
            }

            // 流式读取
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';

            typing.classList.add('hidden');
            content.classList.add('visible');

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

                for (const line of lines) {
                    const data = line.slice(6);
                    if (data === '[DONE]') break;

                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta?.content || '';
                        fullText += delta;
                        content.innerHTML = simpleMarkdown(fullText);
                        // 自动滚到底
                        const body = getEl('aiPanelBody');
                        if (body) body.scrollTop = body.scrollHeight;
                    } catch (e) { }
                }
            }

            vibrate('success');

        } catch (err) {
            typing.classList.add('hidden');
            content.classList.add('visible');
            // 优化5: 区分超时错误和其他错误
            let errorMessage = '未知错误';
            if (err.name === 'AbortError') {
                errorMessage = '请求超时，请稍后重试';
            } else if (err && err.message) {
                errorMessage = err.message;
            }
            const safeMessage = escapeHTML(errorMessage);
            content.innerHTML = `<p style="color:#ef4444;">❌ AI 分析出错：${safeMessage}</p>
            <p style="color:var(--text-muted);font-size:0.85rem;">请检查网络连接和 API Key 是否正确。</p>`;
        } finally {
            clearTimeout(timeoutId);
            btn.classList.remove('loading');
        }
    }

    function closeAI() {
        const overlay = getEl('aiPanelOverlay');
        const panel = getEl('aiPanel');
        if (overlay) overlay.style.display = 'none';
        if (panel) panel.style.display = 'none';
    }

    // 简易 Markdown → HTML
    function simpleMarkdown(text) {
        const safeText = escapeHTML(text);
        return safeText
            // 标题
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/^## (.+)$/gm, '<h3>$1</h3>')
            // 加粗
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            // 行内代码
            .replace(/`(.+?)`/g, '<code>$1</code>')
            // 引用
            .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
            // 无序列表
            .replace(/^- (.+)$/gm, '<li>$1</li>')
            .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
            // 有序列表
            .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
            // 段落换行
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/^(.+)$/, '<p>$1</p>');
    }

    function escapeHTML(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ===== 公开 API =====
    return {
        init,
        activateSlot,
        filterSuit,
        switchStage,
        analyze,
        clearHand,
        clearCommunity,
        resetAll,
        updateOpponents,
        toggleSituationMode,
        updateSituationField,
        selectStartingHand,
        askAI,
        closeAI,
        quickInstall,
        installApp,
        handleInstallPrimaryAction,
        dismissInstallGuide,
    };
})();

// 页面加载后自动初始化
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
