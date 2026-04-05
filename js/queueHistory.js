import { $, showToast, updateThinkingLabel } from './ui.js';
import { deleteHistoryEntry, loadHistoryEntry, loadRecentHistory } from './history.js';
import { downloadImageData } from './filesystem.js';
import { renderRefs, setRefImages } from './references.js';
import { persistAllInputs } from './persistence.js';
import { getProvider, persistCurrentProviderState, providerSupports, switchProvider } from './providers/index.js';

let historyPanelOpen = false;
let historyUiInitialized = false;

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatTimeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

function getHistoryModelLabel(config = {}) {
    const provider = getProvider(config.providerId);
    if (provider.id === 'gemini') {
        return (config.model || '?').replace('gemini-', '').replace('-image-preview', '') || '?';
    }
    return config.model ? `${provider.label}: ${config.model}` : provider.label;
}

function getHistoryStatus(entry = {}) {
    if (entry.status === 'failed' || entry.status === 'cancelled' || entry.status === 'completed') {
        return entry.status;
    }
    if (entry.error) {
        return 'failed';
    }
    return 'completed';
}

function getHistoryStatusLabel(status) {
    switch (status) {
        case 'failed': return 'Failed';
        case 'cancelled': return 'Cancelled';
        default: return 'Completed';
    }
}

function getHistoryDownloadName(entry) {
    if (entry.filename?.trim()) {
        return entry.filename.trim();
    }
    const timestamp = entry.createdAt ? new Date(entry.createdAt).toISOString().replace(/[:.]/g, '-') : Date.now();
    return `generation_${timestamp}`;
}

export function initQueueHistoryUI() {
    if (historyUiInitialized) return;

    $('historyFab')?.addEventListener('click', () => toggleHistoryPanel());
    $('historyOverlay')?.addEventListener('click', () => toggleHistoryPanel(false));
    $('historyCloseBtn')?.addEventListener('click', () => toggleHistoryPanel(false));
    $('historyClearAllBtn')?.addEventListener('click', clearAllHistory);

    $('historyPanelList')?.addEventListener('click', async (event) => {
        const deleteButton = event.target.closest('[data-history-delete]');
        if (deleteButton) {
            await deleteHistoryItem(deleteButton.dataset.historyDelete);
            return;
        }

        const historyItem = event.target.closest('[data-history-open]');
        if (historyItem) {
            openGenerationDetails(historyItem.dataset.historyOpen);
        }
    });

    historyUiInitialized = true;
}

/**
 * Open generation details overlay for a history entry
 */
export async function openGenerationDetails(historyId) {
    if (!historyId) return;

    const entry = await loadHistoryEntry(historyId);
    if (!entry) {
        showToast('History entry not found');
        return;
    }

    closeGenerationDetails();

    const overlay = document.createElement('div');
    overlay.className = 'generation-details-overlay';
    overlay.id = 'generationDetailsOverlay';

    const status = getHistoryStatus(entry);
    const statusLabel = getHistoryStatusLabel(status);
    const refCount = entry.refImages?.length || 0;
    const refsHtml = refCount > 0 ? `
        <div class="generation-details-section">
            <div class="generation-details-section-header">
                <span>References (${refCount})</span>
                <button class="btn-secondary btn-sm" data-details-action="save-all-refs">Save All</button>
            </div>
            <div class="generation-details-refs">
                ${entry.refImages.map((ref, index) => `
                    <div class="generation-details-ref-item">
                        <img src="${ref.data}" alt="Ref ${index + 1}">
                        <button class="generation-details-ref-save" data-details-action="save-ref" data-ref-index="${index}" title="Save">Save</button>
                    </div>
                `).join('')}
            </div>
        </div>
    ` : '';
    const outputHtml = entry.imageData ? `
        <div class="generation-details-section">
            <div class="generation-details-section-header">
                <span>Output</span>
                <button class="btn-secondary btn-sm" data-details-action="save-image">Save</button>
            </div>
            <div class="generation-details-image">
                <img src="${entry.imageData}" alt="Generated output">
            </div>
        </div>
    ` : '';
    const errorHtml = entry.error ? `
        <div class="generation-details-section">
            <div class="generation-details-section-header">
                <span>Error</span>
            </div>
            <div class="generation-details-error">${escapeHtml(entry.error)}</div>
        </div>
    ` : '';

    const timeLabel = entry.generationTimeMs ? `${(entry.generationTimeMs / 1000).toFixed(1)}s` : '';
    const provider = getProvider(entry.config?.providerId);
    const configBadges = [
        `<span class="history-status-badge history-status-${status}">${statusLabel}</span>`,
        entry.config?.providerLabel || provider.label,
        entry.config?.model,
        entry.config?.ratio,
        entry.config?.resolution,
        entry.config?.thinkingBudget ? `Think: ${entry.config.thinkingBudget}` : '',
        entry.config?.searchEnabled ? 'Search' : '',
        timeLabel,
        entry.filename || ''
    ].filter(Boolean);

    overlay.innerHTML = `
        <div class="generation-details-panel">
            <div class="generation-details-header">
                <h3>Generation Details</h3>
                <button class="close-btn" data-details-action="close">&times;</button>
            </div>
            <div class="generation-details-body">
                <div class="generation-details-section">
                    <div class="generation-details-section-header">
                        <span>Prompt</span>
                        <button class="btn-secondary btn-sm" data-details-action="copy-prompt">Copy</button>
                    </div>
                    <div class="generation-details-prompt">${escapeHtml(entry.prompt)}</div>
                </div>
                <div class="generation-details-config">
                    ${configBadges.map(badge => badge.startsWith('<span ') ? badge : `<span class="config-badge" title="${escapeHtml(badge)}">${escapeHtml(badge)}</span>`).join('')}
                </div>
                ${errorHtml}
                ${outputHtml}
                ${refsHtml}
            </div>
            <div class="generation-details-footer">
                <button class="btn-primary" data-details-action="redo" data-history-id="${entry.id}">Redo</button>
            </div>
        </div>
    `;

    overlay._historyEntry = entry;
    overlay.addEventListener('click', async (event) => {
        if (event.target === overlay) {
            closeGenerationDetails();
            return;
        }

        const actionButton = event.target.closest('[data-details-action]');
        if (!actionButton) return;

        const { detailsAction, refIndex, historyId: redoHistoryId } = actionButton.dataset;

        if (detailsAction === 'close') {
            closeGenerationDetails();
        } else if (detailsAction === 'copy-prompt') {
            await copyGenerationPrompt();
        } else if (detailsAction === 'save-image') {
            downloadGenerationImage();
        } else if (detailsAction === 'save-ref') {
            downloadGenerationRef(parseInt(refIndex, 10));
        } else if (detailsAction === 'save-all-refs') {
            downloadAllGenerationRefs();
        } else if (detailsAction === 'redo') {
            await redoFromHistory(redoHistoryId);
        }
    });

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
}

