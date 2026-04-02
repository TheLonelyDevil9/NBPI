/**
 * Reference Images Module
 * Reference image handling, compression, drag-drop
 */

import { MAX_REF_IMAGE_SIZE, MAX_REFS } from './config.js';
import { $, showToast } from './ui.js';
import { getDB } from './history.js';
import { loadPersistedInput } from './persistence.js';
import { providerSupports } from './providers/index.js';

// Reference images state
export let refImages = [];

// Set reference images (for persistence restore)
export function setRefImages(images) {
    refImages = images;
}

// Load ref images from IndexedDB (with localStorage migration)
export async function loadRefImages() {
    const db = getDB();
    if (!db) {
        // Fallback to localStorage if DB not ready
        refImages = loadPersistedInput('refImages', []);
        renderRefs();
        return;
    }

    return new Promise((resolve) => {
        const tx = db.transaction('refImages', 'readonly');
        tx.objectStore('refImages').get('current').onsuccess = e => {
            const result = e.target.result;
            if (result && result.images) {
                refImages = result.images;
                renderRefs();
                resolve();
            } else {
                // Migrate from localStorage if exists
                const oldData = loadPersistedInput('refImages', []);
                if (oldData.length > 0) {
                    refImages = oldData;
                    renderRefs();
                    saveRefImages().then(() => {
                        // Clear old localStorage data after migration
                        localStorage.removeItem('input_refImages');
                        console.log('Migrated refImages from localStorage to IndexedDB');
                    });
                } else {
                    refImages = [];
                    renderRefs();
                }
                resolve();
            }
        };
    });
}

