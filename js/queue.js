/**
 * Queue Module
 * Multi-generation queue management with persistence
 */

import { DEFAULT_QUEUE_DELAY_MS, MAX_QUEUE_ITEMS, QUEUE_STORAGE_KEY } from './config.js';
import { generateSingleImage, showImageResult } from './generation.js';
import { saveQueueRefsMultiple, loadQueueRefsMultiple, deleteQueueRefsMultiple, clearAllQueueRefs } from './history.js';
import { saveImageToFilesystem, getDirectoryInfo } from './filesystem.js';
import { showToast, haptic, playNotificationSound, showConfirmDialog } from './ui.js';

// Queue item statuses
export const QueueStatus = {
    PENDING: 'pending',
    GENERATING: 'generating',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
};

// Queue state
let queueState = {
    items: [],
    isRunning: false,
    isPaused: false,
    delayBetweenMs: DEFAULT_QUEUE_DELAY_MS,
    completedCount: 0,
    failedCount: 0,
    startedAt: null,
    generationTimes: [] // Track generation times for ETA calculation
};

let abortController = null;
let onProgressCallback = null;

/**
 * Generate unique ID
 */
function generateId() {
    return 'qi_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Get current queue state
 */
export function getQueueState() {
    return { ...queueState };
}

/**
 * Set progress callback
 */
export function setOnProgress(callback) {
    onProgressCallback = callback;
}

/**
 * Add prompts to queue
 * @param {string[]} prompts - Array of prompt strings
 * @param {number} variationsPerPrompt - Number of variations per prompt
 * @param {Object} config - Generation config
 * @param {Array} refImagesSnapshot - Reference images to use
 * @param {string} batchName - Optional batch name for filename prefix
 * @param {string[]} names - Optional per-prompt names for filename labels
 * @returns {Object[]} - Created queue items
 */
export function addToQueue(prompts, variationsPerPrompt, config, refImagesSnapshot = [], batchName = '', names = []) {
    const newItems = [];
    const timestamp = Date.now();

    // Debug: log what refs we're receiving
    console.log('[Queue] addToQueue called with', refImagesSnapshot?.length || 0, 'refs, batchName:', batchName);

    prompts.forEach((prompt, promptIndex) => {
        const promptGroupId = 'pg_' + timestamp + '_' + promptIndex;

        for (let v = 0; v < variationsPerPrompt; v++) {
            if (queueState.items.length + newItems.length >= MAX_QUEUE_ITEMS) {
                showToast(`Queue limit reached (${MAX_QUEUE_ITEMS})`);
                break;
            }

            // Create a copy of refs for each variation to avoid shared reference issues
            const itemRefs = refImagesSnapshot && refImagesSnapshot.length > 0
                ? refImagesSnapshot.map(r => ({ ...r }))
                : [];

            newItems.push({
                id: generateId(),
                prompt: prompt.trim(),
                variationIndex: v,
                totalVariations: variationsPerPrompt,
                promptGroupId,
                status: QueueStatus.PENDING,
                createdAt: timestamp,
                startedAt: null,
                completedAt: null,
                error: null,
                filename: null,
                config: { ...config },
                refImages: itemRefs,
                batchName: batchName || '',
                name: (names[promptIndex] || '').trim()
            });

            console.log(`[Queue] Created item v${v + 1}/${variationsPerPrompt} with ${itemRefs.length} refs`);
        }
    });

    queueState.items.push(...newItems);

    // Save refs to IndexedDB for persistence
    const refsToSave = newItems
        .filter(item => item.refImages && item.refImages.length > 0)
        .map(item => ({ itemId: item.id, refImages: item.refImages }));

    if (refsToSave.length > 0) {
        saveQueueRefsMultiple(refsToSave).catch(e => {
            console.error('[Queue] Failed to save refs to IndexedDB:', e);
        });
    }

    persistQueueState();
    notifyProgress();

    return newItems;
}

/**
 * Remove item from queue
 */
export function removeQueueItem(id) {
    const index = queueState.items.findIndex(item => item.id === id);
    if (index !== -1) {
        const item = queueState.items[index];
        if (item.status === QueueStatus.PENDING) {
            queueState.items.splice(index, 1);
            // Also remove refs from IndexedDB
            deleteQueueRefsMultiple([id]).catch(e => {
                console.error('[Queue] Failed to delete refs:', e);
            });
            persistQueueState();
            notifyProgress();
        }
    }
}

/**
 * Skip a pending queue item
 * Note: Refs are NOT deleted here - they're kept in IndexedDB for potential retry
 */
export function skipQueueItem(id) {
    const item = queueState.items.find(i => i.id === id);
    if (item && item.status === QueueStatus.PENDING) {
        item.status = QueueStatus.CANCELLED;
        item.error = 'Skipped by user';
        item.completedAt = Date.now();
        // Don't delete refs - user might want to retry later
        persistQueueState();
        notifyProgress();
        showToast('Item skipped');
    }
}

/**
 * Retry a failed or cancelled queue item
 * Restores refs from IndexedDB if they were lost (e.g., after page refresh)
 */
export async function retryQueueItem(id) {
    const item = queueState.items.find(i => i.id === id);
    if (item && (item.status === QueueStatus.FAILED || item.status === QueueStatus.CANCELLED)) {
        // Restore refs from IndexedDB if missing (e.g., after page refresh)
        if (!item.refImages || item.refImages.length === 0) {
            try {
                const refsMap = await loadQueueRefsMultiple([id]);
                if (refsMap.has(id)) {
                    item.refImages = refsMap.get(id);
                    console.log(`[Queue] Restored ${item.refImages.length} refs for retry`);
                }
            } catch (e) {
                console.error('[Queue] Failed to restore refs for retry:', e);
            }
        }

        item.status = QueueStatus.PENDING;
        item.error = null;
        item.startedAt = null;
        item.completedAt = null;
        persistQueueState();
        notifyProgress();
        showToast('Item queued for retry');

        // Auto-start if queue is not running
        if (!queueState.isRunning) {
            startQueue();
        }
    }
}

/**
 * Clear all queue items (with confirmation)
 */
export async function clearQueue() {
    const itemCount = queueState.items.length;
    if (itemCount === 0) {
        showToast('Queue is already empty');
        return;
    }

    const confirmed = await showConfirmDialog({
        title: 'Clear Queue',
        message: `Clear all ${itemCount} items from the queue?`,
        warning: 'This cannot be undone.',
        confirmText: 'Clear All',
        danger: true
    });

    if (!confirmed) return;

    if (queueState.isRunning) {
        cancelQueue();
    }
    queueState.items = [];
    queueState.completedCount = 0;
    queueState.failedCount = 0;
    queueState.generationTimes = [];
    // Clear all refs from IndexedDB
    clearAllQueueRefs().catch(e => {
        console.error('[Queue] Failed to clear refs:', e);
    });
    persistQueueState();
    notifyProgress();
    showToast('Queue cleared');
}

/**
 * Start queue processing
 */
export async function startQueue() {
    if (queueState.isRunning) return;
    if (queueState.items.filter(i => i.status === QueueStatus.PENDING).length === 0) {
        showToast('No pending items in queue');
        return;
    }

    queueState.isRunning = true;
    queueState.isPaused = false;
    queueState.startedAt = Date.now();
    abortController = new AbortController();

    persistQueueState();
    notifyProgress();

    await processQueue();
}

/**
 * Pause queue processing
 */
export function pauseQueue() {
    if (!queueState.isRunning) return;
    queueState.isPaused = true;
    persistQueueState();
    notifyProgress();
    showToast('Queue paused');
}

/**
 * Resume queue processing
 */
export async function resumeQueue() {
    if (!queueState.isRunning || !queueState.isPaused) return;
    queueState.isPaused = false;
    persistQueueState();
    notifyProgress();
    showToast('Queue resumed');
    await processQueue();
}

/**
 * Cancel queue processing
 */
export function cancelQueue() {
    if (abortController) {
        abortController.abort();
    }
    queueState.isRunning = false;
    queueState.isPaused = false;

    // Mark any generating items as cancelled
    queueState.items.forEach(item => {
        if (item.status === QueueStatus.GENERATING) {
            item.status = QueueStatus.CANCELLED;
            item.error = 'Cancelled by user';
        }
    });

    persistQueueState();
    notifyProgress();
    showToast('Queue cancelled');
}

/**
 * Set delay between generations
 */
export function setQueueDelay(ms) {
    queueState.delayBetweenMs = ms;
    persistQueueState();
}

/**
 * Main queue processing loop
 */
async function processQueue() {
    while (queueState.isRunning && !queueState.isPaused) {
        const item = getNextPendingItem();
        if (!item) {
            // Queue complete
            queueState.isRunning = false;
            onQueueComplete();
            break;
        }

        // Debug: log refs for this item
        console.log(`[Queue] Processing item ${item.id}, variation ${item.variationIndex + 1}/${item.totalVariations}`);
        console.log(`[Queue] Item has ${item.refImages?.length || 0} refs`);

        // Process this item
        item.status = QueueStatus.GENERATING;
        item.startedAt = Date.now();
        persistQueueState();
        notifyProgress();

        try {
            // Generate image
            console.log(`[Queue] Calling generateSingleImage with ${item.refImages?.length || 0} refs`);
            const result = await generateSingleImage(
                item.prompt,
                item.config,
                item.refImages,
                abortController.signal
            );

            // Save to filesystem
            const dirInfo = getDirectoryInfo();
            let filename = null;

            if (dirInfo.isSet) {
                try {
                    const saveResult = await saveImageToFilesystem(
                        result.imageData,
                        item.prompt,
                        item.variationIndex,
                        item.batchName,
                        item.name
                    );
                    filename = saveResult.filename;
                } catch (e) {
                    console.error('Filesystem save failed:', e);
                }
            }

            // Mark completed
            item.status = QueueStatus.COMPLETED;
            item.completedAt = Date.now();
            item.filename = filename;
            queueState.completedCount++;

            // Show the last generated image in the right panel
            showImageResult(result.imageData, filename);

            // Track generation time for ETA calculation
            const generationTime = item.completedAt - item.startedAt;
            queueState.generationTimes.push(generationTime);
            // Keep only last 20 times to avoid memory bloat
            if (queueState.generationTimes.length > 20) {
                queueState.generationTimes.shift();
            }

            // Clean up refs from IndexedDB (no longer needed)
            deleteQueueRefsMultiple([item.id]).catch(e => {
                console.error('[Queue] Failed to clean up refs:', e);
            });

        } catch (e) {
            if (e.name === 'AbortError') {
                item.status = QueueStatus.CANCELLED;
                item.error = 'Cancelled';
                break;
            }

            // Handle rate limits with exponential backoff
            if (e.message?.includes('429') || e.message?.toLowerCase().includes('rate limit')) {
                item.status = QueueStatus.PENDING;
                item.startedAt = null;
                queueState.delayBetweenMs = Math.min(queueState.delayBetweenMs * 2, 60000);
                showToast(`Rate limited. Delay increased to ${queueState.delayBetweenMs / 1000}s`);
                await delay(queueState.delayBetweenMs);
                continue;
            }

            item.status = QueueStatus.FAILED;
            item.error = e.message || 'Unknown error';
            item.completedAt = Date.now();
            queueState.failedCount++;
        }

        persistQueueState();
        notifyProgress();

        // Delay before next generation
        if (getNextPendingItem() && queueState.isRunning && !queueState.isPaused) {
            await delay(queueState.delayBetweenMs);
        }
    }
}

/**
 * Get next pending item
 */
function getNextPendingItem() {
    return queueState.items.find(item => item.status === QueueStatus.PENDING);
}

/**
 * Called when queue completes
 */
function onQueueComplete() {
    const completed = queueState.completedCount;
    const failed = queueState.failedCount;

    playNotificationSound();
    haptic(300);

    if (failed === 0) {
        showToast(`Queue complete! ${completed} images generated`);
    } else {
        showToast(`Queue complete: ${completed} success, ${failed} failed`);
    }

    notifyProgress();

    // Auto-clear completed items after 5s so FAB hides (skip if failures exist for retry)
    if (failed === 0) {
        setTimeout(() => {
            // Guard: don't clear if user started a new queue in the meantime
            if (queueState.isRunning) return;
            queueState.items = [];
            queueState.completedCount = 0;
            queueState.failedCount = 0;
            queueState.generationTimes = [];
            clearAllQueueRefs().catch(() => {});
            persistQueueState();
            notifyProgress();
        }, 5000);
    }
}

/**
 * Notify progress callback
 */
function notifyProgress() {
    if (onProgressCallback) {
        onProgressCallback(getQueueState());
    }
}

/**
 * Persist queue state to localStorage
 */
export function persistQueueState() {
    try {
        // Don't persist reference images (too large)
        const stateToSave = {
            ...queueState,
            items: queueState.items.map(item => ({
                ...item,
                refImages: [] // Don't persist ref images
            }))
        };
        localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (e) {
        console.error('Failed to persist queue state:', e);
    }
}

/**
 * Restore queue state from localStorage
 * Also restores refs from IndexedDB
 */
export async function restoreQueueState() {
    try {
        const saved = localStorage.getItem(QUEUE_STORAGE_KEY);
        if (!saved) return null;

        const state = JSON.parse(saved);

        // Reset any "generating" items to "pending" (interrupted)
        state.items.forEach(item => {
            if (item.status === QueueStatus.GENERATING) {
                item.status = QueueStatus.PENDING;
                item.startedAt = null;
            }
        });

        // Mark as paused if was running
        if (state.isRunning) {
            state.isPaused = true;
        }

        // Restore refs from IndexedDB for all retryable items (PENDING, FAILED, CANCELLED)
        const retryableItemIds = state.items
            .filter(item =>
                item.status === QueueStatus.PENDING ||
                item.status === QueueStatus.FAILED ||
                item.status === QueueStatus.CANCELLED
            )
            .map(item => item.id);

        if (retryableItemIds.length > 0) {
            try {
                const refsMap = await loadQueueRefsMultiple(retryableItemIds);
                state.items.forEach(item => {
                    if (refsMap.has(item.id)) {
                        item.refImages = refsMap.get(item.id);
                        console.log(`[Queue] Restored ${item.refImages.length} refs for item ${item.id}`);
                    }
                });
            } catch (e) {
                console.error('[Queue] Failed to restore refs from IndexedDB:', e);
            }
        }

        queueState = state;
        return state;
    } catch (e) {
        console.error('Failed to restore queue state:', e);
        return null;
    }
}

/**
 * Check if queue has pending items from previous session
 */
export function hasResumableQueue() {
    return queueState.items.some(item => item.status === QueueStatus.PENDING);
}

/**
 * Get queue statistics
 */
export function getQueueStats() {
    const items = queueState.items;
    const total = items.length;
    const pending = items.filter(i => i.status === QueueStatus.PENDING).length;
    const completed = items.filter(i => i.status === QueueStatus.COMPLETED).length;
    const failed = items.filter(i => i.status === QueueStatus.FAILED).length;
    const cancelled = items.filter(i => i.status === QueueStatus.CANCELLED).length;
    const inProgress = items.filter(i => i.status === QueueStatus.GENERATING).length;

    return {
        total,
        pending,
        completed,
        failed,
        cancelled,
        inProgress,
        percentComplete: total > 0 ? Math.round((completed / total) * 100) : 0
    };
}

/**
 * Get average generation time from recent completions
 * @returns {number} Average time in milliseconds
 */
export function getAverageGenerationTime() {
    const times = queueState.generationTimes;
    if (times.length === 0) {
        return 30000; // Default 30s estimate
    }

    // Use last 10 generations for rolling average
    const recent = times.slice(-10);
    return Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
}

/**
 * Get estimated time remaining for queue
 * @returns {Object} ETA info with totalMs and formatted string
 */
export function getQueueETA() {
    const pending = queueState.items.filter(i => i.status === QueueStatus.PENDING).length;
    const inProgress = queueState.items.filter(i => i.status === QueueStatus.GENERATING).length;

    if (pending === 0 && inProgress === 0) {
        return { totalMs: 0, formatted: 'Complete' };
    }

    const avgTime = getAverageGenerationTime();
    const delayTime = queueState.delayBetweenMs;

    // Calculate remaining time
    // Current item (if generating) + pending items + delays between them
    const remainingItems = pending + inProgress;
    const totalMs = remainingItems * avgTime + Math.max(0, remainingItems - 1) * delayTime;

    return {
        totalMs,
        formatted: formatDuration(totalMs),
        avgGenerationTime: avgTime,
        isEstimate: queueState.generationTimes.length < 3 // Less confident with few samples
    };
}

/**
 * Format duration in human-readable form
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration
 */
function formatDuration(ms) {
    if (ms < 60000) {
        const secs = Math.round(ms / 1000);
        return `~${secs}s`;
    }

    const mins = Math.floor(ms / 60000);
    const secs = Math.round((ms % 60000) / 1000);

    if (mins < 60) {
        return secs > 0 ? `~${mins}m ${secs}s` : `~${mins}m`;
    }

    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return remainingMins > 0 ? `~${hours}h ${remainingMins}m` : `~${hours}h`;
}

/**
 * Utility: delay helper
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Update config for all PENDING queue items
 * Used to change generation settings mid-batch while paused
 * @param {Object} newConfig - Partial or full config to apply
 * @returns {number} Number of items updated
 */
export function updateQueueItemConfig(newConfig) {
    let count = 0;
    queueState.items.forEach(item => {
        if (item.status === QueueStatus.PENDING) {
            item.config = { ...item.config, ...newConfig };
            count++;
        }
    });
    if (count > 0) {
        persistQueueState();
        notifyProgress();
    }
    return count;
}

// Make functions globally available
window.startQueue = startQueue;
window.pauseQueue = pauseQueue;
window.resumeQueue = resumeQueue;
window.cancelQueue = cancelQueue;
window.clearQueue = clearQueue;
window.removeQueueItem = removeQueueItem;
window.skipQueueItem = skipQueueItem;
window.retryQueueItem = retryQueueItem;
