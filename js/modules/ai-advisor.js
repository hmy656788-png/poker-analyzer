// js/modules/ai-advisor.js

function setupAIAdvisor({ 
    state, getEl, vibrate, getStageText, formatChips, 
    calculateDecisionMetrics, getSituationSnapshot, getOpponentProfile, 
    RANK_NAMES, SUIT_SYMBOLS, SUITS 
}) {
    const AI_API_URL = '/api/chat';
    const REQUEST_MARKER = 'ai-advisor';
    const STREAM_UNSAFE_UA_RE = /MicroMessenger|QQ\/|QQBrowser|MetaSr|WebView/i;
    const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

    function escapeHTML(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function simpleMarkdown(text) {
        const safeText = escapeHTML(text);
        return safeText
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/^## (.+)$/gm, '<h3>$1</h3>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
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

    function createErrorView(message, hint = '') {
        return {
            message: String(message || '未知错误').slice(0, 280),
            hint: String(hint || '').slice(0, 280)
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
                '当前来源未被 AI 接口允许。',
                '请检查 Cloudflare 环境变量 ALLOWED_ORIGINS，并确认页面和函数来自同一站点。'
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

    function buildAIRequestPayload(prompt, stream) {
        return {
            model: 'deepseek-chat',
            messages: [
                {
                    role: 'system',
                    content: '你是高水平德州扑克教练。回答必须量化：动作频率、下注尺寸、诈唬频率、下一街计划都要给出具体数字，结论要与胜率/EV一致，输出适合手机阅读。'
                },
                { role: 'user', content: prompt }
            ],
            stream,
            max_tokens: 1500,
            temperature: 0.7,
        };
    }

    function shouldPreferStreaming() {
        const ua = navigator.userAgent || '';
        const hasReadableStream = typeof ReadableStream !== 'undefined';
        return hasReadableStream && !STREAM_UNSAFE_UA_RE.test(ua);
    }

    async function consumeStreamingResponse(response, content) {
        if (!response.body || typeof response.body.getReader !== 'function') {
            throw new Error('当前浏览器不支持流式响应');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let buffered = '';

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
                    fullText += delta;
                    content.innerHTML = simpleMarkdown(fullText);
                    const body = getEl('aiPanelBody');
                    if (body) body.scrollTop = body.scrollHeight;
                } catch { }
            }
        }

        return fullText;
    }

    async function consumeJsonResponse(response, content) {
        const payload = await response.json();
        const fullText = payload?.choices?.[0]?.message?.content || '';

        if (!fullText) {
            throw new Error('AI 返回为空');
        }

        content.innerHTML = simpleMarkdown(fullText);
        const body = getEl('aiPanelBody');
        if (body) body.scrollTop = body.scrollHeight;
        return fullText;
    }

    async function requestAI(prompt, content, stream, signal) {
        const response = await fetch(AI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream, application/json',
                'X-Poker-Request': REQUEST_MARKER
            },
            body: JSON.stringify(buildAIRequestPayload(prompt, stream)),
            signal
        });

        if (!response.ok) {
            const errorView = await readErrorMessage(response);
            const error = /** @type {Error & { userMessage?: string, userHint?: string }} */ (new Error(errorView.message));
            error.userMessage = errorView.message;
            error.userHint = errorView.hint;
            throw error;
        }

        return stream
            ? consumeStreamingResponse(response, content)
            : consumeJsonResponse(response, content);
    }

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

        btn.classList.add('loading');
        overlay.style.display = 'block';
        panel.style.display = 'flex';
        typing.classList.remove('hidden');
        content.classList.remove('visible');
        content.innerHTML = '';

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

        try {
            const prompt = buildAIPrompt();

            typing.classList.add('hidden');
            content.classList.add('visible');
            const preferStreaming = shouldPreferStreaming();

            try {
                await requestAI(prompt, content, preferStreaming, controller.signal);
            } catch (error) {
                const shouldFallback = preferStreaming && /流式响应|ReadableStream|reader/i.test(String(error && error.message ? error.message : error));
                if (!shouldFallback) {
                    throw error;
                }

                content.innerHTML = '';
                await requestAI(prompt, content, false, controller.signal);
            }
            vibrate('success');

        } catch (err) {
            typing.classList.add('hidden');
            content.classList.add('visible');
            const errorView = normalizeThrownError(err);
            const safeMessage = escapeHTML(errorView.message);
            const safeHint = escapeHTML(errorView.hint);
            content.innerHTML = `<p style="color:#ef4444;">❌ AI 分析出错：${safeMessage}</p>
            ${safeHint ? `<p style="color:var(--text-muted);font-size:0.85rem;">${safeHint}</p>` : ''}`;
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
