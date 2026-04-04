// js/modules/ai-advisor.js — AI 顾问全面优化版

function setupAIAdvisor({ 
    state, getEl, vibrate, getStageText, formatChips, 
    calculateDecisionMetrics, getSituationSnapshot, getOpponentProfile, 
    buildDefaultPreflopAdviceText,
    RANK_NAMES, SUIT_SYMBOLS, SUITS 
}) {
    const AI_API_URL = '/api/chat';
    const REQUEST_MARKER = 'ai-advisor';
    const STREAM_UNSAFE_UA_RE = /MicroMessenger|QQ\/|QQBrowser|MetaSr|WebView/i;
    const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
    const AI_PROMPT_VERSION = '20260404-v3-optimized';
    const AI_CACHE_STORAGE_KEY = 'poker.aiAdviceCache.v10';
    const AI_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
    const AI_CACHE_FRESH_MS = 20 * 60 * 1000;
    const AI_CACHE_MAX_ENTRIES = 40;
    const inFlightRequests = new Map();

    // Track conversation context
    let lastAIResponse = '';
    let lastAIPrompt = '';
    let lastAIMode = '';
    let lastAIRawText = '';  // plain text for copy

    // ── Cached DOM refs ─────────────────────────────────────────────────
    const domCache = {};
    function cachedEl(id) {
        if (domCache[id] === undefined) {
            domCache[id] = getEl(id);
        }
        return domCache[id];
    }

    // Use shared escapeHTML
    const escapeHTML = typeof window.__escapeHTML === 'function'
        ? window.__escapeHTML
        : function(str) {
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };

    // ── Emoji tag rendering ────────────────────────────────────────────

    const EMOJI_SECTION_MAP = {
        '🎯': { cls: 'ai-tag-action', label: '核心结论' },
        '📋': { cls: 'ai-tag-plan', label: '推荐动作' },
        '💰': { cls: 'ai-tag-odds', label: '赔率分析' },
        '🃏': { cls: 'ai-tag-hand', label: '牌力' },
        '⚠️': { cls: 'ai-tag-warn', label: '风险' },
        '📌': { cls: 'ai-tag-next', label: '计划' },
        '🏷️': { cls: 'ai-tag-info', label: '信息' },
        '❌': { cls: 'ai-tag-danger', label: '危险' },
        '💡': { cls: 'ai-tag-tip', label: '提示' },
        '🔍': { cls: 'ai-tag-info', label: '分析' },
        '📊': { cls: 'ai-tag-odds', label: '数据' },
        '🛡️': { cls: 'ai-tag-plan', label: '防守' },
        '🎲': { cls: 'ai-tag-hand', label: '概率' },
    };

    function simpleMarkdown(text) {
        const safeText = escapeHTML(text);
        const lines = safeText.split('\n');
        const htmlParts = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                htmlParts.push('<div class="ai-spacer"></div>');
                continue;
            }

            // Check for emoji-tagged section line
            const emojiMatch = trimmed.match(/^([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]+[\uFE0F]?)\s*(.+)$/u);
            if (emojiMatch) {
                const emoji = emojiMatch[1];
                const content = emojiMatch[2];
                const config = EMOJI_SECTION_MAP[emoji] || { cls: 'ai-tag-info', label: '' };

                const colonIdx = content.indexOf(':');
                const colonIdx2 = content.indexOf('：');
                const splitIdx = colonIdx >= 0 && colonIdx2 >= 0
                    ? Math.min(colonIdx, colonIdx2)
                    : Math.max(colonIdx, colonIdx2);

                let labelPart = '';
                let bodyPart = content;
                if (splitIdx > 0 && splitIdx <= 10) {
                    labelPart = content.slice(0, splitIdx);
                    bodyPart = content.slice(splitIdx + 1).trim();
                }

                bodyPart = bodyPart
                    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                    .replace(/`(.+?)`/g, '<code>$1</code>');

                htmlParts.push(
                    `<div class="ai-section ${config.cls}">` +
                    `<span class="ai-section-emoji">${emoji}</span>` +
                    `<div class="ai-section-body">` +
                    (labelPart ? `<span class="ai-section-label">${labelPart}</span> ` : '') +
                    `<span class="ai-section-text">${bodyPart}</span>` +
                    `</div></div>`
                );
                continue;
            }

            if (trimmed.startsWith('### ') || trimmed.startsWith('## ')) {
                const headingText = trimmed.replace(/^#{2,3}\s+/, '');
                htmlParts.push(`<h3>${headingText}</h3>`);
                continue;
            }

            if (trimmed.startsWith('&gt; ')) {
                htmlParts.push(`<blockquote>${trimmed.slice(5)}</blockquote>`);
                continue;
            }

            if (trimmed.startsWith('- ')) {
                htmlParts.push(`<li>${trimmed.slice(2)}</li>`);
                continue;
            }

            const numMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
            if (numMatch) {
                htmlParts.push(`<li>${numMatch[2]}</li>`);
                continue;
            }

            let formatted = trimmed
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/`(.+?)`/g, '<code>$1</code>')
                .replace(/^([^\n：:]{2,14}[：:])/gm, '<strong>$1</strong>');
            htmlParts.push(`<p>${formatted}</p>`);
        }

        let html = htmlParts.join('\n');
        html = html.replace(/<li>.*?<\/li>\n?(<li>.*?<\/li>\n?)*/gs, (match) => `<ul>${match}</ul>`);
        return html;
    }

    function isLocalRuntime() {
        const location = window.location || {};
        return location.protocol === 'file:' || LOCAL_HOSTNAMES.has(location.hostname || '');
    }

    function stripMarkup(text) {
        return String(text || '')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function getCsrfToken() {
        if (typeof window.__getPokerCsrfToken === 'function') {
            return String(window.__getPokerCsrfToken() || '');
        }
        return '';
    }

    // ── Cache ───────────────────────────────────────────────────────────

    function readAIAdviceCache(cacheKey) {
        try {
            const raw = localStorage.getItem(AI_CACHE_STORAGE_KEY);
            if (!raw) return null;
            const store = JSON.parse(raw);
            const entry = store && store[cacheKey];
            if (!entry || typeof entry.text !== 'string' || !entry.ts) return null;
            const ageMs = Date.now() - entry.ts;
            if (ageMs > AI_CACHE_TTL_MS) return null;
            return { text: entry.text, ts: entry.ts, ageMs, isFresh: ageMs <= AI_CACHE_FRESH_MS };
        } catch {
            return null;
        }
    }

    function writeAIAdviceCache(cacheKey, text) {
        try {
            const raw = localStorage.getItem(AI_CACHE_STORAGE_KEY);
            const store = raw ? JSON.parse(raw) : {};
            store[cacheKey] = { text: String(text || ''), ts: Date.now() };
            const nextStore = Object.fromEntries(
                Object.entries(store)
                    .sort(([, left], [, right]) => (right?.ts || 0) - (left?.ts || 0))
                    .slice(0, AI_CACHE_MAX_ENTRIES)
            );
            localStorage.setItem(AI_CACHE_STORAGE_KEY, JSON.stringify(nextStore));
        } catch { }
    }

    // ── Render helpers ──────────────────────────────────────────────────

    let pendingRenderFrame = null;

    function renderAIContent(text, content) {
        if (pendingRenderFrame) {
            cancelAnimationFrame(pendingRenderFrame);
            pendingRenderFrame = null;
        }
        content.innerHTML = simpleMarkdown(text);
        const body = cachedEl('aiPanelBody');
        if (body) body.scrollTop = body.scrollHeight;
    }

    function showAIWaiting(typing, content) {
        if (typing) typing.classList.remove('hidden');
        if (content) {
            content.classList.remove('visible');
            content.innerHTML = '';
        }
        const followUp = cachedEl('aiFollowUpBar');
        if (followUp) followUp.style.display = 'none';
    }

    function revealAIContent(content, typing) {
        if (typing) typing.classList.add('hidden');
        if (content) content.classList.add('visible');
        showFollowUpBar();
    }

    function showFollowUpBar() {
        const followUp = cachedEl('aiFollowUpBar');
        if (followUp) followUp.style.display = '';
        renderFollowUpChips();
    }

    function hideFollowUpBar() {
        const followUp = cachedEl('aiFollowUpBar');
        if (followUp) followUp.style.display = 'none';
    }

    // ── Context-aware follow-up chips ───────────────────────────────────

    const FOLLOWUP_CHIPS = {
        'preflop-default': [
            { emoji: '🏷️', text: '不同位置怎么调整？', question: '在不同位置（UTG/CO/BTN/SB）这手牌应该怎么调整开局策略？' },
            { emoji: '⚠️', text: '面对3bet怎么办？', question: '如果我开局后被3bet，这手牌应该4bet还是弃牌？什么尺度的3bet可以继续？' },
            { emoji: '🎲', text: '多人桌调整？', question: '多人桌（6-9人）这手牌的范围应该怎么收紧？' },
            { emoji: '📌', text: '翻后怎么打？', question: '这手牌翻后击中什么牌面是好牌面？什么牌面应该放弃？' },
        ],
        'postflop-default': [
            { emoji: '🃏', text: '听牌怎么处理？', question: '如果现在有顺子或同花听牌，应该主动下注还是过牌？' },
            { emoji: '⚠️', text: '被加注怎么办？', question: '如果我这里下注后被加注，这手牌应该怎么应对？' },
            { emoji: '📌', text: '转牌河牌计划？', question: '接下来转牌和河牌的打法应该怎么计划？' },
            { emoji: '🔍', text: '对手可能拿什么？', question: '基于现在的牌面，对手最可能的范围是什么？' },
        ],
        'decision': [
            { emoji: '💰', text: 'EV 计算详解？', question: '请详细解释这个决策点的 EV 计算过程，为什么这个action最优？' },
            { emoji: '🔍', text: '对手手牌范围？', question: '对手在这个位置和动作下最可能的手牌范围是什么？' },
            { emoji: '📋', text: '换个尺寸呢？', question: '如果换个下注/加注尺寸，结果会怎样？比如更大或更小的尺寸？' },
            { emoji: '⚠️', text: '被反加怎么办？', question: '如果执行推荐动作后被对手反加注，应该怎么应对？' },
        ]
    };

    function renderFollowUpChips() {
        const container = cachedEl('aiFollowUpChips');
        if (!container) return;

        const mode = lastAIMode || getAIContextMode();
        const chips = FOLLOWUP_CHIPS[mode] || FOLLOWUP_CHIPS['decision'];

        container.innerHTML = chips.map(chip =>
            `<button class="ai-followup-chip" onclick="app.followUpAI('${escapeHTML(chip.question)}')">${chip.emoji} ${escapeHTML(chip.text)}</button>`
        ).join('');
    }

    // ── AI Context / Mode ───────────────────────────────────────────────

    function getAIContextMode() {
        const boardCount = state.community.filter(Boolean).length;
        if (state.situationEnabled) return 'decision';
        return boardCount === 0 ? 'preflop-default' : 'postflop-default';
    }

    function getCurrentHandKey() {
        if (!state.hand[0] || !state.hand[1]) return '';
        try { return getStartingHandKey(state.hand[0], state.hand[1]); } catch { return ''; }
    }

    function getPreflopHandFeature(handKey) {
        const normalized = String(handKey || '').toUpperCase();
        if (!normalized) return '未知手牌';
        const isPair = normalized.length === 2;
        const isSuited = normalized.endsWith('S');
        const first = normalized[0];
        const second = normalized[1];
        const broadway = 'AKQJT';
        if (isPair) return '口袋对子';
        if (first === 'A' && isSuited && ['2', '3', '4', '5'].includes(second)) return '同花轮子A';
        if (first === 'A' && !isSuited) return '非同花弱A';
        if (first === 'A' && isSuited) return '同花A高';
        if (broadway.includes(first) && broadway.includes(second)) return isSuited ? '同花高张' : '高张组合';
        if (isSuited) return '同花投机牌';
        return '普通非同花牌';
    }

    function buildLocalPreflopAdvice() {
        if (typeof buildDefaultPreflopAdviceText === 'function') {
            const injectedAdvice = String(buildDefaultPreflopAdviceText() || '').trim();
            if (injectedAdvice) return injectedAdvice;
        }
        const handKey = getCurrentHandKey();
        const equity = Number(state.lastAnalysis?.result?.winRate || 0);
        const opponents = Math.max(1, Number(state.numOpponents) || 1);
        const feature = getPreflopHandFeature(handKey);
        const sizeLine = opponents <= 2 ? '开局尺寸: 未知位置先按2.2-2.5BB' : '开局尺寸: 未知位置先按2.3-2.6BB';
        let actionLine = '', reasonLine2 = '', reactionLine = '';
        if (equity >= 58) {
            actionLine = opponents === 1 ? '标准动作: 单挑首入池可正常开局' : '标准动作: 多数位置可开';
            reasonLine2 = `理由: ${feature}具备主动入池价值`;
            reactionLine = '若遭反击: 小中码3bet可继续';
        } else if (equity >= 52) {
            actionLine = '标准动作: 以中后位开局为主';
            reasonLine2 = `理由: ${feature}更像位置牌`;
            reactionLine = '若遭反击: 大尺度多弃';
        } else if (equity >= 46) {
            actionLine = '标准动作: 以后位偷盲为主';
            reasonLine2 = `理由: ${feature}更依赖弃牌率`;
            reactionLine = '若遭反击: 被3bet大多放弃';
        } else {
            actionLine = '标准动作: 未知位置下默认弃牌';
            reasonLine2 = `理由: ${feature}容错低`;
            reactionLine = '若遭反击: 直接收手';
        }
        return [actionLine, sizeLine, `胜率: ${Number.isFinite(equity) ? equity.toFixed(1).replace(/\.0$/, '') : '-'}%`, reasonLine2, reactionLine].join('\n');
    }

    function buildPreflopBaselineSummary() {
        return buildLocalPreflopAdvice().split('\n').map(l => l.trim()).filter(Boolean).join(' | ').slice(0, 420);
    }

    function getBoardTextureSummary() {
        const boardSize = state.community.filter(Boolean).length;
        if (boardSize < 3) return '';
        const label = cachedEl('textureLabel');
        const score = cachedEl('textureScore');
        const textureLabel = label ? String(label.textContent || '').trim() : '';
        const textureScore = score ? String(score.textContent || '').trim() : '';
        if (!textureLabel && !textureScore) return '';
        return textureScore ? `${textureLabel} ${textureScore}/100` : textureLabel;
    }

    function getSharedRequest(cacheKey, createRequest) {
        if (inFlightRequests.has(cacheKey)) return inFlightRequests.get(cacheKey);
        const request = Promise.resolve().then(createRequest).finally(() => inFlightRequests.delete(cacheKey));
        inFlightRequests.set(cacheKey, request);
        return request;
    }

    // ── Error handling ──────────────────────────────────────────────────

    function createErrorView(message, hint = '') {
        return { message: String(message || '未知错误').slice(0, 300), hint: String(hint || '').slice(0, 300) };
    }

    function mapApiError(status, serverMessage) {
        const detail = stripMarkup(serverMessage).slice(0, 240);
        if ((status === 404 || status === 405 || status === 501) && isLocalRuntime()) {
            return createErrorView('当前本地启动方式没有提供 AI 接口。', '请用 wrangler pages dev . 运行站点。');
        }
        if (status === 403) return createErrorView(detail ? `AI 请求被安全策略拦截：${detail}` : 'AI 请求被安全策略拦截。', '请刷新页面后重试。');
        if (status === 429) return createErrorView('AI 请求过于频繁，请稍后重试。', '等待 2-3 秒后再试。');
        if (status === 500 && detail.includes('DEEPSEEK_API_KEY')) return createErrorView('服务端还没有配置 DEEPSEEK_API_KEY。', '请在 Cloudflare Pages 里补上密钥。');
        if (detail) return createErrorView(`AI 接口返回错误：${detail}`, isLocalRuntime() ? '请确认用 wrangler pages dev 启动。' : '可查看 Cloudflare Functions 日志。');
        return createErrorView(`API 请求失败：${status}`, isLocalRuntime() ? '请确认函数运行环境已启动。' : '请检查网络连接。');
    }

    async function readErrorMessage(response) {
        let detail = '';
        try {
            const contentType = response.headers.get('Content-Type') || '';
            if (contentType.includes('application/json')) {
                const payload = await response.json();
                if (payload && typeof payload.error === 'string' && payload.error.trim()) detail = payload.error.trim();
            } else {
                const text = (await response.text()).trim();
                if (text) detail = text.slice(0, 600);
            }
        } catch { }
        return mapApiError(response.status, detail);
    }

    function normalizeThrownError(error) {
        const typedError = error;
        if (typedError && typedError.userMessage) return createErrorView(typedError.userMessage, typedError.userHint || '');
        if (error && error.name === 'AbortError') return createErrorView('请求超时，请稍后重试。', '如果连续超时，先检查网络。');
        const rawMessage = String(error && error.message ? error.message : error || '未知错误').trim();
        if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(rawMessage)) {
            return isLocalRuntime()
                ? createErrorView('当前本地环境没有可用的 AI 接口。', '请用 wrangler pages dev . 运行。')
                : createErrorView('网络连接失败。', '请检查网络连接。');
        }
        return createErrorView(rawMessage || '未知错误', isLocalRuntime() ? '请确认函数环境已启动。' : '');
    }

    function renderError(content, errorView) {
        const safeMessage = escapeHTML(errorView.message);
        const safeHint = escapeHTML(errorView.hint);
        content.innerHTML = 
            `<div class="ai-error-card">` +
            `<p class="ai-error-msg">❌ ${safeMessage}</p>` +
            (safeHint ? `<p class="ai-error-hint">${safeHint}</p>` : '') +
            `<button class="ai-retry-btn" onclick="app.refreshAI()">🔄 重新尝试</button>` +
            `</div>`;
    }

    // ── AI Request Config ───────────────────────────────────────────────

    function isEmbeddedBrowser() {
        return STREAM_UNSAFE_UA_RE.test(navigator.userAgent || '');
    }

    const SYSTEM_PROMPTS = {
        'decision': `你是顶级德州扑克策略顾问。根据给定的牌局数据给出精确决策建议。

规则：
- 只依据给定数据，不编造历史动作或对手读牌
- 围绕"继续门槛、跟注赔率、CallEV、SPR"展开分析
- 不要把"继续门槛"说成"加注门槛"

严格使用以下 emoji 标签格式输出，每行一个标签：
🎯 核心结论: （一句话给出 Fold/Call/Raise 结论和理由）
📋 推荐动作: （具体动作+尺寸，如 Call 5积分 / Raise to 15积分）
💰 赔率分析: （跟注赔率 vs 胜率 vs 继续门槛的对比）
🃏 牌力解读: （当前成牌+听牌+阻断情况）
📌 下一街计划: （转牌/河牌的打法预案）
⚠️ 风险提示: （最需要警惕的危险牌面变化）

每个标签后1-2句话，总字数不超过400字。语言简练有力，像教练指导学员。`,

        'decision-compact': `你是德州扑克策略顾问。规则：只用给定数据，围绕继续门槛/赔率/CallEV分析。

emoji 标签格式输出：
🎯 核心结论:
📋 推荐动作:
💰 赔率分析:
🃏 牌力解读:
📌 下一街:
⚠️ 风险:

每行1句话，总字数≤260字。`,

        'preflop-default': `你是顶级德州扑克翻前顾问。根据给定手牌数据给出开局建议。

规则：
- 只依据给定数据，不编造前人动作
- 未提供动作历史时按100BB无人入池处理
- 不要输出面对下注后的弃牌/跟注结论

严格使用以下 emoji 标签格式输出，每行一个标签：
🎯 核心结论: （这手牌能不能开，一句话定调）
📋 推荐开局: （具体开局方式，如 Open Raise 2.5BB）
🏷️ 位置建议: （哪些位置可以打开，哪些要收紧）
🃏 手牌特点: （牌型优势和弱点分析）
⚠️ 若遇3bet: （面对反加注的应对策略）
📌 翻后重点: （翻后应关注的要点）

每个标签后1-2句话，总字数不超过400字。`,

        'preflop-default-compact': `你是德州扑克翻前顾问。规则：未指明动作即按无人入池处理。

emoji 标签格式输出：
🎯 核心结论:
📋 推荐开局:
🏷️ 位置建议:
🃏 手牌特点:
⚠️ 若遇3bet:
📌 翻后重点:

每行1句话，总字数≤260字。`,

        'postflop-default': `你是顶级德州扑克翻后顾问。根据给定牌局数据给出打法建议。

规则：
- 只依据给定数据，不编造对手下注或历史动作
- 未提供跟注金额时给默认打法和尺寸建议
- 不要输出纯弃牌/纯跟注百分比

严格使用以下 emoji 标签格式输出，每行一个标签：
🎯 牌力定位: （当前牌力在这个牌面上处于什么位置）
📋 默认打法: （推荐的行动方式和尺寸）
🃏 听牌/阻断: （顺子/同花听牌分析+阻断效应）
⚠️ 危险转牌: （哪些转牌会让你的牌力大幅下降）
📌 下一街计划: （转牌和河牌的打法预案）
❌ 最大风险: （这个牌面最需要警惕什么）

每个标签后1-2句话，总字数不超过400字。`,

        'postflop-default-compact': `你是德州扑克翻后顾问。规则：未给跟注金额时给默认打法。

emoji 标签格式：
🎯 牌力定位:
📋 默认打法:
🃏 听牌/阻断:
⚠️ 危险转牌:
📌 下一街:
❌ 最大风险:

每行1句话，总字数≤260字。`,

        'followup': `你是顶级德州扑克策略顾问，正在进行多轮对话。用户之前问过牌局问题，你已给分析。现在用户有追问。

规则：
- 基于之前的牌局上下文回答
- 保持 emoji 标签格式（只用相关标签）
- 回答具体、有策略深度
- 总字数不超过350字`
    };

    function getAIRequestProfile(mode = 'decision') {
        const embedded = isEmbeddedBrowser();
        const isDecisionMode = mode === 'decision';
        const compactSuffix = embedded ? '-compact' : '';
        const systemKey = mode + compactSuffix;
        const systemPrompt = SYSTEM_PROMPTS[systemKey] || SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS['decision'];

        return {
            compactPrompt: embedded,
            preferStreaming: shouldPreferStreaming(),
            timeoutMs: 30000,
            maxTokens: embedded ? 420 : (isDecisionMode ? 760 : 680),
            temperature: embedded ? 0.10 : (isDecisionMode ? 0.20 : 0.18),
            cacheFreshMs: embedded ? 12 * 60 * 1000 : AI_CACHE_FRESH_MS,
            systemPrompt
        };
    }

    function buildAIRequestPayload(prompt, stream, profile) {
        return {
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: profile.systemPrompt },
                { role: 'user', content: prompt }
            ],
            stream,
            max_tokens: profile.maxTokens,
            temperature: profile.temperature,
        };
    }

    function buildFollowUpPayload(question, stream, profile) {
        const messages = [
            { role: 'system', content: SYSTEM_PROMPTS['followup'] }
        ];
        if (lastAIPrompt) messages.push({ role: 'user', content: lastAIPrompt });
        if (lastAIResponse) messages.push({ role: 'assistant', content: lastAIResponse });
        messages.push({ role: 'user', content: question });

        return {
            model: 'deepseek-chat',
            messages,
            stream,
            max_tokens: 480,
            temperature: 0.22,
        };
    }

    function shouldPreferStreaming() {
        return typeof ReadableStream !== 'undefined' && !STREAM_UNSAFE_UA_RE.test(navigator.userAgent || '');
    }

    function formatShortNumber(value) {
        const num = Number(value);
        if (!Number.isFinite(num)) return '-';
        return Number.isInteger(num) ? String(num) : num.toFixed(1).replace(/\.0$/, '');
    }

    function formatProfileToken(profileName, profileInfo) {
        const key = String(profileName || '').trim();
        if (key) return key;
        return String(profileInfo && profileInfo.label ? profileInfo.label : 'random');
    }

    // ── Streaming response ──────────────────────────────────────────────

    async function consumeStreamingResponse(response, content, typing) {
        if (!response.body || typeof response.body.getReader !== 'function') {
            throw new Error('当前浏览器不支持流式响应');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let buffered = '';
        let hasStarted = false;
        let renderBuffer = '';
        let rafId = null;

        // Use rAF for smoother rendering
        function flushRender() {
            rafId = null;
            if (!renderBuffer) return;
            fullText += renderBuffer;
            renderBuffer = '';
            content.innerHTML = simpleMarkdown(fullText);
            const body = cachedEl('aiPanelBody');
            if (body) body.scrollTop = body.scrollHeight;
        }

        function scheduleRender(delta) {
            renderBuffer += delta;
            if (!rafId) {
                rafId = requestAnimationFrame(flushRender);
            }
        }

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffered += decoder.decode(value, { stream: true });
            const segments = buffered.split('\n');
            buffered = segments.pop() || '';

            for (const rawLine of segments) {
                const line = rawLine.trim();
                if (!line.startsWith('data: ')) continue;

                const data = line.slice(6);
                if (data === '[DONE]') {
                    if (rafId) { cancelAnimationFrame(rafId); flushRender(); }
                    return fullText;
                }

                try {
                    const parsed = JSON.parse(data);
                    const delta = parsed.choices?.[0]?.delta?.content || '';
                    if (!delta) continue;
                    if (!hasStarted) {
                        revealAIContent(content, typing);
                        hasStarted = true;
                    }
                    scheduleRender(delta);
                } catch { }
            }
        }

        if (rafId) { cancelAnimationFrame(rafId); flushRender(); }
        return fullText;
    }

    async function consumeJsonResponse(response, content, typing) {
        const payload = await response.json();
        const fullText = payload?.choices?.[0]?.message?.content || '';
        if (!fullText) throw new Error('AI 返回为空');
        revealAIContent(content, typing);
        renderAIContent(fullText, content);
        return fullText;
    }

    // ── Streaming follow-up (appends to existing content) ───────────────

    async function consumeStreamingFollowUp(response, replyEl) {
        if (!response.body || typeof response.body.getReader !== 'function') {
            throw new Error('不支持流式响应');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let buffered = '';
        let renderBuffer = '';
        let rafId = null;

        function flushRender() {
            rafId = null;
            if (!renderBuffer) return;
            fullText += renderBuffer;
            renderBuffer = '';
            replyEl.innerHTML = simpleMarkdown(fullText);
            const body = cachedEl('aiPanelBody');
            if (body) body.scrollTop = body.scrollHeight;
        }

        function scheduleRender(delta) {
            renderBuffer += delta;
            if (!rafId) rafId = requestAnimationFrame(flushRender);
        }

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffered += decoder.decode(value, { stream: true });
            const segments = buffered.split('\n');
            buffered = segments.pop() || '';

            for (const rawLine of segments) {
                const line = rawLine.trim();
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6);
                if (data === '[DONE]') {
                    if (rafId) { cancelAnimationFrame(rafId); flushRender(); }
                    return fullText;
                }
                try {
                    const parsed = JSON.parse(data);
                    const delta = parsed.choices?.[0]?.delta?.content || '';
                    if (delta) scheduleRender(delta);
                } catch { }
            }
        }

        if (rafId) { cancelAnimationFrame(rafId); flushRender(); }
        return fullText;
    }

    async function requestAI(prompt, content, typing, stream, signal, profile, payloadOverride) {
        const body = payloadOverride || buildAIRequestPayload(prompt, stream, profile);

        const response = await fetch(AI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream, application/json',
                'X-Poker-Request': REQUEST_MARKER,
                'X-CSRF-Token': getCsrfToken()
            },
            body: JSON.stringify(body),
            signal
        });

        if (!response.ok) {
            const errorView = await readErrorMessage(response);
            const error = new Error(errorView.message);
            error.userMessage = errorView.message;
            error.userHint = errorView.hint;
            throw error;
        }

        const contentType = String(response.headers.get('Content-Type') || '').toLowerCase();
        const shouldUseJson = !stream || contentType.includes('application/json');
        return shouldUseJson
            ? consumeJsonResponse(response, content, typing)
            : consumeStreamingResponse(response, content, typing);
    }

    // ── Prompt Building ─────────────────────────────────────────────────

    function buildAIPrompt(options = {}) {
        const compact = Boolean(options.compact);
        const mode = options.mode || 'decision';
        const hand = state.hand.filter(c => c !== null).map(c => `${RANK_NAMES[c.rank]}${SUIT_SYMBOLS[SUITS[c.suit]]}`);
        const community = state.community.filter(c => c !== null).map(c => `${RANK_NAMES[c.rank]}${SUIT_SYMBOLS[SUITS[c.suit]]}`);
        const lastAnalysis = state.lastAnalysis;
        const situation = getSituationSnapshot();
        const opponentProfile = getOpponentProfile(situation.opponentProfile);
        const winRate = lastAnalysis ? `${lastAnalysis.result.winRate}%` : '?';
        const tieRate = lastAnalysis ? `${lastAnalysis.result.tieRate}%` : '?';
        const loseRate = lastAnalysis ? `${lastAnalysis.result.loseRate}%` : '?';
        const currentHandNameEl = cachedEl('currentHandName');
        const currentHandName = currentHandNameEl ? currentHandNameEl.textContent : '';
        const decision = state.situationEnabled
            ? (lastAnalysis && lastAnalysis.decision ? lastAnalysis.decision : calculateDecisionMetrics(0, situation.potSize, situation.callAmount))
            : null;
        const stageText = getStageText(community.length);
        const handKey = getCurrentHandKey();
        const boardTexture = getBoardTextureSummary();
        const potSize = Math.max(0, Number(situation.potSize) || 0);
        const stack = Math.max(1, Number(situation.effectiveStackBB) || 100);
        const spr = potSize > 0 ? (stack / potSize).toFixed(1) : '\u2014';
        const smallBet = (potSize * 0.33).toFixed(1);
        const midBet = (potSize * 0.6).toFixed(1);
        const largeBet = (potSize * 0.9).toFixed(1);
        const preflopBaseline = mode === 'preflop-default' ? buildPreflopBaselineSummary() : '';

        // Enhanced: inject outs info if available
        const outsEl = cachedEl('outsCount');
        const outsInfo = outsEl ? String(outsEl.textContent || '').trim() : '';

        const coreFacts = [
            `阶段:${stageText}`,
            `手牌简称:${handKey || '-'}`,
            `手牌:${hand.join(' ') || '-'}`,
            `公牌:${community.length > 0 ? community.join(' ') : '-'}`,
            `对手:${state.numOpponents}`,
            `胜平负:${winRate}/${tieRate}/${loseRate}`,
            `当前牌型:${currentHandName || '-'}`
        ];
        if (outsInfo) coreFacts.push(`补牌outs:${outsInfo}`);

        const fastFacts = state.situationEnabled
            ? [
                `位置:${situation.position}`,
                `底池:${formatShortNumber(situation.potSize)}`,
                `跟注:${formatShortNumber(situation.callAmount)}`,
                `后手:${formatShortNumber(situation.effectiveStackBB)}`,
                `SPR:${spr}`,
                `画像:${formatProfileToken(situation.opponentProfile, opponentProfile)}`,
                `跟注赔率:${decision.potOddsPct}%`,
                `继续门槛:${decision.requiredEquityPct}%`,
                `CallEV:${decision.callEVBB}`,
                `程序建议:${decision.action}`
            ]
            : ['模式:默认100BB'];

        const supportFacts = [];
        if (mode !== 'preflop-default' && potSize > 0) {
            supportFacts.push(`可选尺寸:${smallBet}/${midBet}/${largeBet}`);
        }
        if (boardTexture) supportFacts.push(`牌面纹理:${boardTexture}`);

        if (mode === 'preflop-default') {
            return [
                '分析以下翻前牌局，严格按 emoji 标签格式输出。',
                coreFacts.join(' | '),
                preflopBaseline ? `本地基线:${preflopBaseline}` : '',
                '上下文:未知位置、未知前人动作、默认100BB无人入池(open pot)',
                '补充:若对手数=1且翻前胜率明显高于50%，通常不应给纯弃牌。'
            ].filter(Boolean).join('\n');
        }

        if (mode === 'postflop-default') {
            return [
                '分析以下翻后牌局，严格按 emoji 标签格式输出。',
                coreFacts.join(' | '),
                supportFacts.join(' | '),
                '上下文:未提供底池赔率/跟注金额/对手下注尺度，仅能给默认打法',
                '补充:若有强听牌或明显成牌，要写出主动/被动计划与危险转牌。分析阻断效应。'
            ].filter(Boolean).join('\n');
        }

        return [
            '分析以下牌局并给出精确决策，严格按 emoji 标签格式输出。',
            coreFacts.join(' | '),
            fastFacts.join(' | '),
            supportFacts.join(' | '),
            '原则:多人池更收紧; 胜率低于门槛且无隐含赔率时优先弃牌; 胜率明显高于门槛时优先价值/继续'
        ].filter(Boolean).join('\n');
    }

    function buildAICacheKey(profile) {
        const lastAnalysis = state.lastAnalysis;
        const situation = getSituationSnapshot();
        const hand = state.hand.filter(c => c !== null).map(c => `${RANK_NAMES[c.rank]}${SUIT_SYMBOLS[SUITS[c.suit]]}`);
        const community = state.community.filter(c => c !== null).map(c => `${RANK_NAMES[c.rank]}${SUIT_SYMBOLS[SUITS[c.suit]]}`);
        const currentHandNameEl = cachedEl('currentHandName');
        const currentHandName = currentHandNameEl ? currentHandNameEl.textContent : '';

        return JSON.stringify({
            v: 10,
            promptVersion: AI_PROMPT_VERSION,
            mode: getAIContextMode(),
            compact: Boolean(profile && profile.compactPrompt),
            maxTokens: profile && profile.maxTokens,
            temperature: profile && profile.temperature,
            hand, community,
            opponents: state.numOpponents,
            winRate: lastAnalysis ? lastAnalysis.result.winRate : '',
            tieRate: lastAnalysis ? lastAnalysis.result.tieRate : '',
            loseRate: lastAnalysis ? lastAnalysis.result.loseRate : '',
            situationEnabled: state.situationEnabled,
            position: situation.position,
            potSize: situation.potSize,
            callAmount: situation.callAmount,
            effectiveStackBB: situation.effectiveStackBB,
            opponentProfile: situation.opponentProfile,
            currentHandName,
            boardTexture: getBoardTextureSummary(),
            handKey: getCurrentHandKey()
        });
    }

    // ── Copy result ─────────────────────────────────────────────────────

    function copyAIResult() {
        const content = cachedEl('aiContent');
        if (!content) return;

        // Get plain text from rendered content
        const text = lastAIRawText || content.innerText || content.textContent || '';
        if (!text.trim()) return;

        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(text).then(() => {
                showCopyToast();
            }).catch(() => {
                fallbackCopy(text);
            });
        } else {
            fallbackCopy(text);
        }
    }

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); showCopyToast(); } catch { }
        document.body.removeChild(ta);
    }

    function showCopyToast() {
        const btn = cachedEl('aiCopyBtn');
        if (!btn) return;
        const original = btn.textContent;
        btn.textContent = '✅';
        btn.classList.add('copied');
        vibrate('light');
        setTimeout(() => {
            btn.textContent = original;
            btn.classList.remove('copied');
        }, 1500);
    }

    // ── Main askAI ──────────────────────────────────────────────────────

    async function askAI(options = {}) {
        const forceRefresh = Boolean(options.forceRefresh);
        const btn = cachedEl('aiAdvisorBtn');
        const overlay = cachedEl('aiPanelOverlay');
        const panel = cachedEl('aiPanel');
        const typing = cachedEl('aiTyping');
        const content = cachedEl('aiContent');

        if (!btn || !panel) return;

        vibrate('medium');
        btn.classList.add('loading');
        overlay.style.display = 'block';
        panel.style.display = 'flex';
        showAIWaiting(typing, content);

        // Animate refresh button
        const refreshBtn = cachedEl('aiRefreshBtn');
        if (refreshBtn && forceRefresh) refreshBtn.classList.add('spinning');

        const mode = getAIContextMode();
        lastAIMode = mode;
        const profile = getAIRequestProfile(mode);
        const cacheKey = buildAICacheKey(profile);

        const cachedAdvice = forceRefresh ? null : readAIAdviceCache(cacheKey);
        const staleCacheText = cachedAdvice && cachedAdvice.text ? cachedAdvice.text : '';
        const shouldRefreshStaleCache = !!(cachedAdvice && !cachedAdvice.isFresh);

        if (cachedAdvice && cachedAdvice.text && !forceRefresh) {
            typing.classList.add('hidden');
            content.classList.add('visible');
            renderAIContent(cachedAdvice.text, content);
            lastAIResponse = cachedAdvice.text;
            lastAIRawText = cachedAdvice.text;
            showFollowUpBar();
            if (!shouldRefreshStaleCache) {
                btn.classList.remove('loading');
                if (refreshBtn) refreshBtn.classList.remove('spinning');
                vibrate('success');
                return;
            }
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), profile.timeoutMs);

        try {
            const prompt = buildAIPrompt({ compact: profile.compactPrompt, mode });
            lastAIPrompt = prompt;
            const preferStreaming = profile.preferStreaming && !shouldRefreshStaleCache;
            let fullText = '';

            fullText = await getSharedRequest(cacheKey, async () => {
                try {
                    return await requestAI(prompt, content, typing, preferStreaming, controller.signal, profile);
                } catch (error) {
                    const shouldFallback = preferStreaming && /流式响应|ReadableStream|reader/i.test(String(error && error.message ? error.message : error));
                    if (!shouldFallback) throw error;
                    content.innerHTML = '';
                    showAIWaiting(typing, content);
                    return requestAI(prompt, content, typing, false, controller.signal, profile);
                }
            });

            if (fullText) {
                lastAIResponse = fullText;
                lastAIRawText = fullText;
                writeAIAdviceCache(cacheKey, fullText);
                if (shouldRefreshStaleCache && fullText === staleCacheText) {
                    renderAIContent(staleCacheText, content);
                }
            }
            vibrate('success');

        } catch (err) {
            if (staleCacheText) {
                renderAIContent(staleCacheText, content);
                lastAIResponse = staleCacheText;
                lastAIRawText = staleCacheText;
            } else {
                revealAIContent(content, typing);
                const fallbackText = mode === 'preflop-default' ? buildLocalPreflopAdvice() : '';
                if (fallbackText) {
                    renderAIContent(fallbackText, content);
                } else {
                    renderError(content, normalizeThrownError(err));
                }
            }
        } finally {
            clearTimeout(timeoutId);
            btn.classList.remove('loading');
            if (refreshBtn) refreshBtn.classList.remove('spinning');
        }
    }

    // ── Follow-up (streaming) ───────────────────────────────────────────

    async function followUpAI(question) {
        if (!question || !question.trim()) return;

        const typing = cachedEl('aiTyping');
        const content = cachedEl('aiContent');
        const panel = cachedEl('aiPanel');
        if (!content || !panel) return;

        vibrate('medium');

        // Append user question bubble
        const questionBubble = document.createElement('div');
        questionBubble.className = 'ai-followup-question';
        questionBubble.innerHTML = `<span class="ai-followup-label">追问</span> ${escapeHTML(question)}`;
        content.appendChild(questionBubble);

        // Create reply container
        const replyEl = document.createElement('div');
        replyEl.className = 'ai-followup-reply';
        replyEl.innerHTML = '<div class="ai-followup-loading"><span></span><span></span><span></span></div>';
        content.appendChild(replyEl);

        const body = cachedEl('aiPanelBody');
        if (body) body.scrollTop = body.scrollHeight;

        hideFollowUpBar();

        const mode = lastAIMode || getAIContextMode();
        const profile = getAIRequestProfile(mode);
        const preferStreaming = shouldPreferStreaming();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), profile.timeoutMs);

        try {
            const payload = buildFollowUpPayload(question, preferStreaming, profile);

            const response = await fetch(AI_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream, application/json',
                    'X-Poker-Request': REQUEST_MARKER,
                    'X-CSRF-Token': getCsrfToken()
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            if (!response.ok) {
                const errorView = await readErrorMessage(response);
                throw new Error(errorView.message);
            }

            const contentType = String(response.headers.get('Content-Type') || '').toLowerCase();
            const isJson = !preferStreaming || contentType.includes('application/json');
            let replyText = '';

            if (isJson) {
                const data = await response.json();
                replyText = data?.choices?.[0]?.message?.content || '';
                replyEl.innerHTML = replyText ? simpleMarkdown(replyText) : '<p style="color:var(--text-muted)">AI 未返回有效回答</p>';
            } else {
                replyEl.innerHTML = '';
                replyText = await consumeStreamingFollowUp(response, replyEl);
                if (!replyText) {
                    replyEl.innerHTML = '<p style="color:var(--text-muted)">AI 未返回有效回答</p>';
                }
            }

            if (replyText) {
                lastAIResponse = replyText;
                lastAIRawText += '\n\n追问: ' + question + '\n' + replyText;
            }

            vibrate('success');

        } catch (err) {
            replyEl.innerHTML = `<div class="ai-error-card"><p class="ai-error-msg">❌ 追问失败：${escapeHTML(String(err && err.message ? err.message : '未知错误'))}</p><button class="ai-retry-btn" onclick="app.followUpAI('${escapeHTML(question)}')">🔄 重试</button></div>`;
        } finally {
            clearTimeout(timeoutId);
            showFollowUpBar();
            if (body) body.scrollTop = body.scrollHeight;
        }
    }

    // ── Custom input follow-up ──────────────────────────────────────────

    function sendFollowUp() {
        const input = cachedEl('aiFollowUpInput');
        if (!input) return;
        const question = input.value.trim();
        if (!question) return;
        input.value = '';
        followUpAI(question);
    }

    // ── Refresh (skip cache) ────────────────────────────────────────────

    function refreshAI() {
        lastAIResponse = '';
        lastAIPrompt = '';
        lastAIRawText = '';
        askAI({ forceRefresh: true });
    }

    function closeAI() {
        const overlay = cachedEl('aiPanelOverlay');
        const panel = cachedEl('aiPanel');
        if (overlay) overlay.style.display = 'none';
        if (panel) panel.style.display = 'none';
    }

    return { askAI, closeAI, followUpAI, refreshAI, copyAIResult, sendFollowUp };
}
