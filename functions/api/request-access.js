/**
 * POST /api/request-access
 * 提交访问申请
 */
export async function onRequestPost(context) {
    const { ACCESS_DB } = context.env;
    const email = context.request.headers.get('Cf-Access-Authenticated-User-Email');

    if (!email) {
        return new Response(JSON.stringify({ error: 'unauthenticated' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const body = await context.request.json();
        const reason = body.reason || 'No reason provided';

        // 检查是否已经申请过
        const { results } = await ACCESS_DB.prepare(
            `SELECT * FROM access_requests WHERE email = ?`
        ).bind(email).all();

        if (results && results.length > 0) {
            return new Response(JSON.stringify({ error: 'Request already exists' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // 插入新的申请 (默认 pending 状态)
        await ACCESS_DB.prepare(
            `INSERT INTO access_requests (email, reason, status) VALUES (?, ?, 'pending')`
        ).bind(email, reason).run();

        return new Response(JSON.stringify({ success: true, status: 'pending' }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
