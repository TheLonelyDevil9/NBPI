import { $ } from '../ui.js';
import { geminiProvider } from './geminiProvider.js';
import { linkApiProvider } from './linkApiProvider.js';
import { openaiCompatibleProvider } from './openaiCompatibleProvider.js';

const DEFAULT_PROVIDER_ID = 'gemini';
const PROVIDERS = [geminiProvider, linkApiProvider, openaiCompatibleProvider];
const PROVIDER_MAP = new Map(PROVIDERS.map(provider => [provider.id, provider]));

function getProviderSelect() {
    return $('providerSelect');
}

function getStoredProviderId() {
    return localStorage.getItem('provider_id') || DEFAULT_PROVIDER_ID;
}

function getProviderSafe(providerId) {
    return PROVIDER_MAP.get(providerId) || geminiProvider;
}

function readInputValue(id) {
    return $(id)?.value?.trim() || '';
}

function dispatchProviderChange(provider) {
    window.dispatchEvent(new CustomEvent('nbpi:provider-change', {
        detail: {
            providerId: provider.id,
            provider
        }
    }));
}

function setVisibility(id, isVisible) {
    const element = $(id);
    if (element) {
        element.classList.toggle('hidden', !isVisible);
    }
}

function setDisabled(id, isDisabled) {
    const element = $(id);
    if (element) {
        element.disabled = isDisabled;
    }
}

function updateFeatureToggles(provider) {
    const supportsSearch = !!provider.features.search;
    const supportsThinking = !!provider.features.thinking;
    const supportsSafety = !!provider.features.safety;
    const supportsRefs = !!provider.features.refs;

    setVisibility('advancedCollapsible', supportsSearch || supportsThinking);
    setVisibility('searchToggleItem', supportsSearch);
    setVisibility('thinkingToggleItem', supportsThinking);
    setVisibility('thinkingRow', supportsThinking && !!$('thinkingToggle')?.checked);
    setVisibility('safetyCollapsible', supportsSafety);

    const refsNote = $('refsProviderNote');
    const refSection = $('refSection');
    if (refSection) {
        refSection.classList.toggle('provider-disabled', !supportsRefs);
    }
    if (refsNote) {
        refsNote.classList.toggle('hidden', supportsRefs);
        refsNote.textContent = supportsRefs ? '' : `${provider.label} does not support reference images in this mode.`;
    }

    setDisabled('refInput', !supportsRefs);
    setDisabled('clearRefsBtn', !supportsRefs);
}

export function getProviders() {
    return PROVIDERS.slice();
}

export function getProvider(providerId) {
    return getProviderSafe(providerId);
}

export function getCurrentProviderId() {
    return getProviderSelect()?.value || getStoredProviderId();
}

export function getCurrentProvider() {
    return getProvider(getCurrentProviderId());
}

export function providerSupports(feature, providerId = getCurrentProviderId()) {
    return !!getProvider(providerId).features?.[feature];
}

export function getProviderStorageSnapshot(providerId = getCurrentProviderId()) {
    const provider = getProvider(providerId);
    return {
        providerId: provider.id,
        apiKey: localStorage.getItem(provider.storageKeys.apiKey) || '',
        model: localStorage.getItem(provider.storageKeys.model) || '',
        baseUrl: provider.storageKeys.baseUrl
            ? localStorage.getItem(provider.storageKeys.baseUrl) || provider.defaultBaseUrl || ''
            : ''
    };
}

export function getProviderExecutionConfig(config) {
    const provider = getProvider(config.providerId);
    const stored = getProviderStorageSnapshot(config.providerId);
    return {
        ...config,
        providerLabel: provider.label,
        apiKey: stored.apiKey,
        model: config.model || stored.model,
        baseUrl: config.baseUrl || stored.baseUrl,
        refImages: config.refImages || []
    };
}

export function getCurrentProviderPublicConfig() {
    const provider = getCurrentProvider();
    const providerState = getProviderStorageSnapshot(provider.id);

    return {
        providerId: provider.id,
        providerLabel: provider.label,
        model: provider.features.modelListing
            ? ($('modelSelect')?.value || providerState.model)
            : (readInputValue('providerModelInput') || providerState.model),
        baseUrl: provider.storageKeys.baseUrl
            ? (readInputValue('providerBaseUrl') || providerState.baseUrl)
            : ''
    };
}

