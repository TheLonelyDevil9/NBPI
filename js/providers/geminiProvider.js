import { requestJson, requestJsonWithRetry } from '../api.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function buildGeminiBody(prompt, config, refImages = []) {
    const userParts = [];

    if (refImages.length > 0) {
        refImages.forEach((img) => {
            const match = img.data?.match(/^data:(.+);base64,(.+)$/);
            if (match) {
                userParts.push({ inlineData: { mimeType: match[1], data: match[2] } });
            }
        });
    }

    userParts.push({ text: prompt });

    const generationConfig = {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {}
    };

    if (config.ratio) generationConfig.imageConfig.aspectRatio = config.ratio;
    if (config.resolution) generationConfig.imageConfig.imageSize = config.resolution;

    if (config.thinkingBudget !== undefined) {
        if (config.thinkingBudget === 0) {
            generationConfig.thinkingConfig = { thinkingBudget: 0 };
        } else if (config.thinkingBudget > 0) {
            generationConfig.thinkingConfig = { thinkingBudget: config.thinkingBudget };
        }
    }

    const body = {
        contents: [{
            role: 'user',
            parts: userParts
        }],
        generationConfig
    };

    if (config.searchEnabled) {
        body.tools = [{ google_search: {} }];
    }

    if (config.safetySettings?.length) {
        body.safetySettings = config.safetySettings;
    }

    return body;
}

export const geminiProvider = {
    id: 'gemini',
    label: 'Gemini',
    storageKeys: {
        apiKey: 'gemini_api_key',
        model: 'last_model_gemini'
    },
    features: {
        refs: true,
        search: true,
        thinking: true,
        safety: true,
        modelListing: true
    },
    ui: {
        apiKeyPlaceholder: 'Enter your Gemini API key',
        modelPlaceholder: 'Enter API key to load models...'
    },
    validateUi({ apiKey, model }) {
        if (!apiKey) return 'Enter API key';
        if (!model) return 'Select model';
        return null;
    },
    async listModels({ apiKey, signal }) {
        const data = await requestJson(`${GEMINI_API_BASE}/models`, {
            headers: { 'x-goog-api-key': apiKey },
            signal
        });

        return (data.models || []).map(model => model.name.replace('models/', ''));
    },
    async generateImage({ prompt, config, signal, updateStatus }) {
        const body = buildGeminiBody(prompt, config, config.refImages || []);
        const data = await requestJsonWithRetry({
            label: 'Generating',
            signal,
            onAttempt: (attempt, maxAttempts) => {
                updateStatus?.(`Generating... (Attempt ${attempt}/${maxAttempts})`);
            },
            onRetryDelay: (delayMs) => {
                updateStatus?.(`Retry in ${delayMs / 1000}s...`);
            },
            request: () => requestJson(
                `${GEMINI_API_BASE}/models/${config.model}:generateContent`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': config.apiKey
                    },
                    body,
                    signal
                }
            )
        });

        const candidate = data.candidates?.[0];
        const contentParts = candidate?.content?.parts;
        const imagePart = contentParts?.find(part => part.inlineData && !part.thought);

        if (!imagePart) {
            const textPart = contentParts?.find(part => part.text);
            throw new Error(textPart?.text || 'No image returned');
        }

        return {
            imageData: `data:${imagePart.inlineData.mimeType || 'image/png'};base64,${imagePart.inlineData.data}`,
            grounding: candidate?.groundingMetadata || null
        };
    }
};
