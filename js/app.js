/**
 * 德州扑克胜率分析器 - UI 交互逻辑
 * 连接 poker.js 和 simulator.js 到 HTML 界面
 */
// @ts-check

const app = (() => {
    let signatureTimer = null;
    let reportedErrorCount = 0;
    const reportedErrorFingerprints = new Set();
    const APP_BUILD = '20260317';
    const ANALYSIS_CACHE_NAME = `poker-analysis-${ANALYSIS_CACHE_VERSION}`;
    const INSTALL_GUIDE_DISMISS_KEY = 'poker.installGuideDismissAt';
    const INSTALL_GUIDE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
    const HOT_HAND_USAGE_KEY = 'poker.hotPreflopUsage.v1';
    const MAX_REPORTED_ERRORS = 5;

    const precompute = typeof setupPrecompute === 'function'
        ? setupPrecompute({
            isPreflopCacheEligible: typeof isPreflopCacheEligible !== 'undefined' ? isPreflopCacheEligible : window.isPreflopCacheEligible,
            normalizeOpponentProfile: typeof normalizeOpponentProfile !== 'undefined' ? normalizeOpponentProfile : window.normalizeOpponentProfile,
            getStartingHandKey: typeof getStartingHandKey !== 'undefined' ? getStartingHandKey : window.getStartingHandKey,
            DEFAULT_PREFLOP_PRECOMPUTE_TARGETS: typeof DEFAULT_PREFLOP_PRECOMPUTE_TARGETS !== 'undefined' ? DEFAULT_PREFLOP_PRECOMPUTE_TARGETS : window.DEFAULT_PREFLOP_PRECOMPUTE_TARGETS,
            buildAnalysisCacheUrl: window.buildAnalysisCacheUrl,
            createAnalysisCacheEntry: typeof createAnalysisCacheEntry !== 'undefined' ? createAnalysisCacheEntry : window.createAnalysisCacheEntry,
            isAnalysisCacheEntryValid: typeof isAnalysisCacheEntryValid !== 'undefined' ? isAnalysisCacheEntryValid : window.isAnalysisCacheEntryValid,
            ANALYSIS_CACHE_NAME
        })
        : { recordPreflopUsage() {}, schedulePopularPrecompute() {}, readCachedAnalysisEntry() { return null; }, writeCachedAnalysisEntry() {} };
    const { recordPreflopUsage, schedulePopularPrecompute, readCachedAnalysisEntry, writeCachedAnalysisEntry } = precompute;

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

    function getCsrfToken() {
        if (typeof window.__getPokerCsrfToken === 'function') {
            return String(window.__getPokerCsrfToken() || '');
        }
        return '';
    }

    // ===== 平台检测 =====
    function detectPlatformFlags() {
        const ua = navigator.userAgent || '';
        state.isMobileDevice = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
        state.isIOSDevice = /iPhone|iPad|iPod/i.test(ua);
        state.isIOSSafari = state.isIOSDevice && /Safari/i.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS/i.test(ua);
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

    function renderSelectedCards() {
        renderHandSlots();
        renderCommunitySlots();
        renderCardPicker();
        updateAnalyzeButton();
        updateStageCounts();
        updateStageProgress();
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
        const actionButtons = getEl('actionButtons');
        const handReady = state.hand.every(c => c !== null);

        if (actionButtons) {
            actionButtons.classList.toggle('is-hidden', !handReady);
            actionButtons.hidden = !handReady;
            actionButtons.setAttribute('aria-hidden', handReady ? 'false' : 'true');
            actionButtons.style.display = handReady ? '' : 'none';
        }
        document.body.classList.toggle('hand-ready', handReady);

        if (!btn) return;
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

        // shallow clone 防止与正在运行的 analyze() 产生竞态
        const analysis = { ...state.lastAnalysis };

        if (!state.situationEnabled) {
            analysis.decision = null;
            state.lastAnalysis = analysis;
            hideDecisionPanel();
            renderAdvice(getAdvice(analysis.result.winRate));
            return;
        }

        const updatedDecision = calculateDecisionMetrics(
            analysis.result.winRate,
            state.situation.potSize,
            state.situation.callAmount
        );
        analysis.decision = updatedDecision;
        analysis.situation = getSituationSnapshot();
        state.lastAnalysis = analysis;
        renderDecisionPanel(updatedDecision, analysis.situation);
        renderAdvice(getAdvice(analysis.result.winRate, updatedDecision));
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

    // ===== Worker Pool — 复用 Worker 避免重复初始化开销 =====
    const workerPool = [];
    const WORKER_POOL_MAX = 8;

    function acquireWorker() {
        if (workerPool.length > 0) {
            return workerPool.pop();
        }
        return new Worker('js/worker.js');
    }

    function releaseWorker(worker) {
        worker.onmessage = null;
        worker.onerror = null;
        if (workerPool.length < WORKER_POOL_MAX) {
            workerPool.push(worker);
        } else {
            worker.terminate();
        }
    }

    function cancelAnalysis() {
        state.analysisRunId += 1;
        state.selectionToken += 1;
        state.isSelectingCard = false;
        state.isCalculating = false;
        // 归还所有 Worker 回池中
        if (state.currentWorkers && state.currentWorkers.length > 0) {
            state.currentWorkers.forEach(worker => {
                if (worker) releaseWorker(worker);
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
                const worker = acquireWorker();
                workers.push(worker);

                worker.onmessage = function (e) {
                    if (runId !== state.analysisRunId) {
                        releaseWorker(worker);
                        return;
                    }

                    const data = e.data || {};
                    const workerId = Number.isInteger(data.workerId) ? data.workerId : i;
                    if (data.type === 'PROGRESS') {
                        var completed = Number(data.completed);
                        progressByWorker[workerId] = Math.min(plan.chunks[workerId], Number.isFinite(completed) ? completed : 0);
                        refreshProgress();
                        return;
                    }

                    if (data.type === 'DONE') {
                        progressByWorker[workerId] = plan.chunks[workerId];
                        results[workerId] = data.result;
                        completedWorkers++;
                        refreshProgress();

                        if (completedWorkers === plan.workerCount) {
                            workers.forEach((w) => releaseWorker(w));
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
                        // 出错的 Worker 直接销毁，不回池
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
        const validResults = results.filter(r => r != null);
        if (validResults.length === 0) {
            return {
                winRate: '0.0', tieRate: '0.0', loseRate: '0.0',
                wins: 0, ties: 0, losses: 0, total: 0, handDistribution: {}
            };
        }

        let totalWins = 0;
        let totalTies = 0;
        let totalLosses = 0;
        let totalSims = 0;
        const mergedHandDist = {};

        validResults.forEach(result => {
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

        // 重新计算百分比（防御除零）
        const safeDivisor = totalSims > 0 ? totalSims : 1;
        Object.keys(mergedHandDist).forEach(rank => {
            mergedHandDist[rank].percentage = (mergedHandDist[rank].count / safeDivisor * 100).toFixed(1);
        });

        return {
            winRate: (totalWins / safeDivisor * 100).toFixed(1),
            tieRate: (totalTies / safeDivisor * 100).toFixed(1),
            loseRate: (totalLosses / safeDivisor * 100).toFixed(1),
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
        const parsed = parseInt(n, 10);
        if (isNaN(parsed) || parsed < 1 || parsed > 8) return;
        state.numOpponents = parsed;
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

    // 内联 AI 回退（当 ai-advisor.js 模块因缓存问题未加载时）
    function readInlineAIError(response) {
        return response.json()
            .then(function(data) {
                if (data && typeof data.error === 'string' && data.error.trim()) {
                    return data.error.trim();
                }
                return 'AI 服务暂时不可用';
            })
            .catch(function() {
                return 'AI 服务暂时不可用';
            });
    }

    function escapeInlineAIText(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    // Expose globally so ai-advisor.js can reuse the same escape function
    window.__escapeHTML = escapeInlineAIText;

    function formatInlineShortNumber(value) {
        var num = Number(value);
        if (!isFinite(num)) return '-';
        return Math.round(num) === num ? String(num) : num.toFixed(1).replace(/\.0$/, '');
    }

    function normalizePreflopHandKey(handKey) {
        var raw = String(handKey || '').trim();
        if (!raw) return '';
        var base = raw.slice(0, 2).toUpperCase();
        var suffix = raw.length > 2 ? raw.slice(2).toLowerCase() : '';
        return base + suffix;
    }

    function getPreflopChartBaseWinRate(handKey) {
        var normalized = normalizePreflopHandKey(handKey);
        if (!normalized) return 0;

        var chart = (typeof PREFLOP_CHART !== 'undefined' ? PREFLOP_CHART : window.PREFLOP_CHART) || {};
        var baseWinRate = Number(chart[normalized]);
        if (isFinite(baseWinRate) && baseWinRate > 0) {
            return baseWinRate;
        }

        var fallbackRate = state.lastAnalysis && state.lastAnalysis.result
            ? Number(state.lastAnalysis.result.winRate || 0)
            : 0;
        return isFinite(fallbackRate) && fallbackRate > 0 ? fallbackRate : 40;
    }

    function getPreflopRankOrder(rankChar) {
        return '23456789TJQKA'.indexOf(String(rankChar || '').toUpperCase());
    }

    function getPreflopFeatureDetails(handKey) {
        var normalized = normalizePreflopHandKey(handKey);
        if (!normalized) {
            return {
                label: '未知手牌',
                reason: '缺少手牌信息，默认先走保守线'
            };
        }

        var upperKey = normalized.toUpperCase();
        var isPair = normalized.length === 2;
        var isSuited = normalized.endsWith('s');
        var first = upperKey[0];
        var second = upperKey[1];
        var firstOrder = getPreflopRankOrder(first);
        var secondOrder = getPreflopRankOrder(second);
        var gap = Math.abs(firstOrder - secondOrder);
        var broadway = 'AKQJT';

        if (isPair) {
            if ('AKQJT'.indexOf(first) !== -1) {
                return {
                    label: '高口袋对子',
                    reason: '翻前价值高，未知位置下也有足够底气'
                };
            }
            if ('987'.indexOf(first) !== -1) {
                return {
                    label: '中口袋对子',
                    reason: '有稳定摊牌价值，也保留做暗三条的上限'
                };
            }
            return {
                label: '小口袋对子',
                reason: '更依赖位置和隐含赔率，不适合无脑做大池'
            };
        }

        if (first === 'A' && isSuited && ['2', '3', '4', '5'].indexOf(second) !== -1) {
            return {
                label: '同花轮子A',
                reason: '既有A高阻断，也保留顺同花延展性，但更吃位置'
            };
        }

        if (first === 'A' && isSuited) {
            return {
                label: '同花A高',
                reason: '高张和同花潜力兼备，翻后实现率较好'
            };
        }

        if (first === 'A' && !isSuited) {
            return {
                label: '非同花A',
                reason: '有A高阻断，但踢脚弱时翻后常被压制'
            };
        }

        if (broadway.indexOf(first) !== -1 && broadway.indexOf(second) !== -1) {
            return {
                label: isSuited ? '同花高张' : '高张组合',
                reason: isSuited
                    ? '高张覆盖面广，还能兼顾同花潜力'
                    : '高张不错，但无同花加成时更依赖位置'
            };
        }

        if (isSuited && gap === 1) {
            return {
                label: '同花连张',
                reason: '顺同花潜力好，适合有位置时入池'
            };
        }

        if (isSuited && gap === 2) {
            return {
                label: '同花一隔张',
                reason: '有一定延展性，但容错不如真正连张'
            };
        }

        if (isSuited && first === 'K') {
            return {
                label: '同花K高',
                reason: '有阻断和同花潜力，但仍属于偏位置型手牌'
            };
        }

        if (isSuited) {
            return {
                label: '同花投机牌',
                reason: '主要依赖位置与翻后兑现率，不能当强值牌打'
            };
        }

        return {
            label: '普通非同花牌',
            reason: '缺少高张和同花支撑，翻后容错较低'
        };
    }

    function getPreflopTierHint(baseTier) {
        if (baseTier <= 2) return '属于明显强档，不是单纯靠偷盲吃饭';
        if (baseTier === 3) return '是中上开局牌，但不是全位置自动打开';
        if (baseTier === 4) return '更像位置牌，不能只看单挑胜率';
        if (baseTier === 5) return '偏边缘，主要靠后位和弃牌率挣钱';
        return '单挑胜率不等于真实开局价值';
    }

    function buildDefaultPreflopAdviceText() {
        var handKey = '';
        if (state.hand[0] && state.hand[1] && typeof getStartingHandKey === 'function') {
            try {
                handKey = normalizePreflopHandKey(getStartingHandKey(state.hand[0], state.hand[1]) || '');
            } catch (error) {
                handKey = '';
            }
        }

        if (!handKey) return '';

        var opponents = Math.max(1, Number(state.numOpponents) || 1);
        var baseWinRate = getPreflopChartBaseWinRate(handKey);
        var simulatedWinRate = state.lastAnalysis && state.lastAnalysis.result
            ? Number(state.lastAnalysis.result.winRate || 0)
            : baseWinRate;
        var baseTier = getTier(baseWinRate);
        var tableTightening = opponents >= 6 ? 2 : (opponents >= 3 ? 1 : 0);
        var effectiveTier = Math.min(7, baseTier + tableTightening);
        var feature = getPreflopFeatureDetails(handKey);

        var summaryLine = '';
        var positionLine = '';
        var multiwayLine = '';
        var reactionLine = '';

        if (effectiveTier <= 2) {
            summaryLine = opponents === 1
                ? '核心结论: 这手牌在单挑无人入池里属于明确价值开局'
                : '核心结论: 这手牌整体偏强，多数位置都能考虑首入池';
            positionLine = opponents >= 6
                ? '位置建议: 满桌前位正常开，中后位可以更主动拿先手'
                : '位置建议: 未知位置下多数位置可开，前位别夸张加频';
            multiwayLine = opponents === 1
                ? '多人修正: 如果从单挑变成多家底池，仍有价值，但别无脑把池子做太大'
                : '多人修正: 对手越多越要尊重实现率，翻后更依赖位置兑现优势';
            reactionLine = '若遇反击: 小中码 3bet 通常可继续，超大尺度或无位置再收紧';
        } else if (effectiveTier === 3) {
            summaryLine = '核心结论: 这手牌能开，但更像中后位优先的稳健开局';
            positionLine = '位置建议: HJ/CO/BTN 更舒服，UTG/MP 默认别放太宽';
            multiwayLine = '多人修正: 人数一多就不再是自动价值开局，要更看位置和桌况';
            reactionLine = '若遇反击: 默认别轻易 4bet，位置差或大尺度 3bet 多弃';
        } else if (effectiveTier === 4) {
            summaryLine = '核心结论: 这手牌更像位置型 open，不适合未知位置硬开';
            positionLine = '位置建议: 以 CO/BTN 为主，SB 选择性入池，前位多数收紧';
            multiwayLine = '多人修正: 桌上人越多，这类牌越容易在翻后被压制或难兑现';
            reactionLine = '若遇反击: 对 3bet 偏保守，未知对手大多数直接弃牌';
        } else if (effectiveTier === 5) {
            summaryLine = '核心结论: 这手牌已经偏边缘，主要靠后位偷盲赚取主动权';
            positionLine = '位置建议: BTN 最好，CO 偶尔可以，其他位置默认不主动打开';
            multiwayLine = '多人修正: 一旦不是清爽单挑环境，这类牌的真实盈利会继续下降';
            reactionLine = '若遇反击: 被 3bet 大多直接放弃，不拿边缘牌硬扛';
        } else {
            summaryLine = '核心结论: 这手牌在未知位置和未知动作下默认偏弃牌';
            positionLine = '位置建议: 除非你明确在按钮位偷盲且盲位很弱，否则不建议打开';
            multiwayLine = '多人修正: 这类牌最怕多人池和被跟多家，翻后容错会很差';
            reactionLine = '若遇反击: 这类牌在无信息时应直接收手，不建议继续纠缠';
        }

        var sizeLine = opponents <= 2
            ? '开局尺寸: 未知位置先按2.2-2.5BB'
            : (opponents <= 5 ? '开局尺寸: 未知位置先按2.3-2.6BB' : '开局尺寸: 满桌更接近2.5BB');
        var rateLine = '牌力依据: ' + handKey + ' 单挑基准约' + formatInlineShortNumber(baseWinRate) + '%，' + getPreflopTierHint(baseTier);
        if (opponents > 1 && isFinite(simulatedWinRate) && simulatedWinRate > 0 && Math.abs(simulatedWinRate - baseWinRate) >= 1) {
            rateLine += '；当前' + opponents + '人局约' + formatInlineShortNumber(simulatedWinRate) + '%';
        }
        var featureLine = '手牌特点: ' + feature.label + '，' + feature.reason;
        var noteLine = '补充说明: 现在是默认 100BB 无人入池建议；若前面已经有人 limp/raise，请开启牌局信息看精确回答';

        return [
            summaryLine,
            positionLine,
            sizeLine,
            rateLine,
            featureLine,
            multiwayLine,
            reactionLine,
            noteLine
        ].join('\n');
    }

    function readInlineAIAdviceCache(cacheKey) {
        try {
            var raw = localStorage.getItem('poker.inlineAiAdviceCache.v7');
            if (!raw) return '';
            var store = JSON.parse(raw);
            var entry = store[cacheKey];
            if (!entry) return '';
            if (!entry.ts || Date.now() - entry.ts > 6 * 60 * 60 * 1000) return '';
            return typeof entry.text === 'string' ? entry.text : '';
        } catch (error) {
            return '';
        }
    }

    function writeInlineAIAdviceCache(cacheKey, text) {
        try {
            var raw = localStorage.getItem('poker.inlineAiAdviceCache.v7');
            var store = raw ? JSON.parse(raw) : {};
            store[cacheKey] = { text: String(text || ''), ts: Date.now() };
            var entries = Object.entries(store).sort(function(a, b) {
                return (b[1] && b[1].ts ? b[1].ts : 0) - (a[1] && a[1].ts ? a[1].ts : 0);
            }).slice(0, 40);
            var nextStore = {};
            entries.forEach(function(entry) {
                nextStore[entry[0]] = entry[1];
            });
            localStorage.setItem('poker.inlineAiAdviceCache.v7', JSON.stringify(nextStore));
        } catch (error) {
            // ignore cache persistence failures
        }
    }

    function renderInlineAIText(text) {
        var html = escapeInlineAIText(text)
            .replace(/^([^\n：:]{2,14}[：:])/gm, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
        return '<p>' + html + '</p>';
    }

    function revealInlineAIText(text, content, typing) {
        var finalText = String(text || '');

        if (typing) typing.classList.add('hidden');
        if (!content) return Promise.resolve(finalText);
        content.classList.add('visible');

        if (!finalText.trim()) {
            content.innerHTML = '';
            return Promise.resolve(finalText);
        }

        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            content.innerHTML = renderInlineAIText(finalText);
            return Promise.resolve(finalText);
        }

        var segments = [];
        var buffer = '';
        for (var i = 0; i < finalText.length; i += 1) {
            var ch = finalText[i];
            buffer += ch;
            if (ch === '\n' || '。！？；：,.!?'.indexOf(ch) !== -1 || buffer.length >= 18) {
                segments.push(buffer);
                buffer = '';
            }
        }
        if (buffer) segments.push(buffer);

        if (segments.length <= 1) {
            content.innerHTML = renderInlineAIText(finalText);
            return Promise.resolve(finalText);
        }

        var totalChars = finalText.length;
        var burst = totalChars > 260 ? 3 : (totalChars > 160 ? 2 : 1);
        var delay = totalChars > 260 ? 28 : (totalChars > 160 ? 40 : 55);

        return new Promise(function(resolve) {
            var index = 0;
            var rendered = '';

            function step() {
                var count = 0;
                while (index < segments.length && count < burst) {
                    rendered += segments[index];
                    index += 1;
                    count += 1;
                }

                content.innerHTML = renderInlineAIText(rendered);
                var body = getEl('aiPanelBody');
                if (body) body.scrollTop = body.scrollHeight;

                if (index < segments.length) {
                    window.setTimeout(step, delay);
                    return;
                }

                resolve(finalText);
            }

            step();
        });
    }

    function inlineFallbackAskAI() {
        var overlay = getEl('aiPanelOverlay');
        var panel = getEl('aiPanel');
        var typing = getEl('aiTyping');
        var content = getEl('aiContent');
        var button = getEl('aiAdvisorBtn');
        if (!panel) return;
        if (overlay) overlay.style.display = 'block';
        panel.style.display = 'flex';
        if (typing) typing.classList.remove('hidden');
        if (content) { content.classList.remove('visible'); content.innerHTML = ''; }
        if (button) button.classList.add('loading');

        var handDesc = state.hand.filter(Boolean).map(function(c) {
            var rn = (typeof RANK_NAMES !== 'undefined' ? RANK_NAMES : window.RANK_NAMES) || [];
            var ss = (typeof SUIT_SYMBOLS !== 'undefined' ? SUIT_SYMBOLS : window.SUIT_SYMBOLS) || {};
            return (rn[c.rank] || c.rank) + (ss[c.suit] || '');
        }).join(' ') || '未选择';
        var boardDesc = state.community.filter(Boolean).map(function(c) {
            var rn = (typeof RANK_NAMES !== 'undefined' ? RANK_NAMES : window.RANK_NAMES) || [];
            var ss = (typeof SUIT_SYMBOLS !== 'undefined' ? SUIT_SYMBOLS : window.SUIT_SYMBOLS) || {};
            return (rn[c.rank] || c.rank) + (ss[c.suit] || '');
        }).join(' ') || '暂无公共牌';
        var winRateDesc = state.lastAnalysis && state.lastAnalysis.result
            ? ('胜' + state.lastAnalysis.result.winRate + '% / 平' + state.lastAnalysis.result.tieRate + '% / 负' + state.lastAnalysis.result.loseRate + '%')
            : '暂无模拟结果';
        var decision = state.situationEnabled
            ? (state.lastAnalysis && state.lastAnalysis.decision
                ? state.lastAnalysis.decision
                : calculateDecisionMetrics(0, state.situation.potSize, state.situation.callAmount))
            : null;
        var boardTextureLabelEl = getEl('textureLabel');
        var boardTextureScoreEl = getEl('textureScore');
        var boardTexture = state.community.filter(Boolean).length >= 3
            ? (((boardTextureLabelEl && boardTextureLabelEl.textContent) || '').trim() + ' ' + (((boardTextureScoreEl && boardTextureScoreEl.textContent) || '').trim())).trim()
            : '';
        var currentHandNameEl = getEl('currentHandName');
        var currentHandName = currentHandNameEl && currentHandNameEl.textContent ? currentHandNameEl.textContent.trim() : '未成牌';
        var handKey = '';
        if (state.hand[0] && state.hand[1] && typeof getStartingHandKey === 'function') {
            try {
                handKey = getStartingHandKey(state.hand[0], state.hand[1]) || '';
            } catch (error) {
                handKey = '';
            }
        }
        var potSize = Math.max(0, Number(state.situation.potSize) || 0);
        var stack = Math.max(1, Number(state.situation.effectiveStackBB) || 100);
        var spr = potSize > 0 ? (stack / potSize).toFixed(1) : '-';
        var smallBet = formatInlineShortNumber(potSize * 0.33);
        var midBet = formatInlineShortNumber(potSize * 0.6);
        var largeBet = formatInlineShortNumber(potSize * 0.9);
        var boardCount = state.community.filter(Boolean).length;
        var promptVersion = '20260404-detail-1';
        var mode = state.situationEnabled
            ? 'decision'
            : (boardCount === 0 ? 'preflop-default' : 'postflop-default');
        var situationSummary = state.situationEnabled
            ? ('位置:' + state.situation.position + ' | 底池:' + formatInlineShortNumber(state.situation.potSize) + ' | 跟注:' + formatInlineShortNumber(state.situation.callAmount) + ' | 后手:' + formatInlineShortNumber(state.situation.effectiveStackBB) + ' | SPR:' + spr + ' | 画像:' + state.situation.opponentProfile)
            : '模式:默认100BB';
        var coreFacts = '阶段:' + getStageText(boardCount) + ' | 手牌简称:' + (handKey || '-') + ' | 手牌:' + handDesc + ' | 公牌:' + boardDesc + ' | 对手:' + state.numOpponents + ' | 当前牌型:' + currentHandName;
        var ratesLine = '胜平负:' + winRateDesc.replace(/胜|平|负/g, '').replace(/ \/ /g, '/');
        var supportFacts = [];
        var preflopBaseline = mode === 'preflop-default' ? buildDefaultPreflopAdviceText() : '';
        if (mode !== 'preflop-default' && potSize > 0) {
            supportFacts.push('可选尺寸:' + smallBet + '/' + midBet + '/' + largeBet);
        }
        if (boardTexture) supportFacts.push('牌面:' + boardTexture);
        var supportLine = supportFacts.join(' | ');
        var prompt;


        if (mode === 'preflop-default') {
            prompt = [
                '按固定格式快答。',
                coreFacts,
                ratesLine,
                preflopBaseline ? ('本地基线:' + preflopBaseline.replace(/\n/g, ' | ')) : '',
                '上下文:未知位置、未知前人动作、默认100BB无人入池(open pot)',
                '规则:不要输出面对下注后的弃牌/跟注结论；若对手数=1且翻前胜率明显高于50%，通常不应给纯弃牌。',
                '输出:1核心结论 2推荐开局 3位置建议 4开局尺寸 5牌力档次 6手牌特点 7多人修正 8若遇3bet 9翻后重点 10补充说明',
                '限制:每行1到2短句,总字数<=520字'
            ].filter(Boolean).join('\n');
        } else if (mode === 'postflop-default') {
            prompt = [
                '按固定格式快答。',
                coreFacts,
                ratesLine,
                supportLine,
                '上下文:未提供底池赔率/跟注金额/对手下注尺度，仅能给默认打法',
                '规则:不要输出纯弃牌/纯跟注百分比；应给默认打法、尺寸和转牌计划。',
                '输出:1牌力定位 2默认打法 3推荐尺寸 4为什么这样打 5听牌/阻断 6危险转牌 7转牌计划 8河牌计划 9若遭加压 10最大风险',
                '限制:每行1到2短句,总字数<=560字'
            ].filter(Boolean).join('\n');
        } else {
            prompt = [
                '按固定格式快答。',
                coreFacts,
                ratesLine,
                situationSummary,
                (decision
                    ? ('跟注赔率:' + decision.potOddsPct + '% | 继续门槛:' + decision.requiredEquityPct + '% | CallEV:' + decision.callEVBB + ' | 程序建议:' + decision.action)
                    : '模式:默认100BB'),
                supportLine,
                '规则:围绕继续门槛、跟注赔率与CallEV作答，不要把继续门槛说成加注门槛。',
                '输出:1核心结论 2推荐动作 3推荐尺寸 4赔率与门槛 5CallEV解读 6牌力定位 7牌面纹理/阻断 8下一街计划 9若遭反击 10最大风险',
                '限制:每行1到2短句,总字数<=560字'
            ].filter(Boolean).join('\n');
        }
        var cacheKey = JSON.stringify({
            v: 8,
            promptVersion: promptVersion,
            mode: mode,
            hand: handDesc,
            board: boardDesc,
            opponents: state.numOpponents,
            rates: winRateDesc,
            situation: situationSummary,
            decision: decision ? (decision.action + '|' + decision.potOddsPct + '|' + decision.requiredEquityPct + '|' + decision.callEVBB) : '',
            handName: currentHandName,
            boardTexture: boardTexture,
            handKey: handKey
        });
        var cachedAdvice = readInlineAIAdviceCache(cacheKey);
        if (cachedAdvice) {
            if (button) button.classList.add('loading');
            return revealInlineAIText(cachedAdvice, content, typing)
                .finally(function() {
                    if (button) button.classList.remove('loading');
                });
        }
        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        var timeoutId = setTimeout(function() {
            if (controller) controller.abort();
        }, 18000);

        fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Poker-Request': 'ai-advisor-inline',
                'X-CSRF-Token': getCsrfToken()
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    {
                        role: 'system',
                        content: mode === 'decision'
                            ? '你是严谨的德州扑克顾问。只能依据给定数据回答，不虚构历史动作、弃牌率或读牌。当前模式已给出底池、跟注金额和程序建议，你必须优先围绕继续门槛、跟注赔率、CallEV、SPR、牌力/听牌、牌面纹理给结论，不能把继续门槛说成加注门槛。严格输出10行：核心结论、推荐动作、推荐尺寸、赔率与门槛、CallEV解读、牌力定位、牌面纹理/阻断、下一街计划、若遭反击、最大风险。每行1到2短句，总字数不超过560字。'
                            : (mode === 'preflop-default'
                                ? '你是严谨的德州扑克翻前顾问。只能依据给定数据回答，不虚构前人动作。若未提供动作历史，默认按100BB无人入池(open pot)处理，给标准开局建议，不要把建议写成面对下注后的弃牌/跟注结论。严格输出10行：核心结论、推荐开局、位置建议、开局尺寸、牌力档次、手牌特点、多人修正、若遇3bet、翻后重点、补充说明。每行1到2短句，总字数不超过520字。'
                                : '你是严谨的德州扑克翻后顾问。只能依据给定数据回答，不虚构对手下注或历史动作。若未提供跟注金额，只能给默认打法与优先尺寸/控池计划，不要输出纯弃牌/纯跟注百分比。严格输出10行：牌力定位、默认打法、推荐尺寸、为什么这样打、听牌/阻断、危险转牌、转牌计划、河牌计划、若遭加压、最大风险。每行1到2短句，总字数不超过560字。')
                    },
                    { role: 'user', content: prompt }
                ],
                stream: false,
                max_tokens: mode === 'decision' ? 760 : 680,
                temperature: mode === 'decision' ? 0.16 : 0.13
            }),
            signal: controller ? controller.signal : undefined
        })
        .then(function(r) {
            if (!r.ok) {
                return readInlineAIError(r).then(function(message) {
                    throw new Error(message);
                });
            }
            return r.json();
        })
        .then(function(data) {
            if (content) {
                var text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '无响应';
                writeInlineAIAdviceCache(cacheKey, text);
                return revealInlineAIText(text, content, typing);
            }
            if (typing) typing.classList.add('hidden');
            return null;
        })
        .catch(function(err) {
            if (typing) typing.classList.add('hidden');
            if (content) {
                content.classList.add('visible');
                var fallbackText = mode === 'preflop-default' ? buildDefaultPreflopAdviceText() : '';
                if (fallbackText) {
                    content.innerHTML = renderInlineAIText(fallbackText);
                    return;
                }
                var message = err && err.name === 'AbortError'
                    ? '请求超时，请稍后重试'
                    : (err && err.message ? err.message : err);
                content.innerHTML = '<p style="color:#ef4444;">❌ AI 请求失败：' + escapeInlineAIText(String(message || '未知错误')).slice(0, 300) + '</p>';
            }
        })
        .finally(function() {
            clearTimeout(timeoutId);
            if (button) button.classList.remove('loading');
        });
    }
    function inlineFallbackCloseAI() {
        var overlay = getEl('aiPanelOverlay');
        var panel = getEl('aiPanel');
        if (overlay) overlay.style.display = 'none';
        if (panel) panel.style.display = 'none';
    }

    const embeddedBrowserPattern = /MicroMessenger|QQ\/|QQBrowser|MetaSr|WebView/i;
    const shouldUseInlineAIAdvisor = embeddedBrowserPattern.test(navigator.userAgent || '') || typeof setupAIAdvisor !== 'function';

    const aiAdvisor = !shouldUseInlineAIAdvisor
        ? setupAIAdvisor({
            state, getEl, vibrate, getStageText, formatChips, 
            calculateDecisionMetrics, getSituationSnapshot, getOpponentProfile, 
            buildDefaultPreflopAdviceText,
            RANK_NAMES: window.RANK_NAMES || RANK_NAMES, 
            SUIT_SYMBOLS: window.SUIT_SYMBOLS || SUIT_SYMBOLS, 
            SUITS: window.SUITS || SUITS
        })
        : { askAI: inlineFallbackAskAI, closeAI: inlineFallbackCloseAI };

    const installGuide = typeof setupInstallGuide === 'function'
        ? setupInstallGuide({ state, getEl })
        : { initInstallGuide() {}, quickInstall() {}, installApp() {}, handleInstallPrimaryAction() {}, dismissInstallGuide() {} };

    const askAI = aiAdvisor.askAI;
    const closeAI = aiAdvisor.closeAI;

    const initInstallGuide = installGuide.initInstallGuide;
    const quickInstall = installGuide.quickInstall;
    const installApp = installGuide.installApp;
    const handleInstallPrimaryAction = installGuide.handleInstallPrimaryAction;
    const dismissInstallGuide = installGuide.dismissInstallGuide;
    const openScanner = function(target) {
        if (window.__scannerAPI && typeof window.__scannerAPI.openScanner === 'function') {
            return window.__scannerAPI.openScanner(target);
        }
    };
    const closeScanner = function() {
        if (window.__scannerAPI && typeof window.__scannerAPI.closeScanner === 'function') {
            return window.__scannerAPI.closeScanner();
        }
    };
    const captureAndScan = function() {
        if (window.__scannerAPI && typeof window.__scannerAPI.captureAndScan === 'function') {
            return window.__scannerAPI.captureAndScan();
        }
    };

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
        openScanner,
        closeScanner,
        captureAndScan,
        __getInternalState: function() { return state; },
        __renderSelectedCards: renderSelectedCards,
        __analyze: analyze,
    };
})();

// 确保 app 可被 HTML onclick 访问（esbuild IIFE 打包后局部变量会被重命名）
window.app = Object.assign(window.app || {}, app);

// 桥接 scanner API（scanner.js 先于 app.js 加载，方法暂存在 window.__scannerAPI）
if (window.__scannerAPI) {
    Object.assign(window.app, window.__scannerAPI);
}

// 页面加载后自动初始化
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