export function persistProviderState(providerId = getCurrentProviderId(), { setActiveProvider = true } = {}) {
    const provider = getProvider(providerId);
    if (setActiveProvider) {
        localStorage.setItem('provider_id', provider.id);
    }

    const apiKey = $('apiKey')?.value || '';
    localStorage.setItem(provider.storageKeys.apiKey, apiKey);

    if (provider.storageKeys.baseUrl) {
        localStorage.setItem(provider.storageKeys.baseUrl, readInputValue('providerBaseUrl'));
    }

    const currentModel = provider.features.modelListing
        ? $('modelSelect')?.value || ''
        : readInputValue('providerModelInput');

    localStorage.setItem(provider.storageKeys.model, currentModel);

    if (provider.id === 'gemini') {
        if (currentModel) {
            localStorage.setItem('last_model', currentModel);
        }
    }
}

export function persistCurrentProviderState() {
    persistProviderState(getCurrentProviderId());
}

export function restoreProviderModelSelection() {
    const provider = getCurrentProvider();
    if (!provider.features.modelListing) {
        return;
    }

    const modelSelect = $('modelSelect');
    if (!modelSelect) return;

    const savedModel = localStorage.getItem(provider.storageKeys.model) || localStorage.getItem('last_model') || '';
    if (savedModel && modelSelect.querySelector(`option[value="${savedModel}"]`)) {
        modelSelect.value = savedModel;
    }
}

export function loadCurrentProviderStateIntoUi() {
    const provider = getCurrentProvider();
    const providerState = getProviderStorageSnapshot(provider.id);

    const apiKeyInput = $('apiKey');
    if (apiKeyInput) {
        apiKeyInput.value = providerState.apiKey;
        apiKeyInput.placeholder = provider.ui.apiKeyPlaceholder;
    }

    const providerBaseUrlInput = $('providerBaseUrl');
    if (providerBaseUrlInput) {
        providerBaseUrlInput.value = providerState.baseUrl;
        providerBaseUrlInput.placeholder = provider.ui.baseUrlPlaceholder || '';
    }

    const providerModelInput = $('providerModelInput');
    if (providerModelInput) {
        providerModelInput.value = providerState.model;
        providerModelInput.placeholder = provider.ui.modelPlaceholder || '';
    }

    setVisibility('providerBaseUrlGroup', !!provider.storageKeys.baseUrl);
    setVisibility('modelSelectGroup', !!provider.features.modelListing);
    setVisibility('providerModelGroup', !provider.features.modelListing);

    const refreshButton = $('refreshBtn');
    if (refreshButton) {
        refreshButton.classList.toggle('hidden', !provider.features.modelListing);
        refreshButton.disabled = !provider.features.modelListing;
    }

    const modelStatus = $('modelStatus');
    const providerModelStatus = $('providerModelStatus');
    if (modelStatus) {
        modelStatus.textContent = provider.features.modelListing ? '' : 'Enter a model ID manually for this provider';
        modelStatus.className = 'model-status';
    }
    if (providerModelStatus) {
        providerModelStatus.textContent = provider.features.modelListing ? '' : 'Manual model entry';
        providerModelStatus.className = 'model-status';
    }

    updateFeatureToggles(provider);
    dispatchProviderChange(provider);
}

export function restoreProviderState() {
    const providerSelect = getProviderSelect();
    if (providerSelect) {
        providerSelect.innerHTML = PROVIDERS
            .map(provider => `<option value="${provider.id}">${provider.label}</option>`)
            .join('');
        providerSelect.value = getStoredProviderId();
    }

    loadCurrentProviderStateIntoUi();
}

export function switchProvider(providerId) {
    const nextProvider = getProvider(providerId);
    const providerSelect = getProviderSelect();
    if (providerSelect) {
        providerSelect.value = nextProvider.id;
    }
    localStorage.setItem('provider_id', nextProvider.id);
    loadCurrentProviderStateIntoUi();
}

export function validateCurrentProviderUi() {
    const provider = getCurrentProvider();
    return provider.validateUi({
        apiKey: $('apiKey')?.value?.trim() || '',
        model: provider.features.modelListing
            ? $('modelSelect')?.value || ''
            : readInputValue('providerModelInput'),
        baseUrl: provider.storageKeys.baseUrl
            ? readInputValue('providerBaseUrl')
            : ''
    });
}
