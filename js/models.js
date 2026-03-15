/**
 * Models Module
 * Model loading and selection
 */

import { $ } from './ui.js';
import { restoreLastModel } from './persistence.js';

// Model cache with TTL
const MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let modelCache = { data: null, timestamp: 0, key: null };

// Refresh models list
export async function refreshModels(forceRefresh = false) {
    const refreshBtn = $('refreshBtn');
    const modelStatus = $('modelStatus');

    // Check cache
    if (!forceRefresh) {
        const apiKey = $('apiKey').value;
        if (modelCache.data &&
            modelCache.key === apiKey &&
            Date.now() - modelCache.timestamp < MODEL_CACHE_TTL) {
            renderModels(modelCache.data);
            modelStatus.textContent = modelCache.data.length + ' models (cached)';
            modelStatus.className = 'model-status success';
            restoreLastModel();
            return;
        }
    }

    refreshBtn.classList.add('loading');
    modelStatus.textContent = 'Loading...';
    modelStatus.className = 'model-status';

    try {
        await refreshModelsAPIKey();
    } catch (e) {
        modelStatus.textContent = e.message.slice(0, 50);
        modelStatus.className = 'model-status error';
    } finally {
        refreshBtn.classList.remove('loading');
        restoreLastModel();
    }
}

// Render models to select element
function renderModels(models) {
    const modelSelect = $('modelSelect');
    modelSelect.innerHTML = models.map(id => '<option value="' + id + '">' + id + '</option>').join('');
}

// Refresh models for API Key auth
async function refreshModelsAPIKey() {
    const apiKey = $('apiKey').value;
    const modelStatus = $('modelStatus');

    if (!apiKey) {
        modelStatus.textContent = 'Enter API key';
        modelStatus.className = 'model-status error';
        return;
    }

    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
        headers: { 'x-goog-api-key': apiKey }
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    const models = (data.models || []).map(m => m.name.replace('models/', ''));

    // Cache the results
    modelCache = {
        data: models,
        timestamp: Date.now(),
        key: apiKey
    };

    renderModels(models);
    modelStatus.textContent = models.length + ' models';
    modelStatus.className = 'model-status success';
}

// Make functions globally available for HTML onclick handlers
window.refreshModels = refreshModels;
