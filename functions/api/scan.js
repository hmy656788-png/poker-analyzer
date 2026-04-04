// ---------------------------------------------------------------------------
// Poker Card Scanner API — Three-tier model chain with CoT prompts
// ---------------------------------------------------------------------------

const MODEL_CHAIN = [
    { id: '@cf/moonshotai/kimi-k2.5',                    name: 'Kimi K2.5',          isKimi: true  },
    { id: '@cf/meta/llama-4-scout-17b-16e-instruct',     name: 'Llama 4 Scout',      isKimi: false },
    { id: '@cf/meta/llama-3.2-11b-vision-instruct',      name: 'Llama 3.2 Vision',   isKimi: false },
];

// ── System prompt — Chain-of-Thought guided ─────────────────────────────────

const SYSTEM_PROMPT = `You are a poker card recognition expert. Follow these steps to identify cards:

STEP 1: Count how many cards are visible in the photo.
STEP 2: For each card, read the RANK from the corner index (the large character):
  - Number cards: 2,3,4,5,6,7,8,9
  - T = 10 (often written as "10")
  - J = Jack, Q = Queen, K = King, A = Ace
STEP 3: For each card, identify the SUIT SYMBOL in the corner:
  - ♠ spade (s): black, pointed top like an inverted heart with a stem
  - ♥ heart (h): red, rounded bumps on top, pointed bottom
  - ♦ diamond (d): red, rotated square / rhombus shape
  - ♣ club (c): black, three rounded lobes like a clover
STEP 4: Output ONLY the final answer as comma-separated two-character codes.

CRITICAL RULES:
- Rank codes: 2,3,4,5,6,7,8,9,T,J,Q,K,A
- Suit codes: s,h,d,c
- Separate cards with ", " (comma space)
- Output NOTHING except the card codes on a single line
- If you cannot identify any card, output exactly: None

WATCH OUT:
- 6 vs 9: check card orientation
- Red suits: ♥ has rounded top, ♦ has pointed top
- Black suits: ♠ has pointed top, ♣ has rounded lobes

EXAMPLES of correct output:
Ah, Kd
Tc, 9h, 7d
As, Kh, Qd, Jc, Ts`;

// ── User prompts per mode ───────────────────────────────────────────────────

const USER_PROMPTS = {
    default: `Look at this photo of poker playing cards.
Read the corner index of each card (the small rank letter/number and suit symbol printed at the top-left or bottom-right corner).
Output the card codes from left to right.`,

    'suit-focus': `This is a close-up photo of poker card corners.
Focus specifically on the SUIT SYMBOL next to the rank in each corner.
Determine each suit: spade(s), heart(h), diamond(d), club(c).
Output the complete card codes (rank + suit) left to right.`,

    enhanced: `Carefully examine this photo of poker playing cards. This is a retry — be extra precise.
Step 1: Count the visible cards.
Step 2: For EACH card, read the rank character in the corner index.
Step 3: For EACH card, carefully examine the suit symbol shape:
  - If BLACK with a POINT on top → spade (s)
  - If BLACK with THREE ROUND LOBES → club (c)
  - If RED with a ROUNDED top → heart (h)
  - If RED with a POINTED top (diamond shape) → diamond (d)
Step 4: Output ONLY the codes, e.g. "Ah, Kd, 9c"`
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
        }
    });
}

function extractResultText(response) {
    if (!response || typeof response !== 'object') return '';

    // OpenAI-compatible format (Kimi uses this)
    if (response.choices && Array.isArray(response.choices) && response.choices.length > 0) {
        const choice = response.choices[0];
        if (choice.message && typeof choice.message.content === 'string') {
            return choice.message.content.trim();
        }
    }

    // Workers AI native format
    if (typeof response.response === 'string') return response.response.trim();
    if (typeof response.result === 'string')   return response.result.trim();

    // Legacy Image-to-Text
    if (typeof response.description === 'string') return response.description.trim();

    // Stringified fallback
    if (typeof response === 'string') return response.trim();

    return '';
}

/**
 * Extract only the final answer line from CoT output.
 * Models may produce reasoning text before the actual card codes.
 * We look for a line that matches the expected card code pattern.
 */
