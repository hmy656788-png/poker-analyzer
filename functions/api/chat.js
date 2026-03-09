/**
 * Cloudflare Pages Function /api/chat
 * Proxy for DeepSeek API to protect the API key.
 */
export async function onRequestPost(context) {
    // 只允许从环境变量读取密钥，避免硬编码泄露
    const DEEPSEEK_API_KEY = context.env.DEEPSEEK_API_KEY;
    const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

    try {
        if (!DEEPSEEK_API_KEY) {
            return new Response(JSON.stringify({ error: 'Server missing DEEPSEEK_API_KEY' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // 1. 获取前端传来的 JSON 请求体
        const requestData = await context.request.json();

        // 2. 验证前端传来的必须有 prompt 或 messages
        if (!requestData || !requestData.messages) {
            return new Response(JSON.stringify({ error: 'Missing messages in request body' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // 3. 构建发给 DeepSeek 的请求头部
        const headers = new Headers();
        headers.set('Content-Type', 'application/json');
        headers.set('Authorization', `Bearer ${DEEPSEEK_API_KEY}`);

        // 发起请求到真实的 LLM Endpoint
        const response = await fetch(DEEPSEEK_API_URL, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestData)
        });

        // 4. 将 DeepSeek 的响应（包括 HTTP 状态码、Header 和 Stream）透传回前端客户端
        const resHeaders = new Headers(response.headers);
        // 如果想处理跨域，可以在这里添加 CORS Headers
        // resHeaders.set("Access-Control-Allow-Origin", "*");

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: resHeaders
        });

    } catch (error) {
        // 请求中间发生致命错误
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
