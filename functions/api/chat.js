/**
 * Cloudflare Pages Function /api/chat
 * Proxy for DeepSeek API to protect the API key.
 */
import { getClientIp, consumeRateLimit } from './_shared.js';

const DEFAULT_ALLOWED_ORIGINS = [
    'https://poker-analyzer.hmyapp.com',
    'https://poker-analyzer.pages.dev',
    'http://localhost:8080',
    'http://localhost:8788',
    'http://127.0.0.1:8080',
    'http://127.0.0.1:8788'
];
const CSRF_COOKIE_NAME = 'poker_csrf';
const ALLOWED_REQUEST_MARKERS = new Set(['ai-advisor', 'ai-advisor-inline']);
const FAST_REQUEST_MARKERS = new Set(['ai-advisor-inline']);
const AI_RESPONSE_CACHE_VERSION = '20260413';
const RETRYABLE_UPSTREAM_STATUS = new Set([408, 425, 500, 502, 503, 504, 522, 524, 529]);

function jsonResponse(payload, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            ...extraHeaders
        }
    });
}

function getAllowedOrigins(env) {
    const fromEnv = String(env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    return fromEnv.length > 0 ? fromEnv : DEFAULT_ALLOWED_ORIGINS;
}

function hasExpectedRequestMarker(request) {
    return ALLOWED_REQUEST_MARKERS.has(String(request.headers.get('X-Poker-Request') || '').trim());
}

function getRequestMarker(request) {
    return String(request.headers.get('X-Poker-Request') || '').trim();
}

function isAllowedSource(request, env) {
    const allowedOrigins = new Set(getAllowedOrigins(env));
    const origin = request.headers.get('Origin') || '';
    const referer = request.headers.get('Referer') || '';

    if (!origin && !referer) {
        return { ok: false, reason: 'Missing origin or referer' };
    }

    let verifiedOrigin = '';

    if (origin) {
        if (!allowedOrigins.has(origin)) {
            return { ok: false, reason: 'Forbidden origin' };
        }
        verifiedOrigin = origin;
    }

    if (referer) {
        let refererOrigin = '';

        try {
            refererOrigin = new URL(referer).origin;
        } catch {
            return { ok: false, reason: 'Invalid referer' };
        }

        if (!allowedOrigins.has(refererOrigin)) {
            return { ok: false, reason: 'Forbidden referer' };
        }

        if (verifiedOrigin && verifiedOrigin !== refererOrigin) {
            return { ok: false, reason: 'Origin and referer mismatch' };
        }

        verifiedOrigin = verifiedOrigin || refererOrigin;
    }

    return { ok: true, verifiedOrigin };
}

function parseCookies(request) {
    const raw = String(request.headers.get('Cookie') || '');
    if (!raw) return {};

    return raw.split(';').reduce((cookies, part) => {
        const [name, ...valueParts] = part.trim().split('=');
        if (!name) return cookies;
        cookies[name] = decodeURIComponent(valueParts.join('=') || '');
        return cookies;
    }, {});
}

function hasValidCsrfToken(request) {
    const cookies = parseCookies(request);
    const cookieToken = String(cookies[CSRF_COOKIE_NAME] || '');
    const headerToken = String(request.headers.get('X-CSRF-Token') || '');

    if (!cookieToken || !headerToken) {
        return { ok: false, reason: 'Missing CSRF token' };
    }

    if (cookieToken.length < 24 || headerToken.length < 24) {
        return { ok: false, reason: 'Invalid CSRF token' };
    }

    if (cookieToken !== headerToken) {
        return { ok: false, reason: 'CSRF token mismatch' };
    }

    return { ok: true };
}

async function assertRateLimit(request, env) {
    const minIntervalMs = Math.max(500, Number(env.CHAT_MIN_INTERVAL_MS) || 2500);
    return consumeRateLimit('chat', getClientIp(request), 1, Math.ceil(minIntervalMs / 1000));
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function normalizeMessageContent(content) {
    return String(content || '')
        .replace(/\*\*/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

function normalizeAssistantContent(content) {
    return String(content || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

function readFiniteNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getRequestPolicy(requestMarker) {
    if (FAST_REQUEST_MARKERS.has(requestMarker)) {
        return {
            maxMessages: 2,
            maxMessageLength: 2600,
            maxTokensDefault: 420,
            maxTokensMax: 760,
            temperatureDefault: 0.14,
            upstreamTimeoutMs: 15000,
            cacheTtlSeconds: 15 * 60,
            retryCount: 1
        };
    }

    return {
        maxMessages: 12,
        maxMessageLength: 2400,
        maxTokensDefault: 1200,
        maxTokensMax: 1600,
        temperatureDefault: 0.55,
        upstreamTimeoutMs: 25000,
        cacheTtlSeconds: 10 * 60,
        retryCount: 1
    };
}

function sanitizeRequestData(requestData, requestMarker) {
    if (!requestData || !Array.isArray(requestData.messages)) {
        return { error: 'Missing messages in request body' };
    }

    const policy = getRequestPolicy(requestMarker);
    const messages = requestData.messages
        .slice(0, policy.maxMessages)
        .map((item) => ({
            role: item && (item.role === 'system' || item.role === 'assistant' || item.role === 'user')
                ? String(item.role)
                : 'user',
            content: normalizeMessageContent(item && item.content ? String(item.content).slice(0, policy.maxMessageLength) : '')
        }))
        .filter((item) => item.content.trim().length > 0);

    if (messages.length === 0) {
        return { error: 'Empty messages' };
    }

    return {
        payload: {
            model: 'deepseek-chat',
            messages,
            stream: requestData.stream !== false,
            max_tokens: clamp(readFiniteNumber(requestData.max_tokens, policy.maxTokensDefault), 96, policy.maxTokensMax),
            temperature: clamp(readFiniteNumber(requestData.temperature, policy.temperatureDefault), 0, 0.8)
        },
        policy,
        adviceContext: sanitizeAdviceContext(requestData.context)
    };
}

// 客户端 buildAIPrompt 随请求附带的结构化牌局事实；只用于本地开发回退，不会转发上游。
const ADVICE_CONTEXT_FIELDS = ['stage', 'handKey', 'hand', 'board', 'opponents', 'winTieLose', 'currentHand', 'texture', 'action', 'callEV', 'potOdds', 'required'];

function sanitizeAdviceContext(rawContext) {
    if (!rawContext || typeof rawContext !== 'object') return null;
    const context = {};
    for (const field of ADVICE_CONTEXT_FIELDS) {
        const value = rawContext[field];
        if (typeof value === 'string' && value.trim()) {
            context[field] = value.trim().slice(0, 120);
        }
    }
    return Object.keys(context).length > 0 ? context : null;
}

async function sha256Hex(input) {
    const payload = new TextEncoder().encode(String(input || ''));
    const digest = await crypto.subtle.digest('SHA-256', payload);
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

async function buildCompletionCacheRequest(requestMarker, payload) {
    // assistant 消息必须参与 cache key：追问答案依赖上一轮 AI 回复，
    // 若过滤掉，不同回复上下文的相同追问会命中同一缓存，返回答非所问的解释。
    const hash = await sha256Hex(JSON.stringify({
        v: AI_RESPONSE_CACHE_VERSION,
        requestMarker,
        model: payload.model,
        messages: payload.messages,
        max_tokens: payload.max_tokens,
        temperature: payload.temperature
    }));

    return new Request(`https://internal-ai-cache.local/chat/${AI_RESPONSE_CACHE_VERSION}/${requestMarker}/${hash}`, {
        method: 'GET'
    });
}

function createCompletionResponse(content, model = 'deepseek-chat', metadata = {}) {
    const normalizedContent = normalizeAssistantContent(content);
    return {
        id: metadata.id || `chatcmpl-cache-${Date.now()}`,
        object: 'chat.completion',
        created: metadata.created || Math.floor(Date.now() / 1000),
        model,
        choices: [
            {
                index: 0,
                finish_reason: metadata.finishReason || 'stop',
                message: {
                    role: 'assistant',
                    content: normalizedContent
                }
            }
        ],
        usage: metadata.usage || undefined
    };
}

function isLocalDevelopmentRequest(request) {
    try {
        const { hostname } = new URL(request.url);
        return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    } catch {
        return false;
    }
}

function extractPromptFact(prompt, label) {
    const match = String(prompt || '').match(new RegExp(`${label}:([^|\\n]+)`));
    return match ? match[1].trim() : '';
}

function createLocalDevelopmentAdvice(payload, context) {
    const userMessage = [...payload.messages].reverse().find((message) => message.role === 'user');
    const prompt = userMessage ? userMessage.content : '';
    const ctx = context || {};
    // 优先读结构化 context；缺失时回退到从 prompt 文本反解（兼容旧客户端缓存的页面）
    const fact = (key, label) => ctx[key] || extractPromptFact(prompt, label);
    const stage = fact('stage', '阶段') || '当前阶段';
    const hand = fact('hand', '手牌') || fact('handKey', '手牌简称') || '当前手牌';
    const board = fact('board', '公牌') || '-';
    const opponents = fact('opponents', '对手') || '-';
    const winTieLose = fact('winTieLose', '胜平负') || '-';
    const currentHand = fact('currentHand', '当前牌型') || '-';
    const action = fact('action', '程序建议') || '';
    const callEV = fact('callEV', 'CallEV') || '';
    const potOdds = fact('potOdds', '跟注赔率') || '';
    const required = fact('required', '继续门槛') || '';
    const texture = fact('texture', '牌面纹理') || '';

    const decisionLine = action
        ? `建议优先参考程序决策“${action}”，再结合对手倾向和下注尺度微调。`
        : '建议结合位置、对手数量和牌面结构，优先选择风险可控的继续方式。';
    const evLine = callEV || potOdds || required
        ? `赔率信息：底池赔率 ${potOdds || '-'}，继续门槛 ${required || '-'}，Call EV ${callEV || '-'}。`
        : '当前未提供完整底池赔率，建议补充底池和跟注金额后再做精确决策。';
    const textureLine = texture ? `牌面纹理：${texture}。` : `公共牌：${board}。`;

    return [
        `🎯 牌力定位: ${stage}，手牌 ${hand}，对手 ${opponents} 位，当前牌型 ${currentHand}，胜平负为 ${winTieLose}。`,
        `💰 赔率分析: ${evLine}`,
        `🃏 牌面解读: ${textureLine}`,
        `✅ 行动建议: ${decisionLine}`,
        '⚠️ 注意事项: 当前为本地策略分析，用于在本地环境下提供即时参考；联网 AI 配置后可返回更完整的模型建议。'
    ].join('\n');
}

function extractCompletionText(payload) {
    return normalizeAssistantContent(payload?.choices?.[0]?.message?.content || '');
}

async function readCachedCompletion(cacheRequest) {
    const cached = await caches.default.match(cacheRequest);
    if (!cached) return null;

    try {
        const payload = await cached.json();
        const content = extractCompletionText(payload);
        if (!content) {
            await caches.default.delete(cacheRequest);
            return null;
        }
        return createCompletionResponse(content, payload?.model || 'deepseek-chat', payload);
    } catch {
        await caches.default.delete(cacheRequest);
        return null;
    }
}

async function writeCachedCompletion(cacheRequest, completion, ttlSeconds) {
    const content = extractCompletionText(completion);
    if (!content) return;

    await caches.default.put(
        cacheRequest,
        new Response(JSON.stringify(createCompletionResponse(content, completion?.model || 'deepseek-chat', completion)), {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`
            }
        })
    );
}

function createClientCompletionResponse(completion, extraHeaders = {}) {
    return new Response(JSON.stringify(completion), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'X-Proxy-Guard': 'enabled',
            ...extraHeaders
        }
    });
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchUpstreamWithRetry(url, init, policy) {
    const maxAttempts = Math.max(1, Number(policy.retryCount) + 1);
    let lastError = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(new Error('Upstream timeout')), policy.upstreamTimeoutMs);

        try {
            const response = await fetch(url, {
                ...init,
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (response.ok || !RETRYABLE_UPSTREAM_STATUS.has(response.status) || attempt === maxAttempts - 1) {
                return response;
            }

            try {
                await response.body?.cancel?.();
            } catch { }
        } catch (error) {
            clearTimeout(timeoutId);
            lastError = error;
            if (attempt === maxAttempts - 1) {
                throw error;
            }
        }

        await sleep(160 * (attempt + 1));
    }

    throw lastError || new Error('Upstream request failed');
}

async function cacheStreamingCompletion(stream, cacheRequest, payload, policy) {
    if (!stream || typeof stream.getReader !== 'function') return;

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    let content = '';
    let upstreamId = '';
    let finishReason = 'stop';
    let usage = undefined;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split('\n');
        buffered = lines.pop() || '';

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data:')) continue;

            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') {
                continue;
            }

            try {
                const parsed = JSON.parse(data);
                if (parsed.id && !upstreamId) upstreamId = parsed.id;
                if (parsed.usage) usage = parsed.usage;

                const delta = parsed?.choices?.[0]?.delta?.content || '';
                if (delta) content += delta;

                const chunkFinishReason = parsed?.choices?.[0]?.finish_reason;
                if (chunkFinishReason) finishReason = chunkFinishReason;
            } catch { }
        }
    }

    const normalizedContent = normalizeAssistantContent(content);
    if (!normalizedContent) return;

    await writeCachedCompletion(
        cacheRequest,
        createCompletionResponse(normalizedContent, payload.model, {
            id: upstreamId || undefined,
            finishReason,
            usage
        }),
        policy.cacheTtlSeconds
    );
}

export async function onRequestPost(context) {
    // 只允许从环境变量读取密钥，避免硬编码泄露
    const DEEPSEEK_API_KEY = context.env.DEEPSEEK_API_KEY;
    const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

    try {
        const request = context.request;
        const contentLength = Number(request.headers.get('Content-Length') || '0');
        const requestMarker = getRequestMarker(request);

        if (!hasExpectedRequestMarker(request)) {
            return jsonResponse({ error: 'Missing request marker' }, 403);
        }

        const sourceCheck = isAllowedSource(request, context.env);
        if (!sourceCheck.ok) {
            return jsonResponse({ error: sourceCheck.reason }, 403);
        }

        const csrfCheck = hasValidCsrfToken(request);
        if (!csrfCheck.ok) {
            return jsonResponse({ error: csrfCheck.reason }, 403);
        }

        if (contentLength > 40000) {
            return jsonResponse({ error: 'Request payload too large' }, 413);
        }

        const ua = request.headers.get('User-Agent') || '';
        if (!ua) {
            return jsonResponse({ error: 'Missing user agent' }, 400);
        }

        let requestData = null;
        try {
            requestData = await request.json();
        } catch {
            return jsonResponse({ error: 'Invalid JSON body' }, 400);
        }

        const { payload, policy, error, adviceContext } = sanitizeRequestData(requestData, requestMarker);
        if (error) {
            return jsonResponse({ error }, 400);
        }

        const cacheRequest = await buildCompletionCacheRequest(requestMarker, payload);
        const cachedCompletion = await readCachedCompletion(cacheRequest);
        if (cachedCompletion) {
            return createClientCompletionResponse(cachedCompletion, { 'X-AI-Cache': 'HIT' });
        }

        if (!DEEPSEEK_API_KEY) {
            if (isLocalDevelopmentRequest(request)) {
                const completion = createCompletionResponse(
                    createLocalDevelopmentAdvice(payload, adviceContext),
                    'local-dev-advisor',
                    { id: `chatcmpl-local-${Date.now()}` }
                );

                return createClientCompletionResponse(completion, {
                    'X-AI-Cache': 'BYPASS',
                    'X-AI-Fallback': 'local-dev'
                });
            }
            return jsonResponse({ error: 'Server missing DEEPSEEK_API_KEY' }, 500);
        }

        const passRateLimit = await assertRateLimit(request, context.env);
        if (!passRateLimit) {
            return jsonResponse({ error: 'Too many requests, retry later' }, 429);
        }

        // 3. 构建发给 DeepSeek 的请求头部
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('Accept', payload.stream ? 'text/event-stream, application/json' : 'application/json');
        headers.set('Authorization', `Bearer ${DEEPSEEK_API_KEY}`);

        // 发起请求到真实的 LLM Endpoint
        const response = await fetchUpstreamWithRetry(DEEPSEEK_API_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        }, policy);

        // 4. 将 DeepSeek 的响应透传回前端客户端，避免缓存
        if (!response.ok) {
            // 将上游错误统一转为 JSON 格式，方便前端解析
            let upstreamError = `DeepSeek API error: ${response.status}`;
            try {
                const ct = String(response.headers.get('Content-Type') || '').toLowerCase();
                if (ct.includes('application/json')) {
                    const body = await response.json();
                    upstreamError = body?.error?.message || body?.error || body?.message || upstreamError;
                } else {
                    const text = (await response.text()).slice(0, 500).trim();
                    if (text) upstreamError = text;
                }
            } catch { }

            return jsonResponse(
                { error: String(upstreamError).slice(0, 300) },
                response.status >= 500 ? 502 : response.status
            );
        }

        const contentType = String(response.headers.get('Content-Type') || '').toLowerCase();

        if (!payload.stream || contentType.includes('application/json')) {
            const upstreamPayload = await response.json();
            const completion = createCompletionResponse(
                extractCompletionText(upstreamPayload),
                upstreamPayload?.model || payload.model,
                upstreamPayload
            );

            if (extractCompletionText(completion)) {
                const cacheWrite = writeCachedCompletion(cacheRequest, completion, policy.cacheTtlSeconds).catch(() => null);
                if (typeof context.waitUntil === 'function') {
                    context.waitUntil(cacheWrite);
                }
            }

            return createClientCompletionResponse(completion, { 'X-AI-Cache': 'MISS' });
        }

        const resHeaders = new Headers(response.headers);
        resHeaders.set('Cache-Control', 'no-store');
        resHeaders.set('X-Proxy-Guard', 'enabled');
        resHeaders.set('X-AI-Cache', 'MISS');

        if (response.body && typeof response.body.tee === 'function') {
            const [clientStream, cacheStream] = response.body.tee();
            const cacheWrite = cacheStreamingCompletion(cacheStream, cacheRequest, payload, policy).catch(() => null);
            if (typeof context.waitUntil === 'function') {
                context.waitUntil(cacheWrite);
            }

            return new Response(clientStream, {
                status: response.status,
                statusText: response.statusText,
                headers: resHeaders
            });
        }

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: resHeaders
        });

    } catch (error) {
        // 请求中间发生致命错误
        const message = error && typeof error.message === 'string'
            ? error.message
            : 'Unknown server error';
        return jsonResponse({ error: message }, 500);
    }
}
