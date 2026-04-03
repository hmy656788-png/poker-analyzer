// js/modules/ai-advisor.js

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
    const AI_PROMPT_VERSION = '20260404-detail-1';
    const AI_CACHE_STORAGE_KEY = 'poker.aiAdviceCache.v8';
    const AI_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
    const AI_CACHE_FRESH_MS = 20 * 60 * 1000;
    const AI_CACHE_MAX_ENTRIES = 40;
    const inFlightRequests = new Map();

    // Use shared escapeHTML — defined globally; fall back to inline copy if missing
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

    function simpleMarkdown(text) {
        const safeText = escapeHTML(text);
        return safeText
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/^## (.+)$/gm, '<h3>$1</h3>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/^([^\n：:]{2,14}[：:])/gm, '<strong>$1</strong>')
            .replace(/`(.+?)`/g, '<code>$1</code>')
            .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
            .replace(/^- (.+)$/gm, '<li>$1</li>')
            .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
            .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/^(.+)$/, '<p>$1</p>');
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

    function readAIAdviceCache(cacheKey) {
        try {
            const raw = localStorage.getItem(AI_CACHE_STORAGE_KEY);
            if (!raw) return null;

            const store = JSON.parse(raw);
            const entry = store && store[cacheKey];
            if (!entry || typeof entry.text !== 'string' || !entry.ts) {
                return null;
            }

            const ageMs = Date.now() - entry.ts;
            if (ageMs > AI_CACHE_TTL_MS) {
                return null;
            }

            return {
                text: entry.text,
                ts: entry.ts,
                ageMs,
                isFresh: ageMs <= AI_CACHE_FRESH_MS
            };
        } catch {
            return null;
        }
    }

    function writeAIAdviceCache(cacheKey, text) {
        try {
            const raw = localStorage.getItem(AI_CACHE_STORAGE_KEY);
            const store = raw ? JSON.parse(raw) : {};

            store[cacheKey] = {
                text: String(text || ''),
                ts: Date.now()
            };

            const nextStore = Object.fromEntries(
                Object.entries(store)
                    .sort(([, left], [, right]) => (right?.ts || 0) - (left?.ts || 0))
                    .slice(0, AI_CACHE_MAX_ENTRIES)
            );

            localStorage.setItem(AI_CACHE_STORAGE_KEY, JSON.stringify(nextStore));
        } catch {
            // ignore cache persistence failures
        }
    }

    function renderAIContent(text, content) {
        content.innerHTML = simpleMarkdown(text);
        const body = getEl('aiPanelBody');
        if (body) body.scrollTop = body.scrollHeight;
    }

    function showAIWaiting(typing, content) {
        if (typing) typing.classList.remove('hidden');
        if (content) {
            content.classList.remove('visible');
            content.innerHTML = '';
        }
    }

    function revealAIContent(content, typing) {
        if (typing) typing.classList.add('hidden');
        if (content) content.classList.add('visible');
    }

    function getAIContextMode() {
        const boardCount = state.community.filter(Boolean).length;
        if (state.situationEnabled) {
            return 'decision';
        }
        return boardCount === 0 ? 'preflop-default' : 'postflop-default';
    }

    function getCurrentHandKey() {
        if (!state.hand[0] || !state.hand[1]) return '';
        try {
            return getStartingHandKey(state.hand[0], state.hand[1]);
        } catch {
            return '';
        }
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
            if (injectedAdvice) {
                return injectedAdvice;
            }
        }

        const handKey = getCurrentHandKey();
        const equity = Number(state.lastAnalysis?.result?.winRate || 0);
        const opponents = Math.max(1, Number(state.numOpponents) || 1);
        const feature = getPreflopHandFeature(handKey);
        const sizeLine = opponents <= 2 ? '开局尺寸: 未知位置先按2.2-2.5BB' : '开局尺寸: 未知位置先按2.3-2.6BB';

        let actionLine = '';
        let reasonLine2 = '';
        let reactionLine = '';

        if (equity >= 58) {
            actionLine = opponents === 1
                ? '标准动作: 单挑首入池可正常开局，前位别机械放宽'
                : '标准动作: 未知位置下多数位置可开，前位保持频率';
            reasonLine2 = `理由2: ${feature}具备一定主动入池价值，但仍要尊重位置`;
            reactionLine = '若遭反击: 小中码3bet可继续，过大压力再收紧';
        } else if (equity >= 52) {
            actionLine = '标准动作: 未知位置下以中后位开局为主，前位别放太宽';
            reasonLine2 = `理由2: ${feature}更像位置牌，不能只看单挑胜率`;
            reactionLine = '若遭反击: 默认别轻易4bet，位置差或大尺度多弃';
        } else if (equity >= 46) {
            actionLine = '标准动作: 以后位偷盲为主，未知位置默认不打开';
            reasonLine2 = `理由2: ${feature}更依赖弃牌率和位置，不适合无信息扩大底池`;
            reactionLine = '若遭反击: 被3bet大多直接放弃';
        } else {
            actionLine = '标准动作: 未知位置下默认弃牌';
            reasonLine2 = `理由2: ${feature}在未知位置和未知动作下容错较低`;
            reactionLine = '若遭反击: 这类牌在无信息时应直接收手';
        }

        return [
            actionLine,
            sizeLine,
            `理由1: 当前单挑模拟约 ${Number.isFinite(equity) ? equity.toFixed(1).replace(/\\.0$/, '') : '-'}%，别直接当成全位置开局许可`,
            reasonLine2,
            reactionLine
        ].join('\n');
    }

    function buildPreflopBaselineSummary() {
        return buildLocalPreflopAdvice()
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .join(' | ')
            .slice(0, 420);
    }

    function getBoardTextureSummary() {
        const boardSize = state.community.filter(Boolean).length;
        if (boardSize < 3) return '';

        const label = getEl('textureLabel');
        const score = getEl('textureScore');
        const textureLabel = label ? String(label.textContent || '').trim() : '';
        const textureScore = score ? String(score.textContent || '').trim() : '';
        if (!textureLabel && !textureScore) return '';
        return textureScore ? `${textureLabel} ${textureScore}/100` : textureLabel;
    }

    function getSharedRequest(cacheKey, createRequest) {
        if (inFlightRequests.has(cacheKey)) {
            return inFlightRequests.get(cacheKey);
        }

        const request = Promise.resolve()
            .then(createRequest)
            .finally(() => {
                inFlightRequests.delete(cacheKey);
            });

        inFlightRequests.set(cacheKey, request);
        return request;
    }

    function createErrorView(message, hint = '') {
        return {
            message: String(message || '未知错误').slice(0, 300),
            hint: String(hint || '').slice(0, 300)
        };
    }

    function mapApiError(status, serverMessage) {
        const detail = stripMarkup(serverMessage).slice(0, 240);

        if ((status === 404 || status === 405 || status === 501) && isLocalRuntime()) {
            return createErrorView(
                '当前本地启动方式没有提供 AI 接口。',
                '本地测试 AI 时，请用 wrangler pages dev . 运行站点，而不是只开静态服务器。'
            );
        }

        if (status === 403) {
            return createErrorView(
                detail ? `AI 请求被安全策略拦截：${detail}` : 'AI 请求被安全策略拦截。',
                '请刷新页面后重试，并确认当前页面和 API 来自同一站点。'
            );
        }

        if (status === 429) {
            return createErrorView(
                'AI 请求过于频繁，请稍后重试。',
                '这个接口有最小请求间隔限制，通常等待 2 到 3 秒后再试就可以。'
            );
        }

        if (status === 500 && detail.includes('DEEPSEEK_API_KEY')) {
            return createErrorView(
                '服务端还没有配置 DEEPSEEK_API_KEY。',
                '请在 Cloudflare Pages / Wrangler 里补上 DEEPSEEK_API_KEY 后再调用 AI。'
            );
        }

        if (detail) {
            return createErrorView(
                `AI 接口返回错误：${detail}`,
                isLocalRuntime()
                    ? '如果你是在本地调试，请优先确认现在是不是用 wrangler pages dev . 启动的。'
                    : '可以去 Cloudflare Functions 日志里查看更详细的服务端报错。'
            );
        }

        return createErrorView(
            `API 请求失败：${status}`,
            isLocalRuntime()
                ? '如果你是在本地调试，请确认函数运行环境已经启动。'
                : '请检查网络连接和服务端函数状态。'
        );
    }

    async function readErrorMessage(response) {
        let detail = '';

        try {
            const contentType = response.headers.get('Content-Type') || '';

            if (contentType.includes('application/json')) {
                const payload = await response.json();
                if (payload && typeof payload.error === 'string' && payload.error.trim()) {
                    detail = payload.error.trim();
                }
            } else {
                const text = (await response.text()).trim();
                if (text) {
                    detail = text.slice(0, 600);
                }
            }
        } catch { }

        return mapApiError(response.status, detail);
    }

    function normalizeThrownError(error) {
        const typedError = /** @type {Error & { userMessage?: string, userHint?: string }} */ (error);

        if (typedError && typedError.userMessage) {
            return createErrorView(typedError.userMessage, typedError.userHint || '');
        }

        if (error && error.name === 'AbortError') {
            return createErrorView('请求超时，请稍后重试。', '如果连续超时，先检查网络或稍后再试一次。');
        }

        const rawMessage = String(error && error.message ? error.message : error || '未知错误').trim();

        if (/Failed to fetch|NetworkError|Load failed|fetch failed|Network request failed/i.test(rawMessage)) {
            return isLocalRuntime()
                ? createErrorView(
                    '当前本地环境没有可用的 AI 接口。',
                    '本地测试 AI 时，请用 wrangler pages dev . 运行站点，而不是只开静态服务器。'
                )
                : createErrorView(
                    '网络连接失败，未能连上 AI 接口。',
                    '请检查站点网络、Cloudflare Functions 状态和服务端日志。'
                );
        }

        return createErrorView(
            rawMessage || '未知错误',
            isLocalRuntime()
                ? '如果你是在本地调试，请确认函数运行环境已经启动。'
                : ''
        );
    }

    // ===== AI 请求配置 =====

    function isEmbeddedBrowser() {
        return STREAM_UNSAFE_UA_RE.test(navigator.userAgent || '');
    }

    function getAIRequestProfile(mode = 'decision') {
        const embedded = isEmbeddedBrowser();
        const isDecisionMode = mode === 'decision';
        const isPreflopDefaultMode = mode === 'preflop-default';
        return {
            compactPrompt: embedded,
            preferStreaming: shouldPreferStreaming(),
            timeoutMs: 30000,
            maxTokens: embedded ? 420 : (isDecisionMode ? 760 : 680),
            temperature: embedded ? 0.08 : (isDecisionMode ? 0.16 : 0.13),
            cacheFreshMs: embedded ? 12 * 60 * 1000 : AI_CACHE_FRESH_MS,
            systemPrompt: embedded
                ? (isDecisionMode
                    ? '你是严谨的德州扑克顾问。只能依据给定数据回答，不虚构历史动作、弃牌率或读牌。当前模式已给出底池、跟注金额和程序建议，你必须优先围绕“继续门槛、跟注赔率、CallEV、SPR、牌力/听牌、牌面纹理”给结论，不能把“继续门槛”说成“加注门槛”。严格输出8行：核心结论、推荐动作、推荐尺寸、赔率与门槛、牌力解读、下一街计划、若遭反击、最大风险。每行1到2短句，总字数不超过320字。'
                    : (isPreflopDefaultMode
                        ? '你是严谨的德州扑克翻前顾问。只能依据给定数据回答，不虚构前人动作。若未提供动作历史，默认按100BB无人入池(open pot)处理，给标准开局建议，不要把建议写成面对下注后的弃牌/跟注结论。严格输出8行：核心结论、推荐开局、位置建议、开局尺寸、牌力依据、手牌特点、若遇反击、补充说明。每行1到2短句，总字数不超过320字。'
                        : '你是严谨的德州扑克翻后顾问。只能依据给定数据回答，不虚构对手下注或历史动作。若未提供跟注金额，只能给默认打法与优先尺寸/控池计划，不要输出纯弃牌/纯跟注百分比。严格输出8行：牌力定位、默认打法、推荐尺寸、关键依据1、关键依据2、危险转牌、下一街计划、最大风险。每行1到2短句，总字数不超过320字。'))
                : (isDecisionMode
                    ? '你是严谨的德州扑克顾问。只能依据给定数据回答，不虚构历史动作、弃牌率或读牌。当前模式已给出底池、跟注金额和程序建议，你必须优先围绕“继续门槛、跟注赔率、CallEV、SPR、牌力/听牌、牌面纹理”给结论，不能把“继续门槛”说成“加注门槛”。严格输出10行：核心结论、推荐动作、推荐尺寸、赔率与门槛、CallEV解读、牌力定位、牌面纹理/阻断、下一街计划、若遭反击、最大风险。每行1到2短句，结论必须和胜率、跟注赔率、CallEV一致，总字数不超过560字。'
                    : (isPreflopDefaultMode
                        ? '你是严谨的德州扑克翻前顾问。只能依据给定数据回答，不虚构前人动作。若未提供动作历史，默认按100BB无人入池(open pot)处理，给标准开局建议，不要把建议写成面对下注后的弃牌/跟注结论。严格输出10行：核心结论、推荐开局、位置建议、开局尺寸、牌力档次、手牌特点、多人修正、若遇3bet、翻后重点、补充说明。每行1到2短句，总字数不超过520字。'
                        : '你是严谨的德州扑克翻后顾问。只能依据给定数据回答，不虚构对手下注或历史动作。若未提供跟注金额，只能给默认打法与优先尺寸/控池计划，不要输出纯弃牌/纯跟注百分比。严格输出10行：牌力定位、默认打法、推荐尺寸、为什么这样打、听牌/阻断、危险转牌、转牌计划、河牌计划、若遭加压、最大风险。每行1到2短句，总字数不超过560字。'))
        };
    }

    function buildAIRequestPayload(prompt, stream, profile) {
        return {
            model: 'deepseek-chat',
            messages: [
                {
                    role: 'system',
                    content: profile.systemPrompt
                },
                { role: 'user', content: prompt }
            ],
            stream,
            max_tokens: profile.maxTokens,
            temperature: profile.temperature,
        };
    }

    function shouldPreferStreaming() {
        const ua = navigator.userAgent || '';
        const hasReadableStream = typeof ReadableStream !== 'undefined';
        return hasReadableStream && !STREAM_UNSAFE_UA_RE.test(ua);
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

    // ===== 响应处理 =====

    async function consumeStreamingResponse(response, content, typing) {
        if (!response.body || typeof response.body.getReader !== 'function') {
            throw new Error('当前浏览器不支持流式响应');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let buffered = '';
        let hasStarted = false;

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
                    fullText += delta;
                    content.innerHTML = simpleMarkdown(fullText);
                    const body = getEl('aiPanelBody');
                    if (body) body.scrollTop = body.scrollHeight;
                } catch { }
            }
        }

        return fullText;
    }

    async function consumeJsonResponse(response, content, typing) {
        const payload = await response.json();
        const fullText = payload?.choices?.[0]?.message?.content || '';

        if (!fullText) {
            throw new Error('AI 返回为空');
        }

        revealAIContent(content, typing);
        renderAIContent(fullText, content);
        return fullText;
    }

    async function requestAI(prompt, content, typing, stream, signal, profile) {
        const response = await fetch(AI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream, application/json',
                'X-Poker-Request': REQUEST_MARKER,
                'X-CSRF-Token': getCsrfToken()
            },
            body: JSON.stringify(buildAIRequestPayload(prompt, stream, profile)),
            signal
        });

        if (!response.ok) {
            const errorView = await readErrorMessage(response);
            const error = /** @type {Error & { userMessage?: string, userHint?: string }} */ (new Error(errorView.message));
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

    // ===== Prompt 构建 =====

    function buildAIPrompt(options = {}) {
        const compact = Boolean(options.compact);
        const mode = options.mode || 'decision';
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
        const handKey = getCurrentHandKey();
        const boardTexture = getBoardTextureSummary();
        const potSize = Math.max(0, Number(situation.potSize) || 0);
        const stack = Math.max(1, Number(situation.effectiveStackBB) || 100);
        const spr = potSize > 0 ? (stack / potSize).toFixed(1) : '\u2014';
        const smallBet = (potSize * 0.33).toFixed(1);
        const midBet = (potSize * 0.6).toFixed(1);
        const largeBet = (potSize * 0.9).toFixed(1);
        const preflopBaseline = mode === 'preflop-default' ? buildPreflopBaselineSummary() : '';
        const coreFacts = [
            `阶段:${stageText}`,
            `手牌简称:${handKey || '-'}`,
            `手牌:${hand.join(' ') || '-'}`,
            `公牌:${community.length > 0 ? community.join(' ') : '-'}`,
            `对手:${state.numOpponents}`,
            `胜平负:${winRate}/${tieRate}/${loseRate}`,
            `当前牌型:${currentHandName || '-'}`
        ];
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
        if (boardTexture) supportFacts.push(`牌面:${boardTexture}`);
        const decisionGuidance = state.situationEnabled
            ? '原则:多人池更收紧; 未给弃牌率与下注历史时少做纯诈唬; 胜率低于门槛且无隐含赔率时优先弃牌; 胜率明显高于门槛时优先价值/继续'
            : '原则:多人池更收紧; 未给弃牌率与下注历史时少做纯诈唬; 未开局面信息时按标准 100BB 默认线给稳健建议';
        const modeSpecificGuidance = mode === 'decision'
            ? '这是精确决策模式: 可以给 fold/call/raise 结论，但必须围绕继续门槛、跟注赔率与 CallEV。'
            : (mode === 'preflop-default'
                ? '这是翻前默认模式: 未提供动作历史时按无人入池处理。不要输出“弃牌100%/跟注100%”这类面对下注的结论。'
                : '这是翻后默认模式: 未提供跟注金额，不要输出纯弃牌/纯跟注百分比；应给默认打法、尺寸和转牌计划。');

        if (mode === 'preflop-default') {
            return [
                '按固定格式快答。',
                coreFacts.join(' | '),
                preflopBaseline ? `本地基线:${preflopBaseline}` : '',
                '上下文:未知位置、未知前人动作、默认100BB无人入池(open pot)',
                modeSpecificGuidance,
                '补充:若对手数=1且翻前胜率明显高于50%，通常不应给纯弃牌。',
                compact ? '输出:1核心结论 2推荐开局 3位置建议 4开局尺寸 5牌力依据 6手牌特点 7若遇反击 8补充说明' : '输出:1核心结论 2推荐开局 3位置建议 4开局尺寸 5牌力档次 6手牌特点 7多人修正 8若遇3bet 9翻后重点 10补充说明',
                compact ? '限制:每行1到2短句,总字数<=320字' : '限制:每行1到2短句,总字数<=520字'
            ].filter(Boolean).join('\n');
        }

        if (mode === 'postflop-default') {
            return [
                '按固定格式快答。',
                coreFacts.join(' | '),
                supportFacts.join(' | '),
                '上下文:未提供底池赔率/跟注金额/对手下注尺度，仅能给默认打法',
                modeSpecificGuidance,
                '补充:若有强听牌、两头顺/同花听或明显成牌，要明确写出主动/被动计划与危险转牌。',
                compact ? '输出:1牌力定位 2默认打法 3推荐尺寸 4关键依据1 5关键依据2 6危险转牌 7下一街计划 8最大风险' : '输出:1牌力定位 2默认打法 3推荐尺寸 4为什么这样打 5听牌/阻断 6危险转牌 7转牌计划 8河牌计划 9若遭加压 10最大风险',
                compact ? '限制:每行1到2短句,总字数<=320字' : '限制:每行1到2短句,总字数<=560字'
            ].filter(Boolean).join('\n');
        }

        return [
            '根据牌局数据给出快答。',
            coreFacts.join(' | '),
            fastFacts.join(' | '),
            supportFacts.join(' | '),
            decisionGuidance,
            modeSpecificGuidance,
            compact ? '输出:1核心结论 2推荐动作 3推荐尺寸 4赔率与门槛 5牌力解读 6下一街计划 7若遭反击 8最大风险' : '输出:1核心结论 2推荐动作 3推荐尺寸 4赔率与门槛 5CallEV解读 6牌力定位 7牌面纹理/阻断 8下一街计划 9若遭反击 10最大风险',
            compact ? '限制:每行1到2短句,不写长推导,总字数<=320字' : '限制:每行1到2短句,不写长推导,总字数<=560字'
        ].filter(Boolean).join('\n');
    }

    function buildAICacheKey(profile) {
        const lastAnalysis = state.lastAnalysis;
        const situation = getSituationSnapshot();
        const hand = state.hand.filter(c => c !== null).map(c =>
            `${RANK_NAMES[c.rank]}${SUIT_SYMBOLS[SUITS[c.suit]]}`
        );
        const community = state.community.filter(c => c !== null).map(c =>
            `${RANK_NAMES[c.rank]}${SUIT_SYMBOLS[SUITS[c.suit]]}`
        );
        const currentHandNameEl = getEl('currentHandName');
        const currentHandName = currentHandNameEl ? currentHandNameEl.textContent : '';

        return JSON.stringify({
            v: 8,
            promptVersion: AI_PROMPT_VERSION,
            mode: getAIContextMode(),
            compact: Boolean(profile && profile.compactPrompt),
            maxTokens: profile && profile.maxTokens,
            temperature: profile && profile.temperature,
            hand,
            community,
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

    // ===== AI 面板交互 =====

    async function askAI() {
        const btn = getEl('aiAdvisorBtn');
        const overlay = getEl('aiPanelOverlay');
        const panel = getEl('aiPanel');
        const typing = getEl('aiTyping');
        const content = getEl('aiContent');

        if (!btn || !panel) return;

        vibrate('medium');

        btn.classList.add('loading');
        overlay.style.display = 'block';
        panel.style.display = 'flex';
        showAIWaiting(typing, content);

        const mode = getAIContextMode();
        const profile = getAIRequestProfile(mode);
        const cacheKey = buildAICacheKey(profile);
        const cachedAdvice = readAIAdviceCache(cacheKey);
        const staleCacheText = cachedAdvice && cachedAdvice.text ? cachedAdvice.text : '';
        const shouldRefreshStaleCache = !!(cachedAdvice && !cachedAdvice.isFresh);



        if (cachedAdvice && cachedAdvice.text) {
            typing.classList.add('hidden');
            content.classList.add('visible');
            renderAIContent(cachedAdvice.text, content);

            if (!shouldRefreshStaleCache) {
                btn.classList.remove('loading');
                vibrate('success');
                return;
            }
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), profile.timeoutMs);

        try {
            const prompt = buildAIPrompt({ compact: profile.compactPrompt, mode });
            const preferStreaming = profile.preferStreaming && !shouldRefreshStaleCache;
            let fullText = '';

            fullText = await getSharedRequest(cacheKey, async () => {
                try {
                    return await requestAI(prompt, content, typing, preferStreaming, controller.signal, profile);
                } catch (error) {
                    const shouldFallback = preferStreaming && /流式响应|ReadableStream|reader/i.test(String(error && error.message ? error.message : error));
                    if (!shouldFallback) {
                        throw error;
                    }

                    content.innerHTML = '';
                    showAIWaiting(typing, content);
                    return requestAI(prompt, content, typing, false, controller.signal, profile);
                }
            });

            if (fullText) {
                writeAIAdviceCache(cacheKey, fullText);
                if (shouldRefreshStaleCache && fullText === staleCacheText) {
                    renderAIContent(staleCacheText, content);
                }
            }
            vibrate('success');

        } catch (err) {
            if (staleCacheText) {
                renderAIContent(staleCacheText, content);
            } else {
                revealAIContent(content, typing);
                const fallbackText = mode === 'preflop-default' ? buildLocalPreflopAdvice() : '';
                if (fallbackText) {
                    renderAIContent(fallbackText, content);
                } else {
                    const errorView = normalizeThrownError(err);
                    const safeMessage = escapeHTML(errorView.message);
                    const safeHint = escapeHTML(errorView.hint);
                    content.innerHTML = `<p style="color:#ef4444;">❌ AI 分析出错：${safeMessage}</p>
                ${safeHint ? `<p style="color:var(--text-muted);font-size:0.85rem;">${safeHint}</p>` : ''}`;
                }
            }
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

    return { askAI, closeAI };
}
