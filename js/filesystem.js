/**
 * Filesystem Module
 * File System Access API for direct file operations
 */

import { showToast } from './ui.js';

// State
let directoryHandle = null;
let db = null;

function isLoopbackHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function getFileSystemSupportDetails() {
    return getPickerSupportDetails('directory');
}

export function getPickerSupportDetails(kind = 'directory') {
    const apiName = kind === 'file' ? 'showOpenFilePicker' : 'showDirectoryPicker';
    const hasPickerApi = apiName in window;
    const isPotentiallyTrustworthy = window.isSecureContext ||
        window.location.protocol === 'https:' ||
        isLoopbackHost(window.location.hostname);

    if (hasPickerApi) {
        return {
            supported: true,
            reason: 'supported',
            message: ''
        };
    }

    if (!isPotentiallyTrustworthy) {
        return {
            supported: false,
            reason: 'insecure-context',
            message: kind === 'directory'
                ? 'Folder selection requires localhost, 127.0.0.1, or HTTPS. Images will auto-download to your browser\'s chosen download folder on this origin.'
                : 'File picking requires localhost, 127.0.0.1, or HTTPS on this origin.'
        };
    }

    return {
        supported: false,
        reason: 'unsupported-browser',
        message: kind === 'directory'
            ? 'This browser does not support File System Access. Images will auto-download to your browser\'s chosen download folder.'
            : 'This browser does not support File System Access file pickers.'
    };
}

/**
 * Check if File System Access API is supported
 */
export function isFileSystemSupported() {
    return getFileSystemSupportDetails().supported;
}

function notifyUnsupportedPicker(kind, support) {
    const message = support?.message || getPickerSupportDetails(kind).message;
    if (message) {
        showToast(message);
    }
}

export async function pickDirectoryHandle(options = {}, { showErrors = true } = {}) {
    const support = getPickerSupportDetails('directory');
    if (!support.supported) {
        if (showErrors) notifyUnsupportedPicker('directory', support);
        return null;
    }

    try {
        return await window.showDirectoryPicker(options);
    } catch (error) {
        if (error.name !== 'AbortError' && showErrors) {
            console.error('Directory picker failed:', error);
            showToast('Failed to select folder');
        }
        return null;
    }
}

export async function pickFileHandle(options = {}, { showErrors = true } = {}) {
    const support = getPickerSupportDetails('file');
    if (!support.supported) {
        if (showErrors) notifyUnsupportedPicker('file', support);
        return null;
    }

    try {
        const [handle] = await window.showOpenFilePicker(options);
        return handle || null;
    } catch (error) {
        if (error.name !== 'AbortError' && showErrors) {
            console.error('File picker failed:', error);
            showToast('Failed to select file');
        }
        return null;
    }
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
    const support = getFileSystemSupportDetails();
    return {
        name: directoryHandle?.name || (support.supported ? null : 'Browser Downloads'),
        isSet: directoryHandle !== null,
        browserManaged: !support.supported
    };
}

/**
 * Select output directory via picker
 */
export async function selectOutputDirectory() {
    const selectedHandle = await pickDirectoryHandle({
        mode: 'readwrite',
        startIn: 'pictures'
    });

    if (!selectedHandle) {
        return false;
    }

    directoryHandle = selectedHandle;
    await persistDirectoryHandle();
    updateDirectoryUI();
    showToast(`Output folder: ${directoryHandle.name}`);
    return true;
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
    switch ((mimeType || '').toLowerCase()) {
        case 'image/jpeg':
        case 'image/jpg':
            return '.jpg';
        case 'image/webp':
            return '.webp';
        case 'image/gif':
            return '.gif';
        case 'image/png':
        default:
            return '.png';
    }
}

