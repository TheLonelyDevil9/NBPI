import { $, showToast } from './ui.js';
import {
    cancelQueue,
    clearQueue,
    getQueueETA,
    getQueueState,
    getQueueStats,
    pauseQueue,
    QueueStatus,
    removeQueueItem,
    resumeQueue,
    retryAllFailedItems,
    retryQueueItem,
    skipQueueItem,
    startQueue,
    updateQueueItemConfig
} from './queue.js';
import { getCurrentProvider } from './providers/index.js';
import { openGenerationDetails } from './queueHistory.js';

let queuePanelUiInitialized = false;

function isNarrowViewport() {
    return window.matchMedia('(max-width: 768px)').matches;
}

function isQueueSetupOpen() {
    return $('queueSetupModal')?.classList.contains('open');
}

function setVisibility(id, isVisible) {
    const element = $(id);
    if (element) {
        element.classList.toggle('hidden', !isVisible);
    }
}

function syncQueueOverrideFeatureState() {
    const provider = getCurrentProvider();
    setVisibility('queueThinkingRow', !!provider.features.thinking);
    setVisibility('queueSearchRow', !!provider.features.search);
    setVisibility('queueSafetyOverrides', !!provider.features.safety);
}

export function initQueuePanelUI() {
    if (queuePanelUiInitialized) return;

    $('queueFab')?.addEventListener('click', async () => {
        if (isQueueSetupOpen()) {
            const { closeQueueSetup } = await import('./queueUI.js');
            closeQueueSetup();
        }
        toggleQueuePanel(true);
    });
    $('queueOverlay')?.addEventListener('click', () => toggleQueuePanel(false));
    $('queueCloseBtn')?.addEventListener('click', () => toggleQueuePanel(false));
    $('queueStartBtn')?.addEventListener('click', startQueue);
    $('queuePauseBtn')?.addEventListener('click', pauseQueue);
    $('queueResumeBtn')?.addEventListener('click', resumeQueue);
    $('queueRetryAllBtn')?.addEventListener('click', retryAllFailedItems);
    $('queueEditSettingsBtn')?.addEventListener('click', toggleQueueSettings);
    $('queueCancelBtn')?.addEventListener('click', cancelQueue);
    $('queueApplySettingsBtn')?.addEventListener('click', applySettingsToRemaining);
    $('queueAddMoreBtn')?.addEventListener('click', async () => {
        const { openQueueSetup } = await import('./queueUI.js');
        openQueueSetup();
    });
    $('queueExportResultsBtn')?.addEventListener('click', async () => {
        const { exportQueueResults } = await import('./queueUI.js');
        exportQueueResults();
    });
    $('queueClearAllBtn')?.addEventListener('click', clearQueue);

    $('queueItemList')?.addEventListener('click', async (event) => {
        const actionButton = event.target.closest('[data-queue-action]');
        if (!actionButton) return;

        const { queueAction, itemId, historyId } = actionButton.dataset;

        if (queueAction === 'skip') {
            skipQueueItem(itemId);
        } else if (queueAction === 'remove') {
            removeQueueItem(itemId);
        } else if (queueAction === 'retry') {
            await retryQueueItem(itemId);
        } else if (queueAction === 'info') {
            openGenerationDetails(historyId);
        }
    });

    window.addEventListener('resize', updateQueueFab);
    window.addEventListener('nbpi:provider-change', syncQueueOverrideFeatureState);

    queuePanelUiInitialized = true;
    syncQueueOverrideFeatureState();
}

/**
 * Toggle queue panel visibility
 */
export function toggleQueuePanel(forceOpen = null) {
    const panel = $('queuePanel');
    const overlay = $('queueOverlay');

    if (!panel) return;

    const shouldOpen = forceOpen !== null ? forceOpen : !panel.classList.contains('open');

    panel.classList.toggle('open', shouldOpen);
    overlay?.classList.toggle('open', shouldOpen);

    if (shouldOpen) {
        renderQueuePanel();
    }

    updateQueueFab();
}

/**
 * Render queue panel content
 */
