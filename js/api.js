/**
 * API Module
 * Provider-agnostic request helpers with retry logic
 */

import { MAX_RETRIES, RETRY_DELAYS } from './config.js';
import { updatePlaceholder } from './ui.js';

// Check if error should trigger retry
export function shouldRetry(err, status) {
    if (err.name === 'AbortError') return false;
    if (status === 400 || status === 401 || status === 403) return false;
    return true;
}

// Parse API errors for user-friendly messages
export function parseApiError(error, status) {
    const msg = error.message || error.toString();

    if (status === 429) {
        const match = msg.match(/(\d+)\s*seconds?/i);
        const seconds = match ? parseInt(match[1]) : 60;
        return { type: 'rate_limit', message: 'Rate limited. Try again in ' + seconds + 's', countdown: seconds };
    }

    if (msg.toLowerCase().includes('safety') || msg.toLowerCase().includes('policy') || msg.toLowerCase().includes('blocked')) {
        return { type: 'content_policy', message: 'Prompt may contain restricted content. Try rephrasing.' };
    }

    if (status === 401 || status === 403) {
        return { type: 'auth', message: 'Authentication failed. Check your API key.' };
    }

    return { type: 'generic', message: msg };
}

export async function requestJson(url, {
    method = 'GET',
    headers = {},
    body = null,
    signal = null
} = {}) {
    const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal
    });

    let data = null;
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
        data = await response.json();
    } else {
        const text = await response.text();
        data = text ? { message: text } : null;
    }

    if (!response.ok || data?.error) {
        const errorMessage = data?.error?.message || data?.message || `Request failed (${response.status})`;
        const error = new Error(errorMessage);
        error.status = response.status;
        error.response = data;
        throw error;
    }

    return data;
}

export async function requestJsonWithRetry({
    request,
    signal = null,
    label = 'Request',
    onAttempt = null,
    onRetryDelay = null
}) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            onAttempt?.(attempt, MAX_RETRIES);
            return await request(signal);
        } catch (error) {
            if (!shouldRetry(error, error.status) || attempt === MAX_RETRIES) {
                throw error;
            }

            const delayMs = RETRY_DELAYS[attempt - 1];
            onRetryDelay?.(delayMs, attempt, MAX_RETRIES);
            updatePlaceholder(`${label} retry in ${delayMs / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}
