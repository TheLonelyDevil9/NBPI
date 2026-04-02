/**
 * Models Module
 * Provider-aware model loading and selection
 */

import { $ } from './ui.js';
import {
    getCurrentProvider,
    getProviderStorageSnapshot,
    persistCurrentProviderState,
    restoreProviderModelSelection
} from './providers/index.js';

// Model cache with TTL
const MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let modelCache = { data: null, timestamp: 0, key: null };
let isRefreshing = false;

// Refresh models list
export async function refreshModels(forceRefresh = false) {
    if (isRefreshing) return;

    const refreshBtn = $('refreshBtn');
    const modelStatus = $('modelStatus');
    const provider = getCurrentProvider();

    if (!provider.features.modelListing) {
        modelStatus.textContent = 'Enter a model ID manually for this provider';
        modelStatus.className = 'model-status';
        return;
    }

    const { apiKey } = getProviderStorageSnapshot(provider.id);

    // Check cache
    if (!forceRefresh) {
        if (modelCache.data &&
            modelCache.key === `${provider.id}:${apiKey}` &&
            Date.now() - modelCache.timestamp < MODEL_CACHE_TTL) {
            renderModels(modelCache.data);
            modelStatus.textContent = modelCache.data.length + ' models (cached)';
            modelStatus.className = 'model-status success';
            restoreProviderModelSelection();
            return;
        }
    }

    refreshBtn.classList.add('loading');
    isRefreshing = true;
    modelStatus.textContent = 'Loading...';
    modelStatus.className = 'model-status';

    try {
        await refreshModelsForProvider(provider, apiKey);
    } catch (e) {
        modelStatus.textContent = e.message.slice(0, 50);
        modelStatus.className = 'model-status error';
    } finally {
        isRefreshing = false;
        refreshBtn.classList.remove('loading');
        restoreProviderModelSelection();
    }
}

// Render models to select element
function renderModels(models) {
    const modelSelect = $('modelSelect');
    modelSelect.innerHTML = models.map(id => '<option value="' + id + '">' + id + '</option>').join('');
}

async function refreshModelsForProvider(provider, apiKey) {
    const modelStatus = $('modelStatus');

    if (!apiKey) {
        modelStatus.textContent = 'Enter API key';
        modelStatus.className = 'model-status error';
        return;
    }

    const models = await provider.listModels({ apiKey });

    // Cache the results
    modelCache = {
        data: models,
        timestamp: Date.now(),
        key: `${provider.id}:${apiKey}`
    };

    renderModels(models);
    persistCurrentProviderState();
    modelStatus.textContent = models.length + ' models';
    modelStatus.className = 'model-status success';
}