// Save ref images to IndexedDB
export async function saveRefImages() {
    const db = getDB();
    if (!db) return;

    return new Promise((resolve, reject) => {
        const tx = db.transaction('refImages', 'readwrite');
        tx.objectStore('refImages').put({ id: 'current', images: refImages });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

// Compress image to max size (using JPEG for smaller file size)
export async function compressImage(dataUrl) {
    const blob = await fetch(dataUrl).then(r => r.blob());
    const bitmap = await createImageBitmap(blob);
    let w = bitmap.width, h = bitmap.height;
    if (w > MAX_REF_IMAGE_SIZE || h > MAX_REF_IMAGE_SIZE) {
        const scale = MAX_REF_IMAGE_SIZE / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    // Use JPEG with 0.85 quality for smaller file size
    return canvas.toDataURL('image/jpeg', 0.85);
}

// Add reference images from files
export async function addRefImages(files) {
    if (!providerSupports('refs')) {
        showToast('Current provider does not support reference images');
        $('refInput').value = '';
        return;
    }

    const fileArray = Array.from(files);
    let addedCount = 0;

    for (const f of fileArray) {
        if (refImages.length >= MAX_REFS) {
            showToast('Maximum ' + MAX_REFS + ' reference images reached');
            break;
        }
        if (!f.type.startsWith('image/')) continue;

        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(f);
            });
            const compressed = await compressImage(dataUrl);
            refImages.push({ id: Date.now() + Math.random(), data: compressed });
            addedCount++;
        } catch (err) {
            console.error('Error processing file:', f.name, err);
        }
    }

    if (addedCount > 0) {
        renderRefs();
        saveRefImages();
        showToast(addedCount + ' image' + (addedCount > 1 ? 's' : '') + ' added');
    }
    $('refInput').value = '';
}

// Render reference images grid
export function renderRefs() {
    const refGrid = $('refGrid');
    const refCount = $('refCount');
    const supportsRefs = providerSupports('refs');

    const addBtn = refImages.length < MAX_REFS
        ? `<button class="ref-add" ${supportsRefs ? '' : 'disabled'} onclick="document.getElementById('refInput').click()">+</button>`
        : '';

    refGrid.innerHTML = refImages.map((img, idx) =>
        '<div class="ref-thumb-wrap" draggable="true" data-ref-idx="' + idx + '">' +
        '<span class="ref-order-badge">' + (idx + 1) + '</span>' +
        '<img src="' + img.data + '" class="ref-thumb" onclick="viewRefImage(' + img.id + ')">' +
        '<button class="ref-remove" onclick="removeRef(' + img.id + ')">×</button>' +
        '</div>'
    ).join('') + addBtn;

    refCount.textContent = refImages.length ? '(' + refImages.length + '/' + MAX_REFS + ')' : '';
    $('refSection')?.classList.toggle('provider-disabled', !supportsRefs);

    // Setup reorder drag handlers on each thumb
    setupRefReorderHandlers(refGrid);
}

// Drag-to-reorder state
let dragSrcIdx = null;

function setupRefReorderHandlers(grid) {
    const thumbs = grid.querySelectorAll('.ref-thumb-wrap[draggable="true"]');

    thumbs.forEach(thumb => {
        thumb.addEventListener('dragstart', e => {
            dragSrcIdx = parseInt(thumb.dataset.refIdx);
            thumb.classList.add('ref-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', dragSrcIdx.toString());
        });

        thumb.addEventListener('dragend', () => {
            thumb.classList.remove('ref-dragging');
            grid.querySelectorAll('.ref-drop-before, .ref-drop-after').forEach(el => {
                el.classList.remove('ref-drop-before', 'ref-drop-after');
            });
            dragSrcIdx = null;
        });

        thumb.addEventListener('dragover', e => {
            if (dragSrcIdx === null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            const targetIdx = parseInt(thumb.dataset.refIdx);
            if (targetIdx === dragSrcIdx) return;

            grid.querySelectorAll('.ref-drop-before, .ref-drop-after').forEach(el => {
                el.classList.remove('ref-drop-before', 'ref-drop-after');
            });

            if (targetIdx < dragSrcIdx) {
                thumb.classList.add('ref-drop-before');
            } else {
                thumb.classList.add('ref-drop-after');
            }
        });

        thumb.addEventListener('dragleave', () => {
            thumb.classList.remove('ref-drop-before', 'ref-drop-after');
        });

        thumb.addEventListener('drop', e => {
            e.preventDefault();
            e.stopPropagation();

            const targetIdx = parseInt(thumb.dataset.refIdx);
            if (dragSrcIdx === null || targetIdx === dragSrcIdx) return;

            const [moved] = refImages.splice(dragSrcIdx, 1);
            refImages.splice(targetIdx, 0, moved);

            renderRefs();
            saveRefImages();
            showToast('Reordered');
        });
    });
}

// Remove reference image by ID
export function removeRef(id) {
    refImages = refImages.filter(r => r.id !== id);
    renderRefs();
    saveRefImages();
}

// View reference image in fullscreen with navigation
let currentRefIndex = 0;

export function viewRefImage(id) {
    const idx = refImages.findIndex(r => r.id === id);
    if (idx === -1) return;

    currentRefIndex = idx;
    showRefPreview();
}

function showRefPreview() {
    if (refImages.length === 0) return;

    const ref = refImages[currentRefIndex];
    $('refPreviewImg').src = ref.data;
    $('refPreviewCounter').textContent = (currentRefIndex + 1) + ' / ' + refImages.length;
    $('refPreviewModal').classList.add('open');

    // Update arrow visibility
    $('refPrevBtn').style.visibility = currentRefIndex > 0 ? 'visible' : 'hidden';
    $('refNextBtn').style.visibility = currentRefIndex < refImages.length - 1 ? 'visible' : 'hidden';
}

export function prevRefImage() {
    if (currentRefIndex > 0) {
        currentRefIndex--;
        showRefPreview();
    }
}

export function nextRefImage() {
    if (currentRefIndex < refImages.length - 1) {
        currentRefIndex++;
        showRefPreview();
    }
}

export function closeRefPreview() {
    $('refPreviewModal').classList.remove('open');
}

// Setup swipe gestures for reference preview
export function setupRefPreviewSwipe() {
    const modal = $('refPreviewModal');
    if (!modal) return;

    let startX = 0;
    let startY = 0;

    modal.addEventListener('touchstart', e => {
        if (e.touches.length === 1) {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }
    }, { passive: true });

    modal.addEventListener('touchend', e => {
        if (!startX || e.changedTouches.length !== 1) return;

        const deltaX = e.changedTouches[0].clientX - startX;
        const deltaY = Math.abs(e.changedTouches[0].clientY - startY);

        // Horizontal swipe (more horizontal than vertical)
        if (Math.abs(deltaX) > 50 && deltaY < 100) {
            if (deltaX > 0) {
                prevRefImage(); //pe right = previous
            } else {
                nextRefImage(); // Swipe left = next
            }
        }

        startX = 0;
        startY = 0;
    }, { passive: true });

    // Keyboard navigation
    document.addEventListener('keydown', e => {
        if (!$('refPreviewModal').classList.contains('open')) return;

        if (e.key === 'ArrowLeft') prevRefImage();
        else if (e.key === 'ArrowRight') nextRefImage();
        else if (e.key === 'Escape') closeRefPreview();
    });
}

// Clear all reference images with undo
let undoRefsBackup = null;
let undoTimeout = null;

export function clearRefs() {
    if (refImages.length === 0) return;
    undoRefsBackup = [...refImages];
    refImages = [];
    renderRefs();
    saveRefImages();

    $('undoToast').classList.add('show');
    clearTimeout(undoTimeout);
    undoTimeout = setTimeout(() => {
        $('undoToast').classList.remove('show');
        undoRefsBackup = null;
    }, 5000);
}

export function undoClearRefs() {
    if (undoRefsBackup) {
        refImages = undoRefsBackup;
        undoRefsBackup = null;
        renderRefs();
        saveRefImages();
        $('undoToast').classList.remove('show');
        showToast('Restored!');
    }
}

// Setup drag and drop for reference images (file drops from desktop)
export function setupRefDragDrop() {
    const refSection = $('refGrid').parentElement;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        refSection.addEventListener(eventName, e => {
            // Don't interfere with internal reorder drags
            if (dragSrcIdx !== null) return;
            e.preventDefault();
            e.stopPropagation();
        });
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        refSection.addEventListener(eventName, () => {
            if (dragSrcIdx !== null) return;
            refSection.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(eventName => {
        refSection.addEventListener(eventName, () => refSection.classList.remove('dragover'));
    });

    refSection.addEventListener('drop', e => {
        if (dragSrcIdx !== null) return;
        const files = e.dataTransfer.files;
        const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
        if (imageFiles.length > 0) {
            addRefImages(imageFiles);
        }
    });
}

// Setup clipboard paste for reference images
// Context-aware: routes to batch prompt boxes when batch modal is open
export function setupClipboardPaste() {
    document.addEventListener('paste', async e => {
        const items = e.clipboardData?.items;
        if (!items) return;

        const imageFiles = [];
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) imageFiles.push(file);
            }
        }

        if (imageFiles.length === 0) return;
        e.preventDefault();

        // Check if batch setup modal is open — delegate to queueUI
        try {
            const { isBatchModalOpen, pasteRefsToBox } = await import('./queueUI.js');
            if (isBatchModalOpen()) {
                pasteRefsToBox(imageFiles);
                return;
            }
        } catch { /* queueUI not loaded yet, fall through to global */ }

        if (!providerSupports('refs')) {
            showToast('Current provider does not support reference images');
            return;
        }

        // Default: add to global refs
        let addedCount = 0;
        for (const file of imageFiles) {
            if (refImages.length >= MAX_REFS) {
                showToast('Maximum ' + MAX_REFS + ' reference images reached');
                break;
            }
            try {
                const dataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = ev => resolve(ev.target.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
                const compressed = await compressImage(dataUrl);
                refImages.push({ id: Date.now() + Math.random(), data: compressed });
                addedCount++;
            } catch (err) {
                console.error('Error processing pasted image:', err);
            }
        }

        if (addedCount > 0) {
            renderRefs();
            saveRefImages();
            showToast(addedCount + ' image' + (addedCount > 1 ? 's' : '') + ' pasted to references');
        }
    });
}

// Clear refs quietly (for clearAll - no undo toast)
export function clearRefsQuiet() {
    refImages = [];
    renderRefs();
    saveRefImages();
}

// Make functions globally available for HTML onclick handlers
window.addRefImages = addRefImages;
window.removeRef = removeRef;
window.viewRefImage = viewRefImage;
window.clearRefs = clearRefs;
window.undoClearRefs = undoClearRefs;
window.clearRefsQuiet = clearRefsQuiet;
window.prevRefImage = prevRefImage;
window.nextRefImage = nextRefImage;
window.closeRefPreview = closeRefPreview;
