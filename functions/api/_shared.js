/**
 * functions/api 共享工具（下划线前缀的文件不会注册为路由）。
 */

export function getClientIp(request) {
    const cfConnectingIp = request.headers.get('CF-Connecting-IP');
    if (cfConnectingIp) return cfConnectingIp;

    const forwardedFor = request.headers.get('X-Forwarded-For');
    if (forwardedFor) {
        return forwardedFor.split(',')[0].trim();
    }

    return 'unknown';
}

/**
 * 基于 caches.default 的计数窗口限流（per-colo、尽力而为）。
 * 占用一个配额并返回是否放行；窗口随最后一次写入滑动。
 */
export async function consumeRateLimit(scope, ip, maxRequests, windowSeconds) {
    const cache = caches.default;
    const key = new Request(`https://internal-rate-limit.local/${scope}/${ip}`);
    const existing = await cache.match(key);

    let count = 0;
    if (existing) {
        try { count = parseInt(await existing.text(), 10) || 0; } catch {}
    }

    if (count >= maxRequests) return false;

    await cache.put(
        key,
        new Response(String(count + 1), {
            headers: {
                'Cache-Control': `max-age=${windowSeconds}, s-maxage=${windowSeconds}`
            }
        })
    );
    return true;
}
