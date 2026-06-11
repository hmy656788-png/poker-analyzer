/**
 * POST /api/client-error
 * 最小化前端异常收集端点，写入 Cloudflare Function 日志。
 */
import { getClientIp, consumeRateLimit } from './_shared.js';

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 30;

function jsonResponse(payload, status) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

function cleanLogValue(value, maxLength) {
    return String(value || '')
        .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

export async function onRequestPost(context) {
    const ip = getClientIp(context.request);

    if (!(await consumeRateLimit('client-error', ip, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_SECONDS))) {
        return new Response(null, { status: 204 });
    }

    try {
        const payload = await context.request.json();
        const requestMeta = {
            colo: context.request.cf && context.request.cf.colo ? context.request.cf.colo : 'unknown',
            country: context.request.cf && context.request.cf.country ? context.request.cf.country : 'unknown',
            ray: cleanLogValue(context.request.headers.get('cf-ray') || 'unknown', 128),
            ip: cleanLogValue(ip, 128)
        };

        const sanitized = {
            type: cleanLogValue(payload.type || 'error', 64),
            message: cleanLogValue(payload.message || 'Unknown error', 500),
            source: cleanLogValue(payload.source || '', 300),
            lineno: Number(payload.lineno) || 0,
            colno: Number(payload.colno) || 0,
            stack: cleanLogValue(payload.stack || '', 3000),
            url: cleanLogValue(payload.url || '', 500),
            userAgent: cleanLogValue(payload.userAgent || '', 500),
            build: cleanLogValue(payload.build || '', 64),
            timestamp: cleanLogValue(payload.timestamp || new Date().toISOString(), 64),
            requestMeta
        };

        console.error('[client-error]', JSON.stringify(sanitized));

        return new Response(null, { status: 204 });
    } catch {
        return jsonResponse({ error: 'Invalid client error payload' }, 400);
    }
}
