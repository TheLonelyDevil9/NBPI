/**
 * Filesystem Module
 * File System Access API for direct file operations
 */

import { showToast } from './ui.js';

// State
let directoryHandle = null;
let db = null;

/**
 * Check if File System Access API is supported
 */
export function isFileSystemSupported() {
    return 'showDirectoryPicker' in window;
}

/**
 * Set the database reference (called from history.js after DB init)
 */
export function setFilesystemDB(database) {
    db = database;
}

/**
 * Get current directory info
 */
export function getDirectoryInfo() {
    return {
        name: directoryHandle?.name || null,
        isSet: directoryHandle !== null
    };
}

/**
 * Select output directory via picker
 */
export async function selectOutputDirectory() {
    if (!isFileSystemSupported()) {
        showToast('File System Access not supported in this browser');
        return false;
    }

    try {
        directoryHandle = await window.showDirectoryPicker({
            mode: 'readwrite',
            startIn: 'pictures'
        });

        await persistDirectoryHandle();
        updateDirectoryUI();
        showToast(`Output folder: ${directoryHandle.name}`);
        return true;
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error('Directory selection failed:', e);
            showToast('Failed to select folder');
        }
        return false;
    }
}

/**
 * Persist directory handle to IndexedDB
 */
async function persistDirectoryHandle() {
    if (!db || !directoryHandle) return;

    return new Promise((resolve, reject) => {
        const tx = db.transaction('settings', 'readwrite');
        tx.objectStore('settings').put({
            id: 'outputDirectory',
            handle: directoryHandle,
            name: directoryHandle.name,
            savedAt: Date.now()
        });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Restore directory handle from IndexedDB (requires permission re-grant)
 */
export async function restoreDirectoryHandle() {
    if (!db || !isFileSystemSupported()) return false;

    try {
        const result = await new Promise((resolve, reject) => {
            const tx = db.transaction('settings', 'readonly');
            const req = tx.objectStore('settings').get('outputDirectory');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        if (result?.handle) {
            // Verify permission
            const permission = await result.handle.queryPermission({ mode: 'readwrite' });

            if (permission === 'granted') {
                directoryHandle = result.handle;
                updateDirectoryUI();
                return true;
            }

            // Try to request permission (will only work with user gesture)
            // Store handle for later permission request
            directoryHandle = result.handle;
            return 'needs-permission';
        }
        return false;
    } catch (e) {
        console.error('Failed to restore directory handle:', e);
        return false;
    }
}

/**
 * Clear directory selection
 */
export async function clearDirectorySelection() {
    directoryHandle = null;

    if (db) {
        return new Promise((resolve) => {
            const tx = db.transaction('settings', 'readwrite');
            tx.objectStore('settings').delete('outputDirectory');
            tx.oncomplete = () => {
                updateDirectoryUI();
                showToast('Output folder cleared');
                resolve();
            };
            tx.onerror = resolve;
        });
    }

    updateDirectoryUI();
}

/**
 * Check if we have write permission
 */
export async function hasWritePermission() {
    if (!directoryHandle) return false;

    try {
        const permission = await directoryHandle.queryPermission({ mode: 'readwrite' });
        return permission === 'granted';
    } catch {
        return false;
    }
}

/**
 * Detect MIME type from a data URL
 */
function getMimeType(dataUrl) {
    const match = dataUrl.match(/^data:(image\/\w+)/);
    return match ? match[1] : 'image/png';
}

/**
 * Get file extension for MIME type
 */
function getExtension(mimeType) {
    // Always return .png (API returns PNG by default)
    return '.png';
}

/**
 * Generate a meaningful filename from prompt
 * @param {string} prompt - The prompt text
 * @param {number} variationIndex - Variation index (0-based)
 * @param {string} batchName - Optional batch name prefix
 * @param {string} mimeType - Image MIME type (default: image/png)
 */
export function generateFilename(prompt, variationIndex = 0, batchName = '', mimeType = 'image/png') {
    // Sanitize batch name if provided
    const batchPrefix = batchName
        ? batchName
            .trim()
            .toLowerCase()
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 30) + '_'
        : '';

    // Take first 40 chars of prompt
    const snippet = prompt
        .slice(0, 40)
        .trim()
        .toLowerCase()
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '') // Remove invalid filename chars
        .replace(/\s+/g, '_')                   // Spaces to underscores
        .replace(/_+/g, '_')                    // Collapse multiple underscores
        .replace(/^_|_$/g, '')                  // Trim underscores
        || 'image';                             // Fallback if empty

    // ISO timestamp, filesystem-safe
    const timestamp = new Date().toISOString()
        .replace(/:/g, '-')
        .replace(/\.\d{3}Z$/, '');

    // Variation suffix
    const variation = variationIndex > 0 ? `_v${variationIndex + 1}` : '';

    const ext = getExtension(mimeType);
    return `${batchPrefix}${snippet}_${timestamp}${variation}${ext}`;
}

/**
 * Save image to filesystem (preserves format, ensures .png extension)
 * @param {string} imageDataUrl - The image data URL
 * @param {string} prompt - The prompt text
 * @param {number} variationIndex - Variation index (0-based)
 * @param {string} batchName - Optional batch name prefix
 */
export async function saveImageToFilesystem(imageDataUrl, prompt, variationIndex = 0, batchName = '') {
    const mimeType = 'image/png'; // API returns PNG

    // Fallback: trigger browser download
    if (!directoryHandle || !await hasWritePermission()) {
        return triggerDownload(imageDataUrl, prompt, variationIndex, batchName, mimeType);
    }

    try {
        const filename = generateFilename(prompt, variationIndex, batchName, mimeType);
        const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });

        // Convert data URL to blob
        const response = await fetch(imageDataUrl);
        const blob = await response.blob();

        // Write to file
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();

        return {
            filename,
            success: true,
            method: 'filesystem',
            directory: directoryHandle.name
        };
    } catch (e) {
        console.error('Filesystem save failed:', e);

        // Check for specific errors
        if (e.name === 'NotAllowedError') {
            showToast('Permission denied. Please re-select folder.');
            directoryHandle = null;
            updateDirectoryUI();
        } else if (e.name === 'QuotaExceededError') {
            showToast('Disk full. Cannot save image.');
        }

        // Fallback to download
        return triggerDownload(imageDataUrl, prompt, variationIndex, batchName, mimeType);
    }
}

/**
 * Fallback: trigger browser download
 */
function triggerDownload(imageDataUrl, prompt, variationIndex, batchName = '', mimeType = 'image/png') {
    const filename = generateFilename(prompt, variationIndex, batchName, 'image/png');
    const a = document.createElement('a');
    a.href = imageDataUrl;
    a.download = filename;
    a.click();

    return {
        filename,
        success: true,
        method: 'download',
        directory: null
    };
}

/**
 * Delete file from filesystem
 */
export async function deleteFromFilesystem(filename) {
    if (!directoryHandle || !await hasWritePermission()) {
        return false;
    }

    try {
        await directoryHandle.removeEntry(filename);
        return true;
    } catch (e) {
        // File might not exist, that's okay
        if (e.name !== 'NotFoundError') {
            console.error('Delete failed:', e);
        }
        return false;
    }
}

/**
 * Update directory UI elements
 */
function updateDirectoryUI() {
    const nameEl = document.getElementById('outputDirName');
    const statusEl = document.getElementById('outputDirStatus');
    const clearBtn = document.getElementById('clearDirBtn');
    const selectBtn = document.getElementById('selectDirBtn');

    if (nameEl) {
        nameEl.textContent = directoryHandle?.name || 'Not set';
        nameEl.classList.toggle('selected', !!directoryHandle);
    }

    if (statusEl) {
        statusEl.classList.toggle('active', !!directoryHandle);
    }

    if (clearBtn) {
        clearBtn.classList.toggle('hidden', !directoryHandle);
    }

    if (selectBtn) {
        selectBtn.textContent = directoryHandle ? 'Change' : 'Select Folder';
    }
}

// Export for global access
window.selectOutputDirectory = selectOutputDirectory;
window.clearDirectorySelection = clearDirectorySelection;