function ensureFilenameExtension(filename, mimeType = 'image/png') {
    const extension = getExtension(mimeType);
    if (!filename) {
        return `image${extension}`;
    }

    const normalized = filename.trim();
    if (!normalized) {
        return `image${extension}`;
    }

    if (/\.[a-z0-9]+$/i.test(normalized)) {
        return normalized.replace(/\.[a-z0-9]+$/i, extension);
    }

    return `${normalized}${extension}`;
}

export async function downloadImageData(imageDataUrl, filename) {
    const mimeType = getMimeType(imageDataUrl);
    const normalizedFilename = ensureFilenameExtension(filename, mimeType);
    const response = await fetch(imageDataUrl);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);

    try {
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = normalizedFilename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
    } finally {
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }

    return {
        filename: normalizedFilename,
        mimeType
    };
}

/**
 * Generate a meaningful filename from prompt
 * @param {string} prompt - The prompt text
 * @param {number} variationIndex - Variation index (0-based)
 * @param {string} batchName - Optional batch name prefix
 * @param {string} mimeType - Image MIME type (default: image/png)
 * @param {string} name - Optional per-prompt name (replaces prompt snippet)
 */
export function generateFilename(prompt, variationIndex = 0, batchName = '', mimeType = 'image/png', name = '') {
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

    // Use per-prompt name if provided, otherwise fall back to prompt snippet
    const trimmedName = (name || '').trim();
    const snippet = trimmedName
        ? trimmedName
            .toLowerCase()
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 50)
        : prompt
            .slice(0, 40)
            .trim()
            .toLowerCase()
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '')
        || 'image';

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
 * @param {string} name - Optional per-prompt name (replaces prompt snippet)
 */
export async function saveImageToFilesystem(imageDataUrl, prompt, variationIndex = 0, batchName = '', name = '') {
    const mimeType = getMimeType(imageDataUrl);

    // Fallback: trigger browser download
    if (!directoryHandle || !await hasWritePermission()) {
        return triggerDownload(imageDataUrl, prompt, variationIndex, batchName, mimeType, name);
    }

    try {
        const filename = generateFilename(prompt, variationIndex, batchName, mimeType, name);
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
        return triggerDownload(imageDataUrl, prompt, variationIndex, batchName, mimeType, name);
    }
}

/**
 * Fallback: trigger browser download
 */
function triggerDownload(imageDataUrl, prompt, variationIndex, batchName = '', mimeType = 'image/png', name = '') {
    const filename = generateFilename(prompt, variationIndex, batchName, mimeType, name);
    return downloadImageData(imageDataUrl, filename).then(({ filename: downloadFilename }) => ({
        filename: downloadFilename,
        success: true,
        method: 'download',
        directory: null
    }));
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
    updateFileSystemSupportUI();

    const nameEl = document.getElementById('outputDirName');
    const statusEl = document.getElementById('outputDirStatus');
    const clearBtn = document.getElementById('clearDirBtn');
    const selectBtn = document.getElementById('selectDirBtn');

    if (nameEl) {
        nameEl.textContent = directoryHandle?.name || (getFileSystemSupportDetails().supported ? 'Not set' : 'Browser Downloads');
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

export function updateFileSystemSupportUI() {
    const support = getFileSystemSupportDetails();
    const warningEl = document.getElementById('fsSupportWarning');
    const selectBtn = document.getElementById('selectDirBtn');
    const queueSelectBtn = document.getElementById('selectQueueOutputDirBtn');
    const nameEl = document.getElementById('outputDirName');

    if (warningEl) {
        warningEl.style.display = support.supported ? 'none' : 'block';
        warningEl.textContent = support.message;
    }

    if (nameEl && !support.supported && !directoryHandle) {
        nameEl.textContent = 'Browser Downloads';
        nameEl.classList.remove('selected');
    }

    if (selectBtn) {
        selectBtn.disabled = !support.supported;
        selectBtn.title = support.supported ? '' : support.message;
    }

    if (queueSelectBtn) {
        queueSelectBtn.disabled = !support.supported;
        queueSelectBtn.title = support.supported ? '' : support.message;
    }
}
