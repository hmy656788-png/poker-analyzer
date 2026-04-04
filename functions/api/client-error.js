/**
 * POST /api/client-error
 * 最小化前端异常收集端点，写入 Cloudflare Function 日志。
 */
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const RATE_LIMIT_STATE = new Map();

function jsonResponse(payload, status) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

function getClientIp(request) {
    const cfConnectingIp = request.headers.get('CF-Connecting-IP');
    if (cfConnectingIp) return cfConnectingIp;

    const forwardedFor = request.headers.get('X-Forwarded-For');
    if (forwardedFor) {
        return forwardedFor.split(',')[0].trim();
    }

    return 'unknown';
}

function cleanLogValue(value, maxLength) {
    return String(value || '')
        .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function isRateLimited(ip, now) {
    for (const [key, entry] of RATE_LIMIT_STATE.entries()) {
        if (entry.resetAt <= now) {
            RATE_LIMIT_STATE.delete(key);
        }
    }

    const entry = RATE_LIMIT_STATE.get(ip);
    if (!entry || entry.resetAt <= now) {
        RATE_LIMIT_STATE.set(ip, {
            count: 1,
            resetAt: now + RATE_LIMIT_WINDOW_MS
        });
        return false;
    }

    entry.count += 1;
    return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

export async function onRequestPost(context) {
    const now = Date.now();
    const ip = getClientIp(context.request);

    if (isRateLimited(ip, now)) {
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