export function renderQueuePanel() {
    const state = getQueueState();
    const stats = getQueueStats();
    const eta = getQueueETA();

    const progressBar = $('queueProgressBar');
    if (progressBar) {
        progressBar.style.width = `${stats.percentComplete}%`;
    }

    const progressText = $('queueProgressText');
    if (progressText) {
        if (stats.total === 0) {
            progressText.textContent = 'No items';
        } else {
            let text = `${stats.completed}/${stats.total} completed`;
            if (stats.failed > 0) {
                text += ` • ${stats.failed} failed`;
            }
            if (state.isRunning && !state.isPaused && eta.totalMs > 0) {
                text += ` • ${eta.formatted} remaining`;
            }
            progressText.textContent = text;
        }
    }

    const statusEl = $('queueStatus');
    if (statusEl) {
        const currentItem = state.items.find(item => item.status === QueueStatus.GENERATING);

        if (state.isRunning && !state.isPaused && currentItem) {
            const promptSnippet = currentItem.prompt.slice(0, 30);
            statusEl.textContent = `Generating: "${promptSnippet}..." (${currentItem.variationIndex + 1}/${currentItem.totalVariations})`;
        } else if (state.isPaused) {
            statusEl.textContent = 'Paused';
        } else if (stats.pending > 0) {
            statusEl.textContent = `${stats.pending} items pending`;
        } else if (stats.total > 0) {
            statusEl.textContent = 'Complete';
        } else {
            statusEl.textContent = 'Queue empty';
        }
    }

    const startBtn = $('queueStartBtn');
    const pauseBtn = $('queuePauseBtn');
    const resumeBtn = $('queueResumeBtn');
    const retryAllBtn = $('queueRetryAllBtn');
    const cancelBtn = $('queueCancelBtn');

    startBtn?.classList.toggle('hidden', state.isRunning);
    pauseBtn?.classList.toggle('hidden', !state.isRunning || state.isPaused);
    resumeBtn?.classList.toggle('hidden', !state.isPaused);

    if (retryAllBtn) {
        const hasFailedItems = stats.failed > 0;
        retryAllBtn.classList.toggle('hidden', !hasFailedItems);
        retryAllBtn.disabled = !hasFailedItems;
        retryAllBtn.title = hasFailedItems
            ? state.isRunning && !state.isPaused
                ? `Retry all ${stats.failed} failed item${stats.failed !== 1 ? 's' : ''} without interrupting the current generation`
                : `Retry all ${stats.failed} failed item${stats.failed !== 1 ? 's' : ''}`
            : 'No failed items to retry';
    }

    if (cancelBtn) cancelBtn.disabled = !state.isRunning;

    const editSettingsBtn = $('queueEditSettingsBtn');
    if (editSettingsBtn) {
        editSettingsBtn.classList.toggle('hidden', !(state.isPaused && stats.pending > 0));
    }

    if (!state.isPaused) {
        $('queueSettingsOverride')?.classList.add('hidden');
    }

    syncQueueOverrideFeatureState();
    renderQueueItemList(state.items);
}