export function closeGenerationDetails() {
    const overlay = document.getElementById('generationDetailsOverlay');
    if (overlay) {
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 200);
    }
}

async function copyGenerationPrompt() {
    const overlay = document.getElementById('generationDetailsOverlay');
    if (!overlay?._historyEntry) return;

    try {
        await navigator.clipboard.writeText(overlay._historyEntry.prompt);
        showToast('Prompt copied');
    } catch {
        showToast('Copy failed');
    }
}

async function downloadGenerationImage() {
    const overlay = document.getElementById('generationDetailsOverlay');
    const entry = overlay?._historyEntry;
    if (!entry?.imageData) return;

    try {
        await downloadImageData(entry.imageData, getHistoryDownloadName(entry));
    } catch (error) {
        console.error('Failed to download generated image:', error);
        showToast('Download failed');
    }
}

function downloadGenerationRef(index) {
    const overlay = document.getElementById('generationDetailsOverlay');
    const entry = overlay?._historyEntry;
    if (!entry?.refImages?.[index]) return;

    const link = document.createElement('a');
    link.href = entry.refImages[index].data;
    link.download = `ref_${index + 1}.png`;
    link.click();
}

function downloadAllGenerationRefs() {
    const overlay = document.getElementById('generationDetailsOverlay');
    const entry = overlay?._historyEntry;
    if (!entry?.refImages?.length) return;

    entry.refImages.forEach((ref, index) => {
        setTimeout(() => {
            const link = document.createElement('a');
            link.href = ref.data;
            link.download = `ref_${index + 1}.png`;
            link.click();
        }, index * 200);
    });
}

