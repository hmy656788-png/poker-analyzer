/**
 * Cloudflare Pages Function /api/chat
 * Proxy for DeepSeek API to protect the API key.
 */

const DEFAULT_ALLOWED_ORIGINS = [
    'https://poker-analyzer.pages.dev',
    'http://localhost:8080',
    'http://127.0.0.1:8080'
];

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

function getClientIP(request) {
    const direct = request.headers.get('CF-Connecting-IP');
    if (direct) return direct;
    const forwarded = request.headers.get('X-Forwarded-For');
    if (!forwarded) return 'unknown';
    return forwarded.split(',')[0].trim();
}

async function assertRateLimit(request, env) {
    const cache = caches.default;
    const ip = getClientIP(request);
    const minIntervalMs = Math.max(500, Number(env.CHAT_MIN_INTERVAL_MS) || 2500);
    const ttlSeconds = Math.ceil(minIntervalMs / 1000);
    const key = new Request(`https://internal-rate-limit.local/chat/${ip}`);
    const existing = await cache.match(key);

    if (existing) return false;

    await cache.put(
        key,
        new Response('1', {
            headers: {
                'Cache-Control': `max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`
            }
        })
    );
    return true;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function sanitizeRequestData(requestData) {
    if (!requestData || !Array.isArray(requestData.messages)) {
        return { error: 'Missing messages in request body' };
    }

    const messages = requestData.messages
        .slice(0, 8)
        .map((item) => ({
            role: item && item.role ? String(item.role) : 'user',
            content: item && item.content ? String(item.content).slice(0, 2200) : ''
        }))
        .filter((item) => item.content.trim().length > 0);

    if (messages.length === 0) {
        return { error: 'Empty messages' };
    }

    return {
        payload: {
            model: 'deepseek-chat',
            messages,
            stream: true,
            max_tokens: clamp(Number(requestData.max_tokens) || 1200, 128, 1600),
            temperature: clamp(Number(requestData.temperature) || 0.7, 0, 1.2)
        }
    };
}

export async function onRequestPost(context) {
    // 只允许从环境变量读取密钥，避免硬编码泄露
    const DEEPSEEK_API_KEY = context.env.DEEPSEEK_API_KEY;
    const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

    try {
        const request = context.request;
        const allowedOrigins = getAllowedOrigins(context.env);
        const origin = request.headers.get('Origin') || '';
        const referer = request.headers.get('Referer') || '';
        const contentLength = Number(request.headers.get('Content-Length') || '0');
        const passOrigin = allowedOrigins.includes(origin);
        const passReferer = allowedOrigins.some((allowed) => referer.startsWith(allowed));

        if (!passOrigin && !passReferer) {
            return jsonResponse({ error: 'Forbidden origin' }, 403);
        }

        if (contentLength > 40000) {
            return jsonResponse({ error: 'Request payload too large' }, 413);
        }

        const ua = request.headers.get('User-Agent') || '';
        if (!ua) {
            return jsonResponse({ error: 'Missing user agent' }, 400);
        }

        const passRateLimit = await assertRateLimit(request, context.env);
        if (!passRateLimit) {
            return jsonResponse({ error: 'Too many requests, retry later' }, 429);
        }

        if (!DEEPSEEK_API_KEY) {
            return jsonResponse({ error: 'Server missing DEEPSEEK_API_KEY' }, 500);
        }

        // 1. 获取前端传来的 JSON 请求体
        const requestData = await request.json();
        const { payload, error } = sanitizeRequestData(requestData);
        if (error) {
            return jsonResponse({ error }, 400);
        }

        // 3. 构建发给 DeepSeek 的请求头部
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('Authorization', `Bearer ${DEEPSEEK_API_KEY}`);

        // 发起请求到真实的 LLM Endpoint
        const response = await fetch(DEEPSEEK_API_URL, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });

        // 4. 将 DeepSeek 的响应透传回前端客户端，避免缓存
        const resHeaders = new Headers(response.headers);
        resHeaders.set('Cache-Control', 'no-store');
        resHeaders.set('X-Proxy-Guard', 'enabled');

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: resHeaders
        });

    } catch (error) {
        // 请求中间发生致命错误
        return jsonResponse({ error: error.message }, 500);
    }
}
