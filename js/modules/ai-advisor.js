// js/modules/ai-advisor.js

export function setupAIAdvisor({ 
    state, getEl, vibrate, getStageText, formatChips, 
    calculateDecisionMetrics, getSituationSnapshot, getOpponentProfile, 
    RANK_NAMES, SUIT_SYMBOLS, SUITS 
}) {
    const AI_API_URL = '/api/chat';

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
                        const body = getEl('aiPanelBody');
                        if (body) body.scrollTop = body.scrollHeight;
                    } catch (e) { }
                }
            }
            vibrate('success');

        } catch (err) {
            typing.classList.add('hidden');
            content.classList.add('visible');
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

    return { askAI, closeAI };
}
