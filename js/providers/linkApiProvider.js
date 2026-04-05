import { requestJson, requestJsonWithRetry } from '../api.js';

const LINKAPI_DEFAULT_BASE_URL = 'https://api.linkapi.ai/v1';

function normalizeBaseUrl(baseUrl = '') {
    return (baseUrl || LINKAPI_DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}

function getEndpoint(baseUrl) {
    return `${normalizeBaseUrl(baseUrl)}/chat/completions`;
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function toArray(value) {
    return Array.isArray(value) ? value : (value ? [value] : []);
}

function isLikelyBase64(value = '') {
    const normalized = value.replace(/\s+/g, '');
    return normalized.length > 128 &&
        normalized.length % 4 === 0 &&
        /^[A-Za-z0-9+/]+=*$/.test(normalized);
}

function normalizeMimeType(mimeType = '') {
    const normalized = mimeType.trim().toLowerCase();
    if (!normalized) return 'image/png';
    if (normalized === 'jpg') return 'image/jpeg';
    if (normalized.startsWith('image/')) return normalized;
    return `image/${normalized}`;
}

function toDataUrl(base64, mimeType = 'image/png') {
    return `data:${normalizeMimeType(mimeType)};base64,${base64.replace(/\s+/g, '')}`;
}

function extractImageDataUrl(value = '') {
    const text = value.trim();
    if (!text) return null;

    if (text.startsWith('data:image/')) {
        return text;
    }

    const normalizedText = text.replace(/\s+/g, '');
    const base64TagMatch = normalizedText.match(/(?:^|[^A-Za-z0-9/+])(?:data:)?(?:image\/)?([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/i);
    if (base64TagMatch) {
        return toDataUrl(base64TagMatch[2], base64TagMatch[1]);
    }

    return null;
}

async function fetchImageAsDataUrl(url, signal) {
    const response = await fetch(url, { signal });
    if (!response.ok) {
        throw new Error(`Failed to fetch generated image (${response.status})`);
    }
    return blobToDataUrl(await response.blob());
}

async function normalizeImageSource(value, signal, mimeType = 'image/png') {
    if (!value || typeof value !== 'string') return null;
    const extractedImage = extractImageDataUrl(value);
    if (extractedImage) return extractedImage;
    if (/^https?:\/\//i.test(value)) {
        return fetchImageAsDataUrl(value, signal);
    }
    if (isLikelyBase64(value)) {
        return toDataUrl(value, mimeType);
    }
    return null;
}

async function findImageData(node, signal, depth = 0) {
    if (!node || depth > 5) return null;

    if (typeof node === 'string') {
        return normalizeImageSource(node, signal);
    }

    if (Array.isArray(node)) {
        for (const item of node) {
            const imageData = await findImageData(item, signal, depth + 1);
            if (imageData) return imageData;
        }
        return null;
    }

    if (node.b64_json || node.b64Json) {
        return toDataUrl(node.b64_json || node.b64Json, node.mime_type || node.mimeType || 'image/png');
    }

    if (node.inlineData?.data) {
        return toDataUrl(node.inlineData.data, node.inlineData.mimeType || 'image/png');
    }

    if (node.source?.data) {
        return toDataUrl(node.source.data, node.source.mime_type || node.source.media_type || 'image/png');
    }

    if (node.image_base64) {
        return toDataUrl(node.image_base64, node.mime_type || node.mimeType || 'image/png');
    }

    const directImage = await normalizeImageSource(node.url, signal, node.mime_type || node.mimeType);
    if (directImage) return directImage;

    if (node.image_url) {
        const imageUrl = typeof node.image_url === 'string' ? node.image_url : node.image_url.url;
        const imageData = await normalizeImageSource(imageUrl, signal, node.mime_type || node.mimeType);
        if (imageData) return imageData;
    }

    const nestedKeys = ['data', 'image', 'images', 'content', 'message', 'choices', 'output', 'result'];
    for (const key of nestedKeys) {
        if (!node[key]) continue;
        const imageData = await findImageData(node[key], signal, depth + 1);
        if (imageData) return imageData;
    }

    return null;
}

function findTextMessage(node, depth = 0) {
    if (!node || depth > 5) return null;

    if (typeof node === 'string') {
        const text = node.trim();
        if (!text || extractImageDataUrl(text) || isLikelyBase64(text)) {
            return null;
        }
        return text;
    }

    if (Array.isArray(node)) {
        for (const item of node) {
            const text = findTextMessage(item, depth + 1);
            if (text) return text;
        }
        return null;
    }

    if (typeof node.text === 'string' && node.text.trim()) {
        return node.text.trim();
    }

    if (typeof node.content === 'string' && node.content.trim()) {
        return node.content.trim();
    }

    if (typeof node.output_text === 'string' && node.output_text.trim()) {
        return node.output_text.trim();
    }

    const nestedKeys = ['error', 'message', 'content', 'choices', 'output', 'data'];
    for (const key of nestedKeys) {
        if (!node[key]) continue;
        const text = findTextMessage(node[key], depth + 1);
        if (text) return text;
    }

    return null;
}

function buildLinkApiBody(prompt, config, refImages = []) {
    const content = [
        { type: 'text', text: prompt },
        ...refImages
            .map(ref => ref?.data)
            .filter(Boolean)
            .map(url => ({
                type: 'image_url',
                image_url: { url }
            }))
    ];

    return {
        model: config.model,
        messages: [{
            role: 'user',
            content
        }],
        stream: false
    };
}

export const linkApiProvider = {
    id: 'linkapi',
    label: 'LinkAPI',
    defaultBaseUrl: LINKAPI_DEFAULT_BASE_URL,
    storageKeys: {
        apiKey: 'linkapi_api_key',
        model: 'linkapi_model',
        baseUrl: 'linkapi_base_url'
    },
    features: {
        refs: true,
        search: false,
        thinking: false,
        safety: false,
        modelListing: false
    },
    ui: {
        apiKeyPlaceholder: 'Enter your LinkAPI key',
        baseUrlPlaceholder: LINKAPI_DEFAULT_BASE_URL,
        modelPlaceholder: 'Enter LinkAPI model ID'
    },
    validateUi({ apiKey, model }) {
        if (!apiKey) return 'Enter API key';
        if (!model) return 'Enter model ID';
        return null;
    },
    async generateImage({ prompt, config, signal, updateStatus }) {
        const body = buildLinkApiBody(prompt, config, config.refImages || []);
        const data = await requestJsonWithRetry({
            label: 'Generating',
            signal,
            onAttempt: (attempt, maxAttempts) => {
                updateStatus?.(`Generating... (Attempt ${attempt}/${maxAttempts})`);
            },
            onRetryDelay: (delayMs) => {
                updateStatus?.(`Retry in ${delayMs / 1000}s...`);
            },
            request: () => requestJson(getEndpoint(config.baseUrl), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${config.apiKey}`
                },
                body,
                signal
            })
        });

        const imageData = await findImageData(data, signal);
        if (!imageData) {
            throw new Error(findTextMessage(data) || 'No image returned');
        }

        return {
            imageData,
            grounding: null
        };
    }
};