function extractCardCodesFromCoT(rawText) {
    const text = String(rawText || '').trim();
    if (!text) return text;

    // If the entire text is short and looks like card codes, return as-is
    const cardPattern = /^(?:None|(?:[2-9TJQKA][shdc](?:\s*,\s*)?)+)$/i;
    if (cardPattern.test(text)) return text;

    // Look for the last line that contains card codes
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        // Match lines like "Ah, Kd, 9c" or "Ah,Kd,9c"
        if (/^[2-9TJQKA][shdc](\s*,\s*[2-9TJQKA][shdc])*$/i.test(line)) {
            return line;
        }
        // Match lines starting with "Answer:" or "Result:" or "Output:" prefix
        const prefixMatch = line.match(/^(?:answer|result|output|final|cards?)\s*[:：]\s*(.+)$/i);
        if (prefixMatch) {
            return prefixMatch[1].trim();
        }
    }

    // Fallback: return original text — the frontend parser will handle it
    return text;
}

function describeVisionError(error) {
    const message = error && error.message ? String(error.message) : String(error || 'Unknown error');
    if (message.includes('3046'))  return '识图超时，请把牌放近一点并减少反光后重试';
    if (message.includes('3010'))  return '图片数据无效，请重新拍摄后再试';
    if (message.includes('AI binding unavailable')) return '识图服务暂时不可用，请稍后重试';
    return message;
}

// ── Core inference runner ───────────────────────────────────────────────────

async function runVisionInference(env, model, base64DataUrl, mode) {
    const userPrompt = USER_PROMPTS[mode] || USER_PROMPTS.default;

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
            role: 'user',
            content: [
                { type: 'text', text: userPrompt },
                { type: 'image_url', image_url: { url: base64DataUrl } }
            ]
        }
    ];

    const inferenceParams = {
        messages,
        max_tokens: 200,
        temperature: 0
    };

    // Kimi K2.5 has reasoning enabled by default — disable it for speed
    // (we don't need thinking tokens, just the card codes)
    if (model.isKimi) {
        inferenceParams.chat_template_kwargs = {
            enable_thinking: false
        };
    }

    const response = await env.AI.run(model.id, inferenceParams);
    const rawText = extractResultText(response);
    const cleanText = extractCardCodesFromCoT(rawText);

    return { raw: rawText, clean: cleanText };
}

// ── Request handler ─────────────────────────────────────────────────────────

export async function onRequestPost(context) {
    const { request, env } = context;
    let mode = 'default';
    let usedModel = MODEL_CHAIN[0].name;

    try {
        // ── Validate request ────────────────────────────────────────────
        const contentType = request.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            return jsonResponse({ error: 'Unsupported Media Type' }, 415);
        }

        const body = await request.json();
        if (!body.image) {
            return jsonResponse({ error: 'Missing image' }, 400);
        }
        mode = typeof body.mode === 'string' ? body.mode : 'default';

        // ── Validate image ──────────────────────────────────────────────
        const base64Str = body.image.split(',')[1] || body.image;
        if (!base64Str) {
            return jsonResponse({ error: 'Invalid image format' }, 400);
        }

        const estimatedBytes = base64Str.length * 0.75;
        if (estimatedBytes > 2.5 * 1024 * 1024) {
            return jsonResponse({ error: 'Image too large. Must be under 2.5MB' }, 413);
        }

        if (!env.AI || typeof env.AI.run !== 'function') {
            return jsonResponse({ error: 'AI binding unavailable' }, 500);
        }

        // Ensure full data URL
        const dataUrl = body.image.startsWith('data:')
            ? body.image
            : 'data:image/jpeg;base64,' + base64Str;

        // ── Run model chain (try each until one succeeds) ───────────────
        let result = null;
        let lastError = null;

        for (let i = 0; i < MODEL_CHAIN.length; i++) {
            const model = MODEL_CHAIN[i];
            try {
                result = await runVisionInference(env, model, dataUrl, mode);
                usedModel = model.name;
                break;
            } catch (err) {
                console.warn(`[scan] ${model.name} failed:`, err.message);
                lastError = err;
                // Continue to next model
            }
        }

        if (!result) {
            throw lastError || new Error('All models failed');
        }

        return jsonResponse({
            cards: result.clean,
            raw: result.raw,
            model: usedModel,
            mode
        });

    } catch (error) {
        console.error('AI Vision Error:', error);
        return jsonResponse({
            error: 'Failed to process image',
            details: describeVisionError(error),
            model: usedModel,
            mode
        }, 500);
    }
}