function renderQueueItemList(items) {
    const list = $('queueItemList');
    if (!list) return;

    if (items.length === 0) {
        list.innerHTML = '<div class="queue-empty">No items in queue</div>';
        return;
    }

    list.innerHTML = items.map(item => {
        const canRetry = item.status === QueueStatus.FAILED || item.status === QueueStatus.CANCELLED;
        const canInspect = !!item.historyId && (
            item.status === QueueStatus.COMPLETED ||
            item.status === QueueStatus.FAILED ||
            item.status === QueueStatus.CANCELLED
        );

        return `
            <div class="queue-item queue-item-${item.status}" data-id="${item.id}">
                <div class="queue-item-status">
                    ${getStatusIcon(item.status)}
                </div>
                <div class="queue-item-info">
                    <div class="queue-item-prompt">${escapeHtml(item.prompt.slice(0, 40))}${item.prompt.length > 40 ? '...' : ''}</div>
                    <div class="queue-item-meta">
                        v${item.variationIndex + 1}/${item.totalVariations}
                        ${item.error ? `<span class="queue-error-text">${escapeHtml(item.error)}</span>` : ''}
                    </div>
                </div>
                <div class="queue-item-actions">
                    ${item.status === QueueStatus.PENDING ? `
                        <button class="queue-item-btn skip-btn" data-queue-action="skip" data-item-id="${item.id}" title="Skip this item">Skip</button>
                        <button class="queue-item-remove" data-queue-action="remove" data-item-id="${item.id}" title="Remove from queue">×</button>
                    ` : ''}
                    ${canRetry ? `
                        <button class="queue-item-btn retry-btn" data-queue-action="retry" data-item-id="${item.id}" title="Retry this item">Retry</button>
                    ` : ''}
                    ${canInspect ? `
                        <button class="queue-item-btn info-btn" data-queue-action="info" data-history-id="${item.historyId}" title="View generation details">Info</button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function getStatusIcon(status) {
    switch (status) {
        case QueueStatus.PENDING: return '⏳';
        case QueueStatus.GENERATING: return '<div class="mini-spinner"></div>';
        case QueueStatus.COMPLETED: return '✓';
        case QueueStatus.FAILED: return '✗';
        case QueueStatus.CANCELLED: return '⊘';
        default: return '';
    }
}

/**
 * Update the floating queue indicator (FAB)
 */
export function updateQueueFab() {
    const fab = $('queueFab');
    const fabText = $('queueFabText');
    const fabProgress = $('queueFabProgress');
    const panelOpen = $('queuePanel')?.classList.contains('open');
    const queueSetupOpen = isQueueSetupOpen();

    if (!fab) return;

    const state = getQueueState();
    const stats = getQueueStats();
    const shouldShow = state.isRunning || stats.total > 0;
    const shouldPanelDock = shouldShow && panelOpen && !queueSetupOpen && !isNarrowViewport();
    const shouldModalDock = shouldShow && queueSetupOpen && !isNarrowViewport();
    const shouldHideForOpenMobile = shouldShow && (panelOpen || queueSetupOpen) && isNarrowViewport();

    fab.classList.toggle('hidden', !shouldShow || shouldHideForOpenMobile);
    fab.classList.toggle('is-docked', shouldPanelDock);
    fab.classList.toggle('is-modal-docked', shouldModalDock);

    if (!shouldShow || shouldHideForOpenMobile) return;

    if (shouldModalDock) {
        const footer = document.querySelector('#queueSetupModal.open .queue-modal-footer.fullscreen');
        const actions = footer?.querySelector('.queue-footer-actions');
        const statsLabel = footer?.querySelector('.queue-footer-stats');
        const fabSize = fab.offsetWidth || 56;

        if (footer && actions) {
            const footerRect = footer.getBoundingClientRect();
            const actionsRect = actions.getBoundingClientRect();
            const statsRect = statsLabel?.getBoundingClientRect();
            const minLeft = Math.max(footerRect.left + 16, (statsRect?.right || footerRect.left) + 24);
            const maxLeft = actionsRect.left - fabSize - 24;
            const canFitBetweenStatsAndActions = maxLeft >= minLeft;

            if (canFitBetweenStatsAndActions) {
                fab.style.left = `${maxLeft}px`;
                fab.style.top = `${footerRect.top + Math.max(0, (footerRect.height - fabSize) / 2)}px`;
                fab.style.right = 'auto';
                fab.style.bottom = 'auto';
            } else {
                fab.style.left = 'auto';
                fab.style.top = `${Math.max(16, footerRect.top - fabSize - 16)}px`;
                fab.style.right = `${Math.max(16, window.innerWidth - actionsRect.right)}px`;
                fab.style.bottom = 'auto';
            }
        }
    } else {
        fab.style.left = 'auto';
        fab.style.top = 'auto';
        fab.style.right = '';
        fab.style.bottom = '';
    }

    const isComplete = !state.isRunning && !state.isPaused && stats.pending === 0 && stats.inProgress === 0;

    if (fabText) {
        if (isComplete && stats.failed > 0 && stats.completed === 0) {
            fabText.textContent = `${stats.failed}✗`;
        } else if (isComplete) {
            fabText.textContent = '✓';
        } else {
            fabText.textContent = `${stats.completed}/${stats.total}`;
        }
    }

    if (fabProgress) {
        fabProgress.style.height = `${stats.percentComplete}%`;
    }

    fab.classList.toggle('generating', state.isRunning && !state.isPaused);
    fab.classList.toggle('complete', isComplete);
}

/**
 * Toggle the inline settings override panel and populate from first pending item
 */
export function toggleQueueSettings() {
    const panel = $('queueSettingsOverride');
    if (!panel) return;

    const isHidden = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');

    if (!isHidden) return;

    syncQueueOverrideFeatureState();

    const state = getQueueState();
    const firstPending = state.items.find(item => item.status === QueueStatus.PENDING);
    if (!firstPending?.config) return;

    const config = firstPending.config;
    const queueRatio = $('queueRatio');
    const queueResolution = $('queueResolution');
    const queueThinking = $('queueThinking');
    const queueSearch = $('queueSearch');

    if (queueRatio) queueRatio.value = config.ratio || '';
    if (queueResolution) queueResolution.value = config.resolution || '2K';
    if (queueThinking && getCurrentProvider().features.thinking) {
        const budget = config.thinkingBudget !== undefined ? config.thinkingBudget : -1;
        const options = Array.from(queueThinking.options).map(option => parseInt(option.value, 10));
        const closest = options.reduce((previous, current) =>
            Math.abs(current - budget) < Math.abs(previous - budget) ? current : previous
        );
        queueThinking.value = String(closest);
    }
    if (queueSearch && getCurrentProvider().features.search) {
        queueSearch.checked = !!config.searchEnabled;
    }

    ['queueSafetyHarassment', 'queueSafetyHate', 'queueSafetySexual', 'queueSafetyDangerous'].forEach(id => {
        if ($(id)) $(id).value = '';
    });
}

/**
 * Apply settings from the override panel to all pending queue items
 */
export function applySettingsToRemaining() {
    const provider = getCurrentProvider();
    const newConfig = {};

    if ($('queueRatio')) newConfig.ratio = $('queueRatio').value;
    if ($('queueResolution')) newConfig.resolution = $('queueResolution').value;
    if (provider.features.thinking && $('queueThinking')) {
        newConfig.thinkingBudget = parseInt($('queueThinking').value, 10);
    }
    if (provider.features.search && $('queueSearch')) {
        newConfig.searchEnabled = $('queueSearch').checked;
    }

    if (provider.features.safety) {
        const safetyMap = [
            { id: 'queueSafetyHarassment', category: 'HARM_CATEGORY_HARASSMENT' },
            { id: 'queueSafetyHate', category: 'HARM_CATEGORY_HATE_SPEECH' },
            { id: 'queueSafetySexual', category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT' },
            { id: 'queueSafetyDangerous', category: 'HARM_CATEGORY_DANGEROUS_CONTENT' }
        ];

        const safetyOverrides = [];
        safetyMap.forEach(({ id, category }) => {
            const element = $(id);
            if (element?.value) {
                safetyOverrides.push({ category, threshold: element.value });
            }
        });

        if (safetyOverrides.length > 0) {
            const state = getQueueState();
            const firstPending = state.items.find(item => item.status === QueueStatus.PENDING);
            const existingSafety = firstPending?.config?.safetySettings || [];
            const mergedSafety = [...existingSafety];

            safetyOverrides.forEach(override => {
                const existingIndex = mergedSafety.findIndex(item => item.category === override.category);
                if (existingIndex >= 0) {
                    mergedSafety[existingIndex] = override;
                } else {
                    mergedSafety.push(override);
                }
            });

            newConfig.safetySettings = mergedSafety;
        }
    }

    const updatedCount = updateQueueItemConfig(newConfig);
    $('queueSettingsOverride')?.classList.add('hidden');
    showToast(`Settings applied to ${updatedCount} remaining item${updatedCount !== 1 ? 's' : ''}`);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
