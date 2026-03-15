/**
 * API Module
 * Gemini API calls with retry logic
 */

import { MAX_RETRIES, RETRY_DELAYS } from './config.js';
import { $, updatePlaceholder } from './ui.js';

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

// API Key generate content
export async function apiKeyGenerateContent(model, body, apiKey, signal) {
    const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify(body),
            signal: signal
        }
    );

    const data = await response.json();
    if (data.error) {
        const err = new Error(data.error.message);
        err.status = response.status;
        throw err;
    }
    return data;
}

// Generate content with retry logic
export async function generateWithRetry(model, body, signal) {
    const apiKey = $('apiKey').value;
    let data;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            updatePlaceholder('Generating... (Attempt ' + attempt + '/' + MAX_RETRIES + ')');
            data = await apiKeyGenerateContent(model, body, apiKey, signal);
            break;
        } catch (e) {
            if (!shouldRetry(e, e.status) || attempt === MAX_RETRIES) {
                throw e;
            }

            const delay = RETRY_DELAYS[attempt - 1];
            updatePlaceholder('Retry in ' + (delay / 1000) + 's...');
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    return data;
}
