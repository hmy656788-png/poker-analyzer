const VISION_MODEL = '@cf/unum/uform-gen2-qwen-500m';

const DEFAULT_PROMPT = `Read the poker cards visible inside the guide frame.
Ignore the table, glare, shadows, hands, and background.
Return only Texas Hold'em card codes from left to right.
Use ranks 2-9, T, J, Q, K, A and suits s, h, d, c.
Example output: "Tc, 9h, 7h"
If a card is uncertain, omit it. If nothing is readable, output "None".`;

const SUIT_FOCUS_PROMPT = `Read ONLY the corner indexes on each poker card.
Focus especially on the suit symbol next to the rank in the top-left or bottom-right corner.
Map suits exactly as:
- spade or ♠ => s
- heart or ♥ => h
- diamond or ♦ => d
- club or ♣ => c
Return only Texas Hold'em codes from left to right such as "Tc, 9h, 7h".
Do not explain anything. If the suit is unclear, omit that card instead of guessing.`;

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
        }
    });
}

function extractVisionText(response) {
    if (typeof response === 'string') return response.trim();
    if (!response || typeof response !== 'object') return '';

    if (typeof response.description === 'string') return response.description.trim();
    if (typeof response.response === 'string') return response.response.trim();
    if (typeof response.result === 'string') return response.result.trim();
    return '';
}

function describeVisionError(error) {
    const message = error && error.message ? String(error.message) : String(error || 'Unknown error');
    if (message.includes('3046')) {
        return '识图超时，请把牌放近一点并减少反光后重试';
    }
    if (message.includes('3010')) {
        return '图片数据无效，请重新拍摄后再试';
    }
    if (message.includes('AI binding unavailable')) {
        return '识图服务暂时不可用，请稍后重试';
    }
    return message;
}

function buildPrompt(mode) {
    return mode === 'suit-focus' ? SUIT_FOCUS_PROMPT : DEFAULT_PROMPT;
}

export async function onRequestPost(context) {
    const { request, env } = context;
    let mode = 'default';

    try {
        const contentType = request.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
            return jsonResponse({ error: "Unsupported Media Type" }, 415);
        }

        const body = await request.json();
        if (!body.image) {
            return jsonResponse({ error: "Missing image" }, 400);
        }
        mode = typeof body.mode === 'string' ? body.mode : 'default';

        // Image should be a base64 encoded string starting with 'data:image/jpeg;base64,'
        const base64Str = body.image.split(',')[1] || body.image;
        if (!base64Str) {
            return jsonResponse({ error: "Invalid image format" }, 400);
        }

        // Convert base64 string to Uint8Array
        const binaryString = atob(base64Str);
        const imageArray = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            imageArray[i] = binaryString.charCodeAt(i);
        }

        // Keep vision requests small to improve inference latency on mobile uploads.
        if (imageArray.length > 1600 * 1024) {
             return jsonResponse({ error: "Image too large. Must be under 1.6MB" }, 413);
        }

        if (!env.AI || typeof env.AI.run !== 'function') {
            return jsonResponse({ error: "AI binding unavailable" }, 500);
        }

        const response = await env.AI.run(VISION_MODEL, {
            prompt: buildPrompt(mode),
            image: [...imageArray],
            max_tokens: 48,
            temperature: 0
        });

        const resultText = extractVisionText(response);

        return jsonResponse({
            cards: resultText.trim(),
            raw: resultText,
            model: VISION_MODEL,
            mode
        });

    } catch (error) {
        console.error("AI Vision Error:", error);
        return jsonResponse({
            error: "Failed to process image",
            details: describeVisionError(error),
            model: VISION_MODEL,
            mode
        }, 500);
    }
}
