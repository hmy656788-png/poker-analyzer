/**
 * POST /api/request-access
 * 提交访问申请
 */
function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

function normalizeReason(value) {
    if (value == null || value === '') {
        return 'No reason provided';
    }
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim().replace(/\s+/g, ' ');
    if (!normalized) {
        return 'No reason provided';
    }

    return normalized.slice(0, 500);
}

export async function onRequestPost(context) {
    const { ACCESS_DB } = context.env;
    const email = context.request.headers.get('Cf-Access-Authenticated-User-Email');

    if (!email) {
        return jsonResponse({ error: 'unauthenticated' }, 401);
    }

    try {
        const body = await context.request.json();
        const reason = normalizeReason(body && typeof body === 'object' ? body.reason : undefined);
        if (reason === null) {
            return jsonResponse({ error: 'reason must be a string' }, 400);
        }

        await ACCESS_DB.prepare(
            `INSERT INTO access_requests (email, reason, status) VALUES (?, ?, 'pending')`
        ).bind(email, reason).run();

        return jsonResponse({ success: true, status: 'pending' });

    } catch (e) {
        const message = e && e.message ? String(e.message) : '';
        if (message.includes('UNIQUE constraint failed') || message.includes('SQLITE_CONSTRAINT')) {
            return jsonResponse({ error: 'Request already exists' }, 409);
        }

        return jsonResponse({ error: 'failed_to_submit_request' }, 500);
    }
}
