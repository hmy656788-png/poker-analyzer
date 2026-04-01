/**
 * 德州扑克胜率分析器 - UI 交互逻辑
 * 连接 poker.js 和 simulator.js 到 HTML 界面
 */
// @ts-check
import { setupPrecompute } from './modules/precompute.js';
import { setupAIAdvisor } from './modules/ai-advisor.js';

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

    const precompute = setupPrecompute({
        isPreflopCacheEligible: typeof isPreflopCacheEligible !== 'undefined' ? isPreflopCacheEligible : window.isPreflopCacheEligible,
        normalizeOpponentProfile: typeof normalizeOpponentProfile !== 'undefined' ? normalizeOpponentProfile : window.normalizeOpponentProfile,
        getStartingHandKey: typeof getStartingHandKey !== 'undefined' ? getStartingHandKey : window.getStartingHandKey,
        DEFAULT_PREFLOP_PRECOMPUTE_TARGETS: window.DEFAULT_PREFLOP_PRECOMPUTE_TARGETS,
        buildAnalysisCacheUrl: window.buildAnalysisCacheUrl,
        ANALYSIS_CACHE_NAME
    });
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

    const aiAdvisor = setupAIAdvisor({
        state, getEl, vibrate, getStageText, formatChips, 
        calculateDecisionMetrics, getSituationSnapshot, getOpponentProfile, 
        RANK_NAMES: window.RANK_NAMES || RANK_NAMES, 
        SUIT_SYMBOLS: window.SUIT_SYMBOLS || SUIT_SYMBOLS, 
        SUITS: window.SUITS || SUITS
    });

    const installGuide = setupInstallGuide({ state, getEl });

    const askAI = aiAdvisor.askAI;
    const closeAI = aiAdvisor.closeAI;

    const initInstallGuide = installGuide.initInstallGuide;
    const quickInstall = installGuide.quickInstall;
    const installApp = installGuide.installApp;
    const handleInstallPrimaryAction = installGuide.handleInstallPrimaryAction;
    const dismissInstallGuide = installGuide.dismissInstallGuide;

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

// 确保 app 可被 HTML onclick 访问（esbuild IIFE 打包后局部变量会被重命名）
window.app = app;

// 页面加载后自动初始化
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
