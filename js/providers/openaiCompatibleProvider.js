import { requestJson, requestJsonWithRetry } from '../api.js';

function normalizeBaseUrl(baseUrl = '') {
    return baseUrl.trim().replace(/\/+$/, '');
}

function getEndpoint(baseUrl) {
    const normalized = normalizeBaseUrl(baseUrl);
    if (!normalized) return '';
    return normalized.endsWith('/images/generations')
        ? normalized
        : `${normalized}/images/generations`;
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function getResolutionLongEdge(resolution) {
    switch (resolution) {
        case '1K': return 1024;
        case '2K': return 1536;
        case '4K': return 2048;
        default: return 1024;
    }
}

function roundTo64(value) {
    return Math.max(256, Math.round(value / 64) * 64);
}

function mapSize(ratio, resolution) {
    const longEdge = getResolutionLongEdge(resolution);
    if (!ratio) {
        return `${longEdge}x${longEdge}`;
    }

    const [rawW, rawH] = ratio.split(':').map(Number);
    if (!rawW || !rawH) {
        return `${longEdge}x${longEdge}`;
    }

    if (rawW === rawH) {
        return `${longEdge}x${longEdge}`;
    }

    const isLandscape = rawW > rawH;
    const width = isLandscape ? longEdge : roundTo64(longEdge * rawW / rawH);
    const height = isLandscape ? roundTo64(longEdge * rawH / rawW) : longEdge;

    return `${width}x${height}`;
}

export const openaiCompatibleProvider = {
    id: 'openai-compatible',
    label: 'OpenAI-Compatible',
    storageKeys: {
        apiKey: 'openai_compatible_api_key',
        model: 'openai_compatible_model',
        baseUrl: 'openai_compatible_base_url'
    },
    features: {
        refs: false,
        search: false,
        thinking: false,
        safety: false,
        modelListing: false
    },
    ui: {
        apiKeyPlaceholder: 'Enter your API key',
        baseUrlPlaceholder: 'https://your-provider.example/v1',
        modelPlaceholder: 'Enter model ID'
    },
    validateUi({ apiKey, model, baseUrl }) {
        if (!baseUrl) return 'Enter API base URL';
        if (!apiKey) return 'Enter API key';
        if (!model) return 'Enter model ID';
        return null;
    },
    async generateImage({ prompt, config, signal, updateStatus }) {
        if (config.refImages?.length) {
            throw new Error('Reference images are not supported by the selected provider');
        }

        const endpoint = getEndpoint(config.baseUrl);
        if (!endpoint) {
            throw new Error('Enter API base URL');
        }

        const body = {
            model: config.model,
            prompt,
            response_format: 'b64_json',
            size: mapSize(config.ratio, config.resolution)
        };

        const data = await requestJsonWithRetry({
            label: 'Generating',
            signal,
            onAttempt: (attempt, maxAttempts) => {
                updateStatus?.(`Generating... (Attempt ${attempt}/${maxAttempts})`);
            },
            onRetryDelay: (delayMs) => {
                updateStatus?.(`Retry in ${delayMs / 1000}s...`);
            },
            request: () => requestJson(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${config.apiKey}`
                },
                body,
                signal
            })
        });

        const image = data.data?.[0];
        const base64Image = image?.b64_json || image?.b64Json;

        if (base64Image) {
            return {
                imageData: `data:image/png;base64,${base64Image}`,
                grounding: null
            };
        }

        if (image?.url) {
            const response = await fetch(image.url, { signal });
            if (!response.ok) {
                throw new Error(`Failed to fetch generated image (${response.status})`);
            }

            return {
                imageData: await blobToDataUrl(await response.blob()),
                grounding: null
            };
        }

        throw new Error(image?.revised_prompt || 'No image returned');
    }
};
