import { requestJson, requestJsonWithRetry } from '../api.js';

const LINKAPI_DEFAULT_BASE_URL = 'https://api.linkapi.ai/v1';
const LINKAPI_DEBUG_STORAGE_KEY = 'nbpi_linkapi_debug';
const LINKAPI_DEBUG_HEADERS = ['content-type', 'content-length', 'x-request-id', 'cf-ray'];
const IMAGE_MIME_PREFERENCE = {
    'image/png': 0,
    'image/jpeg': 1,
    'image/webp': 2,
    'image/gif': 3
};

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

function isLikelyBase64(value = '') {
    const normalized = value.replace(/\s+/g, '');
    return normalized.length > 128 &&
        normalized.length % 4 === 0 &&
        /^[A-Za-z0-9+/]+=*$/.test(normalized);
}

function normalizeOptionalMimeType(mimeType = '') {
    const normalized = mimeType.trim().toLowerCase();
    if (!normalized) return '';
    if (normalized === 'jpg') return 'image/jpeg';
    if (normalized.startsWith('image/')) return normalized;
    return `image/${normalized}`;
}

function normalizeMimeType(mimeType = '') {
    return normalizeOptionalMimeType(mimeType) || 'image/png';
}

function toDataUrl(base64, mimeType = 'image/png') {
    return `data:${normalizeMimeType(mimeType)};base64,${base64.replace(/\s+/g, '')}`;
}

function getMimeTypeFromDataUrl(value = '') {
    const match = value.match(/^data:([^;]+);base64,/i);
    return normalizeOptionalMimeType(match?.[1] || '');
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

function detectImageMimeTypeFromBytes(bytes) {
    if (!bytes || bytes.length < 4) return '';

    if (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4E &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0D &&
        bytes[5] === 0x0A &&
        bytes[6] === 0x1A &&
        bytes[7] === 0x0A
    ) {
        return 'image/png';
    }

    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
        return 'image/jpeg';
    }

    if (
        bytes.length >= 6 &&
        bytes[0] === 0x47 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x38 &&
        (bytes[4] === 0x37 || bytes[4] === 0x39) &&
        bytes[5] === 0x61
    ) {
        return 'image/gif';
    }

    if (
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
    ) {
        return 'image/webp';
    }

    return '';
}

function detectImageMimeTypeFromBase64(base64 = '') {
    if (!base64 || typeof atob !== 'function') return '';

    try {
        const normalized = base64.replace(/\s+/g, '');
        const sampleLength = Math.min(normalized.length, 96);
        const paddedLength = Math.ceil(sampleLength / 4) * 4;
        const binary = atob(normalized.slice(0, paddedLength).padEnd(paddedLength, '='));
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        return detectImageMimeTypeFromBytes(bytes);
    } catch {
        return '';
    }
}