async function redoFromHistory(historyId) {
    const entry = await loadHistoryEntry(historyId);
    if (!entry) {
        showToast('History entry not found');
        return;
    }

    const providerId = entry.config?.providerId || 'gemini';
    const provider = getProvider(providerId);
    persistCurrentProviderState();
    switchProvider(providerId);

    if (providerId === 'gemini' && $('apiKey')?.value?.length > 20) {
        try {
            const { refreshModels } = await import('./models.js');
            await refreshModels(true);
        } catch {
            // Best-effort refresh only.
        }
    }

    if ($('providerBaseUrl') && provider.storageKeys.baseUrl) {
        $('providerBaseUrl').value = entry.config?.baseUrl || '';
    }

    $('modelSelect')?.querySelectorAll('[data-history-model="true"]').forEach(option => option.remove());

    if (!provider.features.modelListing && $('providerModelInput')) {
        $('providerModelInput').value = entry.config?.model || '';
    } else if ($('modelSelect')?.querySelector(`option[value="${entry.config?.model || ''}"]`)) {
        $('modelSelect').value = entry.config.model;
    } else if (entry.config?.model && $('modelSelect')) {
        const option = document.createElement('option');
        option.value = entry.config.model;
        option.textContent = entry.config.model;
        option.dataset.historyModel = 'true';
        $('modelSelect').appendChild(option);
        $('modelSelect').value = entry.config.model;
        localStorage.setItem('last_model', entry.config.model);
        localStorage.setItem('last_model_gemini', entry.config.model);
    }

    $('prompt').value = entry.prompt;
    $('prompt').dispatchEvent(new Event('input'));
    $('ratio').value = entry.config?.ratio || '';
    $('resolution').value = entry.config?.resolution || '4K';

    if ($('searchToggle')) {
        $('searchToggle').checked = providerSupports('search', providerId) ? !!entry.config?.searchEnabled : false;
    }

    if ($('thinkingToggle') && $('thinkingBudget')) {
        if (providerSupports('thinking', providerId)) {
            const budget = entry.config?.thinkingBudget ?? -1;
            $('thinkingToggle').checked = budget !== 0;
            $('thinkingBudget').value = String(budget);
        } else {
            $('thinkingToggle').checked = true;
            $('thinkingBudget').value = '-1';
        }
        updateThinkingLabel();
    }

    if (providerSupports('safety', providerId) && Array.isArray(entry.config?.safetySettings)) {
        const safetyByCategory = new Map(entry.config.safetySettings.map(setting => [setting.category, setting.threshold]));
        const safetyFields = [
            ['safetyHarassment', 'HARM_CATEGORY_HARASSMENT'],
            ['safetyHateSpeech', 'HARM_CATEGORY_HATE_SPEECH'],
            ['safetySexuallyExplicit', 'HARM_CATEGORY_SEXUALLY_EXPLICIT'],
            ['safetyDangerous', 'HARM_CATEGORY_DANGEROUS_CONTENT']
        ];

        safetyFields.forEach(([id, category]) => {
            if ($(id) && safetyByCategory.has(category)) {
                $(id).value = safetyByCategory.get(category);
            }
        });
    }

    const newRefs = (entry.refImages || []).map((ref, index) => ({
        id: Date.now() + index + Math.random(),
        data: ref.data
    }));
    setRefImages(newRefs);
    renderRefs();
    persistCurrentProviderState();
    persistAllInputs();
    closeGenerationDetails();

    const { toggleQueuePanel } = await import('./queuePanel.js');
    toggleQueuePanel(false);
    showToast('Loaded generation settings');
}

export function toggleHistoryPanel(forceOpen = null) {
    const panel = $('historyPanel');
    const overlay = $('historyOverlay');
    if (!panel) return;

    historyPanelOpen = forceOpen !== null ? forceOpen : !historyPanelOpen;

    panel.classList.toggle('open', historyPanelOpen);
    overlay?.classList.toggle('open', historyPanelOpen);

    if (historyPanelOpen) {
        renderHistoryPanel();
    }
}

export async function renderHistoryPanel() {
    const list = $('historyPanelList');
    if (!list) return;

    list.innerHTML = '<div class="history-empty">Loading...</div>';

    const entries = await loadRecentHistory(100);
    if (entries.length === 0) {
        list.innerHTML = '<div class="history-empty">No generations yet</div>';
        return;
    }

    list.innerHTML = entries.map(entry => {
        const refCount = entry.refImages?.length || 0;
        const status = getHistoryStatus(entry);
        const statusLabel = getHistoryStatusLabel(status);
        const promptSnippet = `${escapeHtml(entry.prompt.slice(0, 60))}${entry.prompt.length > 60 ? '...' : ''}`;
        const errorSnippet = entry.error
            ? `<div class="history-item-error">${escapeHtml(entry.error)}</div>`
            : '';

        return `
            <div class="history-item" data-history-id="${entry.id}">
                <div class="history-item-main" data-history-open="${entry.id}">
                    <div class="history-item-prompt">${promptSnippet}</div>
                    <div class="history-item-meta">
                        <span class="history-status-badge history-status-${status}">${statusLabel}</span>
                        <span>${escapeHtml(getHistoryModelLabel(entry.config))}</span>
                        ${entry.config?.ratio ? `<span>${entry.config.ratio}</span>` : ''}
                        ${refCount > 0 ? `<span>${refCount} ref${refCount > 1 ? 's' : ''}</span>` : ''}
                        ${entry.generationTimeMs ? `<span>${(entry.generationTimeMs / 1000).toFixed(1)}s</span>` : ''}
                        <span>${formatTimeAgo(entry.createdAt)}</span>
                    </div>
                    ${errorSnippet}
                </div>
                <button class="history-item-delete" data-history-delete="${entry.id}" title="Delete">&times;</button>
            </div>
        `;
    }).join('');
}

async function deleteHistoryItem(id) {
    await deleteHistoryEntry(id);
    await renderHistoryPanel();
    showToast('Entry deleted');
}

async function clearAllHistory() {
    const { showConfirmDialog } = await import('./ui.js');
    const confirmed = await showConfirmDialog({
        title: 'Clear History',
        message: 'Clear all generation history? This cannot be undone.',
        confirmText: 'Clear All',
        danger: true
    });
    if (!confirmed) return;

    const { getDB } = await import('./history.js');
    const db = getDB();
    if (!db) return;

    await new Promise(resolve => {
        const tx = db.transaction('generationHistory', 'readwrite');
        tx.objectStore('generationHistory').clear();
        tx.oncomplete = resolve;
        tx.onerror = resolve;
    });

    await renderHistoryPanel();
    showToast('History cleared');
}
