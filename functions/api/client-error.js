/**
 * POST /api/client-error
 * 最小化前端异常收集端点，写入 Cloudflare Function 日志。
 */
export async function onRequestPost(context) {
    try {
        const payload = await context.request.json();
        const requestMeta = {
            colo: context.request.cf && context.request.cf.colo ? context.request.cf.colo : 'unknown',
            country: context.request.cf && context.request.cf.country ? context.request.cf.country : 'unknown',
            ray: context.request.headers.get('cf-ray') || 'unknown',
        };

        const sanitized = {
            type: String(payload.type || 'error').slice(0, 64),
            message: String(payload.message || 'Unknown error').slice(0, 500),
            source: String(payload.source || '').slice(0, 300),
            lineno: Number(payload.lineno) || 0,
            colno: Number(payload.colno) || 0,
            stack: String(payload.stack || '').slice(0, 3000),
            url: String(payload.url || '').slice(0, 500),
            userAgent: String(payload.userAgent || '').slice(0, 500),
            build: String(payload.build || '').slice(0, 64),
            timestamp: String(payload.timestamp || new Date().toISOString()).slice(0, 64),
            requestMeta
        };

        console.error('[client-error]', JSON.stringify(sanitized));

        return new Response(null, { status: 204 });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
