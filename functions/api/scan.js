export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const contentType = request.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
            return new Response(JSON.stringify({ error: "Unsupported Media Type" }), { status: 415 });
        }

        const body = await request.json();
        if (!body.image) {
            return new Response(JSON.stringify({ error: "Missing image" }), { status: 400 });
        }

        // Image should be a base64 encoded string starting with 'data:image/jpeg;base64,'
        const base64Str = body.image.split(',')[1] || body.image;
        if (!base64Str) {
            return new Response(JSON.stringify({ error: "Invalid image format" }), { status: 400 });
        }

        // Convert base64 string to Uint8Array
        const binaryString = atob(base64Str);
        const imageArray = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            imageArray[i] = binaryString.charCodeAt(i);
        }

        // If the payload is extraordinarily large > 2MB, reject to save memory/time
        if (imageArray.length > 2 * 1024 * 1024) {
             return new Response(JSON.stringify({ error: "Image too large. Must be under 2MB" }), { status: 413 });
        }

        const prompt = `This is an image of Texas Hold'em poker cards.
Please identify all the playing cards clearly visible in the image.
A playing card consists of a rank (2, 3, 4, 5, 6, 7, 8, 9, T, J, Q, K, A) and a suit (s for spades, h for hearts, d for diamonds, c for clubs).
For example, Ace of Spades is As, Ten of Hearts is Th.

Output ONLY a comma-separated list of the cards you see. Do not output any other text explaining what is in the background or your reasoning.
Example format: "As, Th, 2c" (without quotes).
If you cannot clearly see any cards, output "None".`;

        const response = await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
            prompt: prompt,
            image: [...imageArray]
        });

        // The response should be a string containing the text
        const resultText = response.response || "";

        return new Response(JSON.stringify({
            cards: resultText.trim(),
            raw: resultText
        }), {
            headers: {
                "Content-Type": "application/json"
            }
        });

    } catch (error) {
        console.error("AI Vision Error:", error);
        return new Response(JSON.stringify({
            error: "Failed to process image",
            details: error.message
        }), { status: 500 });
    }
}