function estimateBase64ByteSize(base64 = '') {
    const normalized = base64.replace(/\s+/g, '');
    if (!normalized) return 0;

    let padding = 0;
    if (normalized.endsWith('==')) padding = 2;
    else if (normalized.endsWith('=')) padding = 1;

    return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function sanitizeDebugString(value = '') {
    const text = typeof value === 'string' ? value : String(value ?? '');
    const dataUrlMimeType = getMimeTypeFromDataUrl(text);
    if (dataUrlMimeType) {
        const [, base64 = ''] = text.split(',', 2);
        return `[data-url ${dataUrlMimeType}, base64 chars=${base64.length}]`;
    }

    if (isLikelyBase64(text)) {
        return `[base64 chars=${text.replace(/\s+/g, '').length}]`;
    }

    return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function sanitizeForDebug(value, depth = 0) {
    if (typeof value === 'string') {
        return sanitizeDebugString(value);
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    if (depth > 5) {
        return '[max-depth]';
    }

    if (Array.isArray(value)) {
        return value.map(item => sanitizeForDebug(item, depth + 1));
    }

    const sanitized = {};
    Object.entries(value).forEach(([key, nestedValue]) => {
        sanitized[key] = sanitizeForDebug(nestedValue, depth + 1);
    });
    return sanitized;
}

function createCandidate({
    sourceKind,
    path,
    value,
    declaredMimeType = '',
    kind = ''
}) {
    if (!value || typeof value !== 'string') return null;

    const trimmed = value.trim();
    if (!trimmed) return null;

    let normalizedKind = kind;
    let normalizedValue = trimmed;

    if (!normalizedKind) {
        const extractedImage = extractImageDataUrl(trimmed);
        if (extractedImage) {
            normalizedKind = 'data-url';
            normalizedValue = extractedImage;
        } else if (/^https?:\/\//i.test(trimmed)) {
            normalizedKind = 'remote-url';
        } else if (isLikelyBase64(trimmed)) {
            normalizedKind = 'base64';
            normalizedValue = trimmed.replace(/\s+/g, '');
        } else {
            return null;
        }
    }

    return {
        sourceKind,
        path,
        kind: normalizedKind,
        value: normalizedValue,
        declaredMimeType: normalizeOptionalMimeType(declaredMimeType) || getMimeTypeFromDataUrl(normalizedValue)
    };
}

function pushCandidate(candidates, seen, candidateInput) {
    const candidate = createCandidate(candidateInput);
    if (!candidate) return;

    const dedupeValue = candidate.kind === 'remote-url'
        ? candidate.value
        : candidate.value.slice(0, 64);
    const dedupeKey = [
        candidate.sourceKind,
        candidate.path,
        candidate.kind,
        candidate.declaredMimeType,
        dedupeValue
    ].join('|');

    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    candidates.push({
        ...candidate,
        index: candidates.length
    });
}

function collectImageCandidates(node, path = 'root', depth = 0, candidates = [], seen = new Set()) {
    if (!node || depth > 6) return candidates;

    if (typeof node === 'string') {
        pushCandidate(candidates, seen, {
            sourceKind: 'string',
            path,
            value: node
        });
        return candidates;
    }

    if (Array.isArray(node)) {
        node.forEach((item, index) => {
            collectImageCandidates(item, `${path}[${index}]`, depth + 1, candidates, seen);
        });
        return candidates;
    }

    const declaredMimeType = node.mime_type || node.mimeType || '';

    if (node.b64_json || node.b64Json) {
        pushCandidate(candidates, seen, {
            sourceKind: node.b64_json ? 'b64_json' : 'b64Json',
            path: `${path}.${node.b64_json ? 'b64_json' : 'b64Json'}`,
            value: node.b64_json || node.b64Json,
            declaredMimeType,
            kind: 'base64'
        });
    }

    if (node.inlineData?.data) {
        pushCandidate(candidates, seen, {
            sourceKind: 'inlineData',
            path: `${path}.inlineData.data`,
            value: node.inlineData.data,
            declaredMimeType: node.inlineData.mimeType || declaredMimeType,
            kind: 'base64'
        });
    }

    if (node.source?.data) {
        pushCandidate(candidates, seen, {
            sourceKind: 'source.data',
            path: `${path}.source.data`,
            value: node.source.data,
            declaredMimeType: node.source.mime_type || node.source.media_type || declaredMimeType,
            kind: 'base64'
        });
    }

    if (node.image_base64) {
        pushCandidate(candidates, seen, {
            sourceKind: 'image_base64',
            path: `${path}.image_base64`,
            value: node.image_base64,
            declaredMimeType,
            kind: 'base64'
        });
    }

    if (typeof node.url === 'string') {
        pushCandidate(candidates, seen, {
            sourceKind: 'url',
            path: `${path}.url`,
            value: node.url,
            declaredMimeType,
            kind: /^https?:\/\//i.test(node.url) ? 'remote-url' : ''
        });
    }

    if (node.image_url) {
        const imageUrl = typeof node.image_url === 'string'
            ? node.image_url
            : node.image_url.url;
        pushCandidate(candidates, seen, {
            sourceKind: 'image_url.url',
            path: typeof node.image_url === 'string'
                ? `${path}.image_url`
                : `${path}.image_url.url`,
            value: imageUrl,
            declaredMimeType: node.image_url?.mime_type || node.image_url?.mimeType || declaredMimeType,
            kind: /^https?:\/\//i.test(imageUrl || '') ? 'remote-url' : ''
        });
    }

    const nestedKeys = ['data', 'image', 'images', 'content', 'parts', 'message', 'choices', 'output', 'result'];
    nestedKeys.forEach((key) => {
        if (node[key]) {
            collectImageCandidates(node[key], `${path}.${key}`, depth + 1, candidates, seen);
        }
    });

    return candidates;
}

async function resolveImageCandidate(candidate, signal) {
    if (candidate.kind === 'remote-url') {
        const response = await fetch(candidate.value, { signal });
        if (!response.ok) {
            throw new Error(`Failed to fetch generated image (${response.status})`);
        }

        const blob = await response.blob();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const sniffedMimeType = detectImageMimeTypeFromBytes(bytes);
        const fetchedMimeType = normalizeOptionalMimeType(blob.type);
        const resolvedMimeType = sniffedMimeType || fetchedMimeType || candidate.declaredMimeType;
        const normalizedBlob = resolvedMimeType && resolvedMimeType !== fetchedMimeType
            ? new Blob([bytes], { type: resolvedMimeType })
            : blob;

        return {
            ...candidate,
            imageData: await blobToDataUrl(normalizedBlob),
            resolvedMimeType,
            fetchedMimeType,
            byteSize: blob.size
        };
    }

    const base64 = candidate.kind === 'data-url'
        ? candidate.value.split(',')[1] || ''
        : candidate.value;
    const sniffedMimeType = candidate.kind === 'data-url'
        ? detectImageMimeTypeFromBase64(base64)
        : detectImageMimeTypeFromBase64(candidate.value);
    const dataUrlMimeType = sniffedMimeType || candidate.declaredMimeType || 'image/png';

    return {
        ...candidate,
        imageData: candidate.kind === 'data-url'
            ? (sniffedMimeType && sniffedMimeType !== getMimeTypeFromDataUrl(candidate.value)
                ? toDataUrl(base64, sniffedMimeType)
                : candidate.value)
            : toDataUrl(candidate.value, dataUrlMimeType),
        resolvedMimeType: sniffedMimeType || candidate.declaredMimeType,
        fetchedMimeType: '',
        byteSize: estimateBase64ByteSize(base64)
    };
}

async function resolveImageCandidates(candidates, signal) {
    const resolvedCandidates = [];

    for (const candidate of candidates) {
        try {
            resolvedCandidates.push(await resolveImageCandidate(candidate, signal));
        } catch (error) {
            resolvedCandidates.push({
                ...candidate,
                imageData: null,
                resolvedMimeType: '',
                fetchedMimeType: '',
                byteSize: 0,
                error: error.message || 'Failed to resolve image candidate'
            });
        }
    }

    return resolvedCandidates;
}

function getImageMimePriority(mimeType = '') {
    return IMAGE_MIME_PREFERENCE[normalizeOptionalMimeType(mimeType)] ?? Number.MAX_SAFE_INTEGER;
}

function pickBestCandidate(candidates) {
    const successfulCandidates = candidates.filter(candidate => candidate.imageData);
    if (successfulCandidates.length === 0) return null;

    return successfulCandidates
        .slice()
        .sort((a, b) => {
            const priorityDelta = getImageMimePriority(a.resolvedMimeType || a.declaredMimeType) -
                getImageMimePriority(b.resolvedMimeType || b.declaredMimeType);

            if (priorityDelta !== 0) {
                return priorityDelta;
            }

            return a.index - b.index;
        })[0];
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

    const body = {
        model: config.model,
        messages: [{
            role: 'user',
            content
        }],
        stream: false
    };

    const imageConfig = {};
    if (config.ratio) imageConfig.aspectRatio = config.ratio;
    if (config.resolution) imageConfig.imageSize = config.resolution;
    if (Object.keys(imageConfig).length > 0) {
        body.generationConfig = { imageConfig };
    }

    // Intentionally avoid guessing unsupported format flags here.
    // Live response mapping should confirm any request-side PNG control first.
    return body;
}

function isLinkApiDebugEnabled() {
    try {
        return window.localStorage.getItem(LINKAPI_DEBUG_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

function formatCandidateForDebug(candidate) {
    return {
        index: candidate.index,
        source: candidate.sourceKind,
        path: candidate.path,
        kind: candidate.kind,
        declaredMimeType: candidate.declaredMimeType || '(none)',
        resolvedMimeType: candidate.resolvedMimeType || '(unknown)',
        fetchedMimeType: candidate.fetchedMimeType || '',
        byteSize: candidate.byteSize || 0,
        value: sanitizeDebugString(candidate.value),
        error: candidate.error || ''
    };
}

function logLinkApiDiagnostics({ body, responseMeta, resolvedCandidates, selectedCandidate, textMessage }) {
    if (!isLinkApiDebugEnabled()) return;

    console.groupCollapsed('[LinkAPI Debug] Response mapping');
    console.log('Request body', sanitizeForDebug(body));
    console.log('Response meta', responseMeta);

    if (resolvedCandidates.length > 0) {
        console.table(resolvedCandidates.map(formatCandidateForDebug));
    } else {
        console.log('Image candidates', []);
    }

    if (selectedCandidate) {
        console.log('Selected candidate', formatCandidateForDebug(selectedCandidate));
    }

    if (textMessage) {
        console.log('First text message', sanitizeDebugString(textMessage));
    }

    console.groupEnd();
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
        const { data, meta } = await requestJsonWithRetry({
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
                signal,
                includeMeta: true,
                metaHeaders: LINKAPI_DEBUG_HEADERS
            })
        });

        const textMessage = findTextMessage(data);
        const imageCandidates = collectImageCandidates(data);
        const resolvedCandidates = await resolveImageCandidates(imageCandidates, signal);
        const selectedCandidate = pickBestCandidate(resolvedCandidates);

        logLinkApiDiagnostics({
            body,
            responseMeta: meta,
            resolvedCandidates,
            selectedCandidate,
            textMessage
        });

        if (!selectedCandidate) {
            const candidateError = resolvedCandidates.find(candidate => candidate.error)?.error;
            throw new Error(candidateError || textMessage || 'No image returned');
        }

        const selectedMimeType = normalizeOptionalMimeType(
            selectedCandidate.resolvedMimeType || selectedCandidate.declaredMimeType
        );

        if (selectedMimeType !== 'image/png') {
            throw new Error(`LinkAPI returned ${selectedMimeType || 'an unknown image type'}; PNG is required`);
        }

        return {
            imageData: selectedCandidate.imageData,
            grounding: null
        };
    }
};
