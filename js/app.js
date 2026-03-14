/**
 * 德州扑克胜率分析器 - UI 交互逻辑
 * 连接 poker.js 和 simulator.js 到 HTML 界面
 */

const app = (() => {
    // ===== 状态管理 =====
    const state = {
        hand: [null, null],          // 2张手牌
        community: [null, null, null, null, null], // 5张公共牌
        activeSlotType: 'hand',      // 当前激活的槽位类型: 'hand' | 'community'
        activeSlotIndex: 0,          // 当前激活的槽位索引
        currentStage: 'flop',        // 公共牌阶段: 'flop' | 'turn' | 'river'
        numOpponents: 1,
        suitFilter: [true, true, true, true], // 花色过滤器 [spades, hearts, diamonds, clubs]
        isCalculating: false,
        currentWorkers: [],          // 优化3: 支持多个 Worker
        analysisRunId: 0,
    };

    // ===== 初始化 =====
    function init() {
        renderCardPicker();
        renderPreflopGrid();
        updateAnalyzeButton();
        updateStageCounts();
        updateStageProgress();
    }

    // ===== 扑克牌选择器 =====
    function renderCardPicker() {
        const container = document.getElementById('cardPicker');
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

    // ===== 选牌逻辑 =====
    function selectCard(rank, suit) {
        const card = createCard(rank, suit);
        if (isCardSelected(card)) return;

        vibrate('light');
        const { activeSlotType, activeSlotIndex } = state;

        if (activeSlotType === 'hand') {
            state.hand[activeSlotIndex] = card;
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
            renderCommunitySlots();
            // 自动推进到下一个空公共牌位
            const nextEmpty = visibleSlots.find(i => state.community[i] === null);
            if (nextEmpty !== undefined) {
                activateSlot('community', nextEmpty);
            } else if (state.currentStage === 'river') {
                // 回河牌阶段最后一张牌填满时，自动触发分析！
                setTimeout(() => {
                    const btn = document.getElementById('analyzeBtn');
                    if (btn && !btn.disabled) btn.click();
                }, 300);
            }
        }

        renderCardPicker();
        updateAnalyzeButton();
        updateStageCounts();
        updateStageProgress();
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

    function renderHandSlots() {
        const container = document.getElementById('handCards');
        if (!container) return;

        container.innerHTML = '';
        for (let i = 0; i < 2; i++) {
            const card = state.hand[i];
            const isActive = state.activeSlotType === 'hand' && state.activeSlotIndex === i;

            if (card) {
                const suitName = SUITS[card.suit];
                const el = document.createElement('div');
                el.className = `selected-card-slot filled${isActive ? ' active-slot' : ''}`;
                el.innerHTML = `
                    <div class="poker-card ${suitName}">
                        <span class="rank">${RANK_NAMES[card.rank]}</span>
                        <span class="suit">${SUIT_SYMBOLS[suitName]}</span>
                    </div>
                `;
                el.onclick = () => {
                    // 点击已选的牌 → 移除它
                    vibrate('light');
                    state.hand[i] = null;
                    activateSlot('hand', i);
                    renderCardPicker();
                    updateAnalyzeButton();
                    updateStageProgress();
                };
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
        const container = document.getElementById('communityCards');
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
                el.className = `selected-card-slot filled${isActive ? ' active-slot' : ''}`;
                el.innerHTML = `
                    <div class="poker-card ${suitName}">
                        <span class="rank">${RANK_NAMES[card.rank]}</span>
                        <span class="suit">${SUIT_SYMBOLS[suitName]}</span>
                    </div>
                `;
                el.onclick = () => {
                    vibrate('light');
                    state.community[i] = null;
                    activateSlot('community', i);
                    renderCardPicker();
                    updateAnalyzeButton();
                    updateStageCounts();
                    updateStageProgress();
                };
            } else {
                el.className = `selected-card-slot${isActive ? ' active-slot' : ''}`;
                el.textContent = '+';
                el.onclick = () => activateSlot('community', i);
            }

            container.appendChild(el);
        }
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
            tab.classList.toggle('active', tab.dataset.stage === stage);
        });

        // 更新标签文案
        const labels = { flop: '翻牌 - 选择3张公共牌', turn: '转牌 - 选择第4张', river: '河牌 - 选择第5张' };
        const labelEl = document.getElementById('communityLabel');
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

        const flopEl = document.getElementById('flopCount');
        const turnEl = document.getElementById('turnCount');
        const riverEl = document.getElementById('riverCount');

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
        const btn = document.getElementById('analyzeBtn');
        if (!btn) return;
        const handReady = state.hand.every(c => c !== null);
        btn.disabled = !handReady || state.isCalculating;
    }

    function cancelAnalysis() {
        state.analysisRunId += 1;
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

    // ===== 模拟分析 =====
    function analyze() {
        const handReady = state.hand.every(c => c !== null);
        if (!handReady || state.isCalculating) return;

        const runId = state.analysisRunId + 1;
        state.analysisRunId = runId;
        state.isCalculating = true;
        updateAnalyzeButton();

        // 显示加载状态
        const resultEmpty = document.getElementById('resultEmpty');
        const calculating = document.getElementById('calculating');
        const resultContent = document.getElementById('resultContent');

        if (resultEmpty) resultEmpty.style.display = 'none';
        if (calculating) {
            calculating.style.display = 'flex';
            // 添加一个用于显示进度的元素
            let progressSpan = calculating.querySelector('.progress-text');
            if (!progressSpan) {
                progressSpan = document.createElement('span');
                progressSpan.className = 'progress-text';
                progressSpan.style.marginTop = '8px';
                progressSpan.style.color = 'var(--accent-gold)';
                progressSpan.style.fontSize = '0.9rem';
                calculating.appendChild(progressSpan);
            }
            progressSpan.textContent = '准备启动计算引擎...';
        }
        if (resultContent) resultContent.style.display = 'none';

        // 收集公共牌
        const communityCards = state.community.filter(c => c !== null);

        // 优化20: 使用智能模拟次数
        const totalSimulations = getSmartSimulationCount(communityCards.length, state.numOpponents);

        // 优化3: 使用多个 Web Worker 进行并行计算
        try {
            const numWorkers = Math.min(navigator.hardwareConcurrency || 4, 4); // 最多4个 Worker
            const simulationsPerWorker = Math.floor(totalSimulations / numWorkers);
            const workers = [];
            const results = [];
            let completedWorkers = 0;

            for (let i = 0; i < numWorkers; i++) {
                const worker = new Worker('js/worker.js');
                workers.push(worker);

                worker.onmessage = function (e) {
                    if (runId !== state.analysisRunId) {
                        // 优化6: 清理事件监听器
                        worker.onmessage = null;
                        worker.onerror = null;
                        worker.terminate();
                        return;
                    }
                    const data = e.data;
                    if (data.type === 'PROGRESS') {
                        const progressSpan = calculating.querySelector('.progress-text');
                        if (progressSpan) {
                            const avgProgress = Math.floor((completedWorkers * 100 + data.progress) / numWorkers);
                            progressSpan.textContent = `深度模拟中... ${avgProgress}%`;
                        }
                    } else if (data.type === 'DONE') {
                        results[i] = data.result;
                        completedWorkers++;

                        if (completedWorkers === numWorkers) {
                            // 合并所有 Worker 的结果
                            const mergedResult = mergeResults(results);
                            state.isCalculating = false;
                            state.currentWorkers = [];
                            updateAnalyzeButton();
                            if (calculating) calculating.style.display = 'none';

                            displayResults(mergedResult, communityCards, totalSimulations);

                            // 优化6: 清理所有 Worker
                            workers.forEach(w => {
                                w.onmessage = null;
                                w.onerror = null;
                                w.terminate();
                            });
                        }
                    }
                };

                worker.onerror = function (error) {
                    console.error('Worker 模拟计算错误:', error);
                    if (runId !== state.analysisRunId) return;
                    state.isCalculating = false;
                    state.currentWorkers = [];
                    updateAnalyzeButton();
                    if (calculating) calculating.style.display = 'none';
                    // 优化6: 清理所有 Worker
                    workers.forEach(w => {
                        w.onmessage = null;
                        w.onerror = null;
                        w.terminate();
                    });
                };

                // 发送计算指令给 Web Worker
                worker.postMessage({
                    myHand: state.hand,
                    communityCards: communityCards,
                    numOpponents: state.numOpponents,
                    numSimulations: simulationsPerWorker
                });
            }

            state.currentWorkers = workers;

        } catch (err) {
            console.error('无法启动 Web Worker:', err);
            state.currentWorkers = [];
            // 降级回退到同步计算
            setTimeout(() => {
                if (runId !== state.analysisRunId) return;
                const result = simulate(state.hand, communityCards, state.numOpponents, 5000);
                state.isCalculating = false;
                updateAnalyzeButton();
                if (calculating) calculating.style.display = 'none';
                displayResults(result, communityCards, 5000);
            }, 50);
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

    // ===== 显示结果 =====
    function displayResults(result, communityCards, totalSimulations) {
        vibrate('success');
        const resultContent = document.getElementById('resultContent');
        if (resultContent) {
            resultContent.style.display = 'block';
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

        // 胜率大数字 (带数字跳动动画)
        const winRateNumber = document.getElementById('winRateNumber');
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
        const winBar = document.getElementById('winBar');
        const tieBar = document.getElementById('tieBar');
        const loseBar = document.getElementById('loseBar');
        const winValue = document.getElementById('winValue');
        const tieValue = document.getElementById('tieValue');
        const loseValue = document.getElementById('loseValue');

        if (winBar) winBar.style.width = `${winRate}%`;
        if (tieBar) tieBar.style.width = `${tieRate}%`;
        if (loseBar) loseBar.style.width = `${loseRate}%`;
        if (winValue) winValue.textContent = `${result.winRate}%`;
        if (tieValue) tieValue.textContent = `${result.tieRate}%`;
        if (loseValue) loseValue.textContent = `${result.loseRate}%`;

        // 建议
        const advice = getAdvice(result.winRate);
        const adviceCard = document.getElementById('adviceCard');
        const adviceEmoji = document.getElementById('adviceEmoji');
        const adviceText = document.getElementById('adviceText');

        if (adviceCard) {
            adviceCard.className = `advice-card ${advice.level} fade-in`;
        }
        if (adviceEmoji) adviceEmoji.textContent = advice.emoji;
        if (adviceText) adviceText.textContent = advice.text;

        // 当前牌型
        const currentHandInfo = document.getElementById('currentHandInfo');
        if (communityCards.length >= 3) {
            const handEval = evaluateCurrentHand(state.hand, communityCards);
            if (handEval && currentHandInfo) {
                currentHandInfo.style.display = 'block';
                const nameEl = document.getElementById('currentHandName');
                const nameEnEl = document.getElementById('currentHandNameEn');
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
        const container = document.getElementById('handDistList');
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
        const container = document.getElementById('preflopGrid');
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

        renderHandSlots();
        renderCardPicker();
        updateAnalyzeButton();
        updateStageProgress();

        // 滚动到手牌区
        const handPanel = document.getElementById('handPanel');
        if (handPanel) handPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ===== Tooltip =====
    function showTooltip(e, cell) {
        const tooltip = document.getElementById('tooltip');
        if (!tooltip) return;

        const ttHand = document.getElementById('ttHand');
        const ttRate = document.getElementById('ttRate');
        const ttType = document.getElementById('ttType');

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
        const tooltip = document.getElementById('tooltip');
        if (!tooltip) return;
        tooltip.style.left = (e.clientX + 12) + 'px';
        tooltip.style.top = (e.clientY + 12) + 'px';
    }

    function hideTooltip() {
        const tooltip = document.getElementById('tooltip');
        if (tooltip) tooltip.style.display = 'none';
    }

    // ===== 清除与重置 =====
    function clearHand() {
        cancelAnalysis();
        state.hand = [null, null];
        activateSlot('hand', 0);
        renderCardPicker();
        updateAnalyzeButton();
        updateStageProgress();
        hideResults();
    }

    function clearCommunity() {
        cancelAnalysis();
        state.community = [null, null, null, null, null];
        const visibleSlots = getVisibleCommunitySlots();
        if (visibleSlots.length > 0) {
            activateSlot('community', visibleSlots[0]);
        }
        renderCardPicker();
        updateStageCounts();
        updateStageProgress();
        hideResults();
    }

    function resetAll() {
        cancelAnalysis();
        state.hand = [null, null];
        state.community = [null, null, null, null, null];
        state.currentStage = 'flop';
        state.activeSlotType = 'hand';
        state.activeSlotIndex = 0;
        state.numOpponents = 1;

        // 恢复 UI 状态
        const slider = document.getElementById('opponentSlider');
        const count = document.getElementById('opponentCount');
        if (slider) slider.value = 1;
        if (count) count.textContent = '1';

        // 重置阶段 Tab
        document.querySelectorAll('.stage-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.stage === 'flop');
        });

        const labelEl = document.getElementById('communityLabel');
        if (labelEl) labelEl.textContent = '翻牌 - 选择3张公共牌';

        renderHandSlots();
        renderCommunitySlots();
        renderCardPicker();
        updateAnalyzeButton();
        updateStageCounts();
        updateStageProgress();
        hideResults();
    }

    function hideResults() {
        const resultEmpty = document.getElementById('resultEmpty');
        const calculating = document.getElementById('calculating');
        const resultContent = document.getElementById('resultContent');
        const currentHandInfo = document.getElementById('currentHandInfo');

        if (resultEmpty) resultEmpty.style.display = 'block';
        if (calculating) calculating.style.display = 'none';
        if (resultContent) resultContent.style.display = 'none';
        if (currentHandInfo) currentHandInfo.style.display = 'none';
    }

    // ===== 动画辅助 =====
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
        const count = document.getElementById('opponentCount');
        if (count) count.textContent = n;

        const preflopTitle = document.getElementById('preflopTitle');
        if (preflopTitle) {
            preflopTitle.textContent = `起手牌强度表（翻前 · ${n}位对手）`;
        }

        renderPreflopGrid();
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

        // 获取当前结果
        const winEl = document.getElementById('winValue');
        const tieEl = document.getElementById('tieValue');
        const loseEl = document.getElementById('loseValue');
        const handNameEl = document.getElementById('currentHandName');

        const winRate = winEl ? winEl.textContent : '?';
        const tieRate = tieEl ? tieEl.textContent : '?';
        const loseRate = loseEl ? loseEl.textContent : '?';
        const currentHandName = handNameEl ? handNameEl.textContent : '';

        let stageText = '翻前 (Preflop)';
        if (community.length >= 5) stageText = '河牌 (River)';
        else if (community.length >= 4) stageText = '转牌 (Turn)';
        else if (community.length >= 3) stageText = '翻牌 (Flop)';

        return `你是一位世界级的德州扑克策略大师和教练。请根据以下牌局信息，给出详细的策略分析和操作建议。

## 当前牌局信息
- **我的手牌**: ${hand.join(' ')}
- **公共牌**: ${community.length > 0 ? community.join(' ') : '暂无（翻前）'}
- **当前阶段**: ${stageText}
- **对手数量**: ${state.numOpponents}人
- **模拟胜率**: 胜${winRate} / 平${tieRate} / 负${loseRate}
${currentHandName ? `- **当前最佳牌型**: ${currentHandName}` : ''}

## 请分析以下内容
1. **手牌评估**: 这手牌在当前阶段的强度如何？
2. **策略建议**: 应该加注(Raise)、跟注(Call)还是弃牌(Fold)？给出明确建议和原因。
3. **关键提醒**: 需要注意哪些潜在的危险牌面？对手可能拿到什么样的牌？
4. **进阶技巧**: 针对这手牌，有什么高级玩家会用的策略？

请用简洁清晰的中文回答，适当使用 emoji 让内容更生动。`;
    }

    async function askAI() {
        const btn = document.getElementById('aiAdvisorBtn');
        const overlay = document.getElementById('aiPanelOverlay');
        const panel = document.getElementById('aiPanel');
        const typing = document.getElementById('aiTyping');
        const content = document.getElementById('aiContent');

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
                        { role: 'system', content: '你是一位专业的德州扑克策略分析师。分析要简明扼要，重点突出，适合手机阅读。' },
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
                        const body = document.getElementById('aiPanelBody');
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
        const overlay = document.getElementById('aiPanelOverlay');
        const panel = document.getElementById('aiPanel');
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
        selectStartingHand,
        askAI,
        closeAI,
    };
})();

// 页面加载后自动初始化
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
