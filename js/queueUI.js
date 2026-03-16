/**
 * Queue UI Module
 * Prompt boxes management, rendering, import/export
 */

import { $, showToast } from './ui.js';
import {
    getQueueState,
    getQueueStats,
    getQueueETA,
    addToQueue,
    setOnProgress,
    setQueueDelay,
    QueueStatus,
    updateQueueItemConfig
} from './queue.js';
import { getCurrentConfig } from './generation.js';
import { getDirectoryInfo, selectOutputDirectory } from './filesystem.js';
import { refImages, compressImage } from './references.js';
import { getSavedPrompts } from './prompts.js';
import { MAX_REFS, DEFAULT_QUEUE_DELAY_MS } from './config.js';

// Prompt boxes state
let promptBoxes = [];
let currentBoxForRefs = null;
let bulkRefMode = false;  // When true, file input adds to selected boxes
let lastFocusedBoxId = null;  // Track last-focused box for clipboard paste
let activeDropTargetId = null;  // Track active drop target for paste/drop

// Multi-select state
let selectedBoxIds = new Set();

// Sticky defaults - remember last prompt box settings for new boxes
let stickyDefaults = {
    variations: 1,
    refImages: null  // null = use global, [...] = custom refs
};

/**
 * Initialize queue UI
 */
export function initQueueUI() {
    // Set up progress callback to update both panel and FAB
    setOnProgress(() => {
        renderQueuePanel();
        updateQueueFab();
    });

    // Initial FAB state
    updateQueueFab();

    // Set up box ref input handler
    const boxRefInput = $('boxRefInput');
    if (boxRefInput) {
        boxRefInput.addEventListener('change', handleBoxRefInput);
    }

    // Initial render
    renderQueuePanel();
    updateDirectoryDisplay();
}

// Drag state
let draggedBoxId = null;

/**
 * Setup drag-drop reordering for prompt boxes
 */
function setupDragReorder() {
    const container = $('promptBoxesContainer');
    if (!container) return;

    container.addEventListener('dragstart', e => {
        const box = e.target.closest('.prompt-box');
        if (box) {
            draggedBoxId = box.dataset.boxId;
            box.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', draggedBoxId);
        }
    });

    container.addEventListener('dragend', e => {
        const box = e.target.closest('.prompt-box');
        if (box) {
            box.classList.remove('dragging');
            draggedBoxId = null;
        }
        // Remove all drop indicators
        container.querySelectorAll('.prompt-box').forEach(b => {
            b.classList.remove('drag-over-top', 'drag-over-bottom');
        });
    });

    container.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const targetBox = e.target.closest('.prompt-box');
        if (!targetBox || targetBox.dataset.boxId === draggedBoxId) return;

        // Determine if dropping above or below
        const rect = targetBox.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const isAbove = e.clientY < midY;

        // Clear previous indicators
        container.querySelectorAll('.prompt-box').forEach(b => {
            b.classList.remove('drag-over-top', 'drag-over-bottom');
        });

        // Add indicator
        targetBox.classList.add(isAbove ? 'drag-over-top' : 'drag-over-bottom');
    });

    container.addEventListener('dragleave', e => {
        const targetBox = e.target.closest('.prompt-box');
        if (targetBox) {
            targetBox.classList.remove('drag-over-top', 'drag-over-bottom');
        }
    });

    container.addEventListener('drop', e => {
        e.preventDefault();
        const targetBox = e.target.closest('.prompt-box');
        if (!targetBox || !draggedBoxId) return;

        const targetId = targetBox.dataset.boxId;
        if (targetId === draggedBoxId) return;

        // Determine drop position
        const rect = targetBox.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const insertBefore = e.clientY < midY;

        // Reorder promptBoxes array
        const draggedIndex = promptBoxes.findIndex(b => b.id === draggedBoxId);
        const targetIndex = promptBoxes.findIndex(b => b.id === targetId);

        if (draggedIndex === -1 || targetIndex === -1) return;

        // Remove dragged item
        const [draggedItem] = promptBoxes.splice(draggedIndex, 1);

        // Calculate new index
        let newIndex = targetIndex;
        if (draggedIndex < targetIndex) {
            newIndex = insertBefore ? targetIndex - 1 : targetIndex;
        } else {
            newIndex = insertBefore ? targetIndex : targetIndex + 1;
        }

        // Insert at new position
        promptBoxes.splice(newIndex, 0, draggedItem);

        // Re-render
        renderPromptBoxes();
        showToast('Reordered');
    });
}

/**
 * Generate unique ID for prompt box
 */
function generateBoxId() {
    return 'pb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Add a new prompt box
 * When called with no explicit variations/refs, uses sticky defaults from last box
 */
export function addPromptBox(prompt = '', variations = null, boxRefImages = undefined) {
    const box = {
        id: generateBoxId(),
        prompt: prompt,
        name: '',
        variations: variations !== null ? variations : stickyDefaults.variations,
        refImages: boxRefImages !== undefined ? boxRefImages :
            (stickyDefaults.refImages ? stickyDefaults.refImages.map(r => ({ ...r, id: Date.now() + Math.random() })) : null)
    };
    promptBoxes.push(box);
    renderPromptBoxes();
    updateTotalCount();

    // Focus the new textarea
    setTimeout(() => {
        const textarea = document.querySelector(`[data-box-id="${box.id}"] .prompt-box-textarea`);
        if (textarea) textarea.focus();
    }, 50);
}

/**
 * Remove a prompt box
 */
export function removePromptBox(id) {
    promptBoxes = promptBoxes.filter(box => box.id !== id);
    renderPromptBoxes();
    updateTotalCount();
}

/**
 * Duplicate a prompt box
 */
export function duplicatePromptBox(id) {
    const source = promptBoxes.find(b => b.id === id);
    if (!source) return;

    const newBox = {
        id: generateBoxId(),
        prompt: source.prompt,
        name: source.name || '',
        variations: source.variations,
        refImages: source.refImages ? source.refImages.map(r => ({ ...r, id: Date.now() + Math.random() })) : null
    };

    // Insert after source box
    const sourceIndex = promptBoxes.indexOf(source);
    promptBoxes.splice(sourceIndex + 1, 0, newBox);

    renderPromptBoxes();
    updateTotalCount();
    showToast('Prompt duplicated');
}

/**
 * Update a prompt box
 */
export function updatePromptBox(id, updates) {
    const box = promptBoxes.find(b => b.id === id);
    if (box) {
        Object.assign(box, updates);
        updateTotalCount();
    }
}

/**
 * Set variations for a prompt box
 */
export function setBoxVariations(id, variations) {
    const v = parseInt(variations) || 1;
    updatePromptBox(id, { variations: v });
    stickyDefaults.variations = v;
    // Re-render just the variation buttons
    const footer = document.querySelector(`[data-box-id="${id}"] .prompt-box-footer`);
    if (footer) {
        const box = promptBoxes.find(b => b.id === id);
        if (box) {
            const btns = footer.querySelectorAll('.variation-btn');
            btns.forEach(btn => {
                btn.classList.toggle('active', parseInt(btn.dataset.val) === box.variations);
            });
        }
    }
}

/**
 * Open file picker for box refs
 */
export function openBoxRefPicker(boxId) {
    currentBoxForRefs = boxId;
    lastFocusedBoxId = boxId;
    const input = $('boxRefInput');
    if (input) {
        input.value = '';
        input.click();
    }
}

/**
 * Handle box ref file input
 */
async function handleBoxRefInput(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Determine which boxes to add refs to
    let targetBoxIds = [];
    if (bulkRefMode && selectedBoxIds.size > 0) {
        targetBoxIds = [...selectedBoxIds];
        bulkRefMode = false;
    } else if (currentBoxForRefs) {
        targetBoxIds = [currentBoxForRefs];
    } else {
        return;
    }

    // Process files first
    const newRefs = [];
    for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        try {
            const dataUrl = await fileToDataUrl(file);
            const compressed = await compressImage(dataUrl);
            newRefs.push({ data: compressed });
        } catch (err) {
            console.error('Error processing file:', err);
        }
    }

    if (newRefs.length === 0) {
        currentBoxForRefs = null;
        return;
    }

    // Add refs to each target box
    for (const boxId of targetBoxIds) {
        const box = promptBoxes.find(b => b.id === boxId);
        if (!box) continue;

        // Initialize refImages array if null
        if (!box.refImages) {
            box.refImages = [];
        }

        for (const ref of newRefs) {
            if (box.refImages.length >= MAX_REFS) {
                break;
            }
            // Each box gets its own copy with unique ID
            box.refImages.push({ id: Date.now() + Math.random(), data: ref.data });
        }
    }

    // Update sticky defaults if single box mode
    if (targetBoxIds.length === 1) {
        const box = promptBoxes.find(b => b.id === targetBoxIds[0]);
        if (box && box.refImages && box.refImages.length > 0) {
            stickyDefaults.refImages = box.refImages.map(r => ({ ...r }));
        }
    }

    renderPromptBoxes();
    currentBoxForRefs = null;

    if (targetBoxIds.length > 1) {
        showToast(`Added ${newRefs.length} ref(s) to ${targetBoxIds.length} prompts`);
    }
}

/**
 * Clear custom refs from a box (revert to global)
 */
export function clearBoxRefs(id) {
    updatePromptBox(id, { refImages: null });
    stickyDefaults.refImages = null;
    renderPromptBoxes();
}

/**
 * Remove a single ref from a box
 */
export function removeBoxRef(boxId, refId) {
    const box = promptBoxes.find(b => b.id === boxId);
    if (box && box.refImages) {
        box.refImages = box.refImages.filter(r => r.id !== refId);
        if (box.refImages.length === 0) {
            box.refImages = null;  // Revert to global
        }
        renderPromptBoxes();
    }
}

/**
 * Toggle box selection for bulk operations
 */
export function toggleBoxSelection(boxId, isSelected) {
    if (isSelected) {
        selectedBoxIds.add(boxId);
    } else {
        selectedBoxIds.delete(boxId);
    }
    renderBulkActionsBar();
    // Update checkbox visually without full re-render
    const checkbox = document.querySelector(`[data-box-id="${boxId}"] .box-select-checkbox`);
    if (checkbox) {
        checkbox.checked = isSelected;
    }
}

/**
 * Select all prompt boxes
 */
export function selectAllBoxes() {
    promptBoxes.forEach(box => selectedBoxIds.add(box.id));
    renderPromptBoxes();
    renderBulkActionsBar();
}

/**
 * Deselect all prompt boxes
 */
export function deselectAllBoxes() {
    selectedBoxIds.clear();
    renderPromptBoxes();
    renderBulkActionsBar();
}

/**
 * Open file picker for bulk ref add (add to all selected boxes)
 */
export function openBulkRefPicker() {
    if (selectedBoxIds.size === 0) {
        showToast('Select prompts first');
        return;
    }
    bulkRefMode = true;
    const input = $('boxRefInput');
    if (input) {
        input.value = '';
        input.click();
    }
}

/**
 * Render bulk actions bar
 */
function renderBulkActionsBar() {
    const container = $('bulkActionsBar');
    if (!container) return;

    const count = selectedBoxIds.size;
    if (count === 0) {
        container.classList.remove('visible');
        return;
    }

    container.classList.add('visible');
    container.innerHTML = `
        <span class="bulk-selection-count">${count} selected</span>
        <button class="btn-secondary btn-sm" onclick="openBulkRefPicker()">Add Refs to Selected</button>
        <button class="btn-secondary btn-sm" onclick="clearSelectedBoxRefs()">Clear Refs from Selected</button>
        <button class="btn-secondary btn-sm" onclick="deselectAllBoxes()">Deselect All</button>
    `;
}

/**
 * Clear refs from all selected boxes
 */
export function clearSelectedBoxRefs() {
    selectedBoxIds.forEach(id => {
        updatePromptBox(id, { refImages: null });
    });
    renderPromptBoxes();
    showToast(`Cleared refs from ${selectedBoxIds.size} prompts`);
}

/**
 * Close all saved prompt pickers
 */
function closeAllSavedPromptPickers() {
    document.querySelectorAll('.saved-prompt-picker').forEach(el => el.remove());
}

/**
 * Open a saved prompt picker dropdown anchored to a specific prompt box
 */
export function openBoxSavedPromptPicker(boxId) {
    closeAllSavedPromptPickers();

    const prompts = getSavedPrompts();
    const boxEl = document.querySelector(`[data-box-id="${boxId}"]`);
    if (!boxEl) return;

    const picker = document.createElement('div');
    picker.className = 'saved-prompt-picker';

    if (prompts.length === 0) {
        picker.innerHTML = '<div class="dropdown-empty">No saved prompts</div>';
    } else {
        picker.innerHTML = prompts.map(p => {
            const displayName = escapeHtml(p.name || p.text.slice(0, 50));
            const subtitle = escapeHtml(p.text.length > 60 ? p.text.slice(0, 60) + '...' : p.text);
            return `<div class="dropdown-item" onclick="fillBoxFromSaved('${boxId}', '${p.id}')">
                <div class="dropdown-item-content">
                    <span class="dropdown-item-name">${displayName}</span>
                    ${p.name ? `<span class="dropdown-item-subtitle">${subtitle}</span>` : ''}
                </div>
            </div>`;
        }).join('');
    }

    const header = boxEl.querySelector('.prompt-box-header');
    header.style.position = 'relative';
    header.appendChild(picker);

    // Close on outside click
    setTimeout(() => {
        const handler = (e) => {
            if (!e.target.closest('.saved-prompt-picker') && !e.target.closest('[onclick*="openBoxSavedPromptPicker"]')) {
                closeAllSavedPromptPickers();
                document.removeEventListener('click', handler);
            }
        };
        document.addEventListener('click', handler);
    }, 0);
}

/**
 * Fill a prompt box's textarea and name from a saved prompt
 */
export function fillBoxFromSaved(boxId, promptId) {
    const prompts = getSavedPrompts();
    const saved = prompts.find(p => p.id === promptId);
    if (!saved) return;

    const box = promptBoxes.find(b => b.id === boxId);
    if (!box) return;

    box.prompt = saved.text;
    if (!box.name) box.name = saved.name || '';

    // Update DOM directly to preserve scroll position
    const boxEl = document.querySelector(`[data-box-id="${boxId}"]`);
    if (boxEl) {
        const textarea = boxEl.querySelector('.prompt-box-textarea');
        const nameInput = boxEl.querySelector('.prompt-box-name');
        if (textarea) textarea.value = saved.text;
        if (nameInput && !nameInput.value) nameInput.value = saved.name || '';
    }

    closeAllSavedPromptPickers();
    updateTotalCount();
    showToast('Prompt loaded');
}

/**
 * Open a multi-select overlay to create new boxes from saved prompts
 */
export function openBulkSavedPromptPicker() {
    const prompts = getSavedPrompts();

    if (prompts.length === 0) {
        showToast('No saved prompts');
        return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'saved-prompt-bulk-overlay';
    overlay.id = 'savedPromptBulkOverlay';

    overlay.innerHTML = `
        <div class="saved-prompt-bulk-picker">
            <div class="saved-prompt-bulk-header">
                <h4>Add from Saved Prompts</h4>
                <button class="close-btn" onclick="closeBulkSavedPromptPicker()">&times;</button>
            </div>
            <div class="saved-prompt-bulk-list">
                ${prompts.map(p => {
                    const displayName = escapeHtml(p.name || p.text.slice(0, 50));
                    const subtitle = escapeHtml(p.text.length > 80 ? p.text.slice(0, 80) + '...' : p.text);
                    return `<label class="saved-prompt-bulk-item">
                        <input type="checkbox" class="bulk-saved-checkbox" value="${p.id}">
                        <div class="dropdown-item-content">
                            <span class="dropdown-item-name">${displayName}</span>
                            <span class="dropdown-item-subtitle">${subtitle}</span>
                        </div>
                    </label>`;
                }).join('')}
            </div>
            <div class="saved-prompt-bulk-footer">
                <span class="saved-prompt-bulk-count">0 selected</span>
                <div style="display:flex;gap:8px;">
                    <button class="btn-secondary btn-sm" onclick="closeBulkSavedPromptPicker()">Cancel</button>
                    <button class="btn-primary btn-sm" onclick="confirmBulkSavedPrompts()">Add Selected</button>
                </div>
            </div>
        </div>
    `;

    const modalContent = document.querySelector('#queueSetupModal .queue-modal-content');
    modalContent.appendChild(overlay);

    // Wire up checkbox change to update count
    overlay.querySelectorAll('.bulk-saved-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            const count = overlay.querySelectorAll('.bulk-saved-checkbox:checked').length;
            overlay.querySelector('.saved-prompt-bulk-count').textContent = `${count} selected`;
        });
    });
}

/**
 * Confirm bulk saved prompt selection and create new boxes
 */
export function confirmBulkSavedPrompts() {
    const overlay = document.getElementById('savedPromptBulkOverlay');
    if (!overlay) return;

    const prompts = getSavedPrompts();
    const checkedIds = Array.from(overlay.querySelectorAll('.bulk-saved-checkbox:checked')).map(cb => cb.value);

    if (checkedIds.length === 0) {
        showToast('Select at least one prompt');
        return;
    }

    for (const id of checkedIds) {
        const saved = prompts.find(p => p.id === id);
        if (!saved) continue;

        promptBoxes.push({
            id: generateBoxId(),
            prompt: saved.text,
            name: saved.name || '',
            variations: stickyDefaults.variations,
            refImages: stickyDefaults.refImages ? stickyDefaults.refImages.map(r => ({ ...r, id: Date.now() + Math.random() })) : null
        });
    }

    renderPromptBoxes();
    updateTotalCount();
    closeBulkSavedPromptPicker();
    showToast(`Added ${checkedIds.length} prompt${checkedIds.length !== 1 ? 's' : ''}`);
}

/**
 * Close the bulk saved prompt picker overlay
 */
export function closeBulkSavedPromptPicker() {
    const overlay = document.getElementById('savedPromptBulkOverlay');
    if (overlay) overlay.remove();
}

/**
 * Update total count display
 */
function updateTotalCount() {
    const promptCount = promptBoxes.filter(b => b.prompt.trim().length > 0).length;
    const totalImages = promptBoxes.reduce((sum, box) => {
        return sum + (box.prompt.trim().length > 0 ? box.variations : 0);
    }, 0);

    const promptCountEl = $('promptBoxCount');
    const totalImagesEl = $('totalImagesCount');
    const startBtn = $('startQueueBtn');

    if (promptCountEl) promptCountEl.textContent = promptCount;
    if (totalImagesEl) totalImagesEl.textContent = totalImages;

    if (startBtn) {
        startBtn.disabled = promptCount === 0;
        startBtn.textContent = promptCount > 0 ? `Start Batch (${totalImages})` : 'Start Batch';
    }
}

/**
 * Render all prompt boxes
 */
function renderPromptBoxes() {
    const container = $('promptBoxesContainer');
    if (!container) return;

    if (promptBoxes.length === 0) {
        container.innerHTML = '';
        renderBulkActionsBar();
        return;
    }

    const needsDragSetup = !container.dataset.dragSetup;

    container.innerHTML = promptBoxes.map((box, index) => {
        const hasCustomRefs = box.refImages && box.refImages.length > 0;
        const isSelected = selectedBoxIds.has(box.id);
        const isPasteTarget = activeDropTargetId === box.id;

        return `
            <div class="prompt-box ${isSelected ? 'selected' : ''}" data-box-id="${box.id}" draggable="true">
                <div class="prompt-box-header">
                    <div class="prompt-box-drag-handle" title="Drag to reorder">⋮⋮</div>
                    <label class="box-select-label">
                        <input type="checkbox" class="box-select-checkbox"
                            ${isSelected ? 'checked' : ''}
                            onchange="toggleBoxSelection('${box.id}', this.checked)">
                        <span class="prompt-box-title">Prompt ${index + 1}</span>
                    </label>
                    <div class="prompt-box-header-actions">
                        <button class="prompt-box-action" onclick="openBoxSavedPromptPicker('${box.id}')" title="Load saved prompt">&#x1F516;</button>
                        <button class="prompt-box-action" onclick="duplicatePromptBox('${box.id}')" title="Duplicate">⧉</button>
                        <button class="prompt-box-remove" onclick="removePromptBox('${box.id}')" title="Remove">×</button>
                    </div>
                </div>
                <div class="prompt-box-body">
                    <input type="text" class="prompt-box-name"
                        placeholder="Filename label (optional)"
                        value="${escapeHtml(box.name || '')}"
                        maxlength="50"
                        oninput="updateBoxName('${box.id}', this.value)">
                    <textarea class="prompt-box-textarea"
                        placeholder="Enter your prompt..."
                        onfocus="setActiveDropTarget('${box.id}')"
                        oninput="updateBoxPrompt('${box.id}', this.value)">${escapeHtml(box.prompt)}</textarea>
                    <div class="box-drop-zone ${isPasteTarget ? 'paste-target' : ''}" data-box-id="${box.id}">
                        ${hasCustomRefs ? `
                            ${box.refImages.map(ref => `
                                <div class="box-drop-zone-ref">
                                    <img src="${ref.data}" title="Reference image">
                                    <button class="box-ref-remove" onclick="event.stopPropagation(); removeBoxRef('${box.id}', ${ref.id})" title="Remove">&times;</button>
                                </div>
                            `).join('')}
                            ${box.refImages.length < MAX_REFS ? `<button class="box-drop-zone-add" onclick="event.stopPropagation(); openBoxRefPicker('${box.id}')" title="Add more">+</button>` : ''}
                            <button class="box-drop-zone-clear" onclick="event.stopPropagation(); clearBoxRefs('${box.id}')" title="Clear all refs">Clear</button>
                        ` : `
                            <span class="box-drop-zone-placeholder">Drop, paste, or click to add reference images</span>
                        `}
                    </div>
                </div>
                <div class="prompt-box-footer">
                    <div class="prompt-box-variations">
                        <label>Variations:</label>
                        <div class="variation-btns">
                            ${[1, 2, 3, 4, 5].map(v => `
                                <button class="variation-btn ${box.variations === v ? 'active' : ''}"
                                    data-val="${v}"
                                    onclick="setBoxVariations('${box.id}', ${v})">${v}</button>
                            `).join('')}
                        </div>
                    </div>
                    ${!hasCustomRefs ? `<span class="prompt-box-refs-info">Using global refs if enabled</span>` : ''}
                </div>
            </div>
        `;
    }).join('');

    renderBulkActionsBar();

    // Setup drag reorder if not already done
    if (needsDragSetup) {
        setupDragReorder();
        container.dataset.dragSetup = 'true';
    }

    // Setup drop zones for ref images (must run after every render since zones are recreated)
    setupBoxDropZones();
}

/**
 * Update box prompt from textarea
 */
export function updateBoxPrompt(id, value) {
    const box = promptBoxes.find(b => b.id === id);
    if (box) {
        box.prompt = value;
        updateTotalCount();
    }
}

/**
 * Update box name from input
 */
export function updateBoxName(id, value) {
    const box = promptBoxes.find(b => b.id === id);
    if (box) {
        box.name = value;
    }
}

/**
 * Open queue setup modal
 */
export function openQueueSetup() {
    const modal = $('queueSetupModal');
    if (modal) {
        modal.classList.add('open');

        // Add one empty box if none exist
        if (promptBoxes.length === 0) {
            addPromptBox();
        } else {
            renderPromptBoxes();
        }

        // Update global refs display
        const globalRefsInfo = $('globalRefsInfo');
        const useGlobalRefs = $('useGlobalRefs');
        if (globalRefsInfo && useGlobalRefs) {
            const hasRefs = refImages.length > 0;
            globalRefsInfo.textContent = hasRefs ? `(${refImages.length} images)` : '(none)';
            useGlobalRefs.disabled = !hasRefs;
            useGlobalRefs.checked = hasRefs;
        }

        updateDirectoryDisplay();
        updateTotalCount();
    }
}

/**
 * Close queue setup modal
 */
export function closeQueueSetup() {
    const modal = $('queueSetupModal');
    if (modal) {
        modal.classList.remove('open');
    }
    // Reset sticky defaults and selection when closing modal
    stickyDefaults = { variations: 1, refImages: null };
    selectedBoxIds.clear();
    activeDropTargetId = null;
    // Clear batch name input
    const batchNameInput = $('batchNameInput');
    if (batchNameInput) {
        batchNameInput.value = '';
    }
}

/**
 * Confirm and start queue from modal
 */
export function confirmAndStartQueue() {
    const delaySelect = $('queueDelaySelect');
    const useGlobalRefs = $('useGlobalRefs');
    const batchNameInput = $('batchNameInput');

    // Filter to only boxes with prompts
    const validBoxes = promptBoxes.filter(box => box.prompt.trim().length > 0);

    if (validBoxes.length === 0) {
        showToast('Enter at least one prompt');
        return;
    }

    const delayMs = parseInt(delaySelect?.value) || DEFAULT_QUEUE_DELAY_MS;
    const shouldUseGlobalRefs = useGlobalRefs?.checked && refImages.length > 0;
    const batchName = batchNameInput?.value?.trim() || '';

    console.log(`[QueueUI] Starting batch: ${validBoxes.length} prompts, globalRefs: ${shouldUseGlobalRefs}, global ref count: ${refImages.length}, batchName: "${batchName}"`);

    // Get current config from main page
    const config = getCurrentConfig();

    // Set delay
    setQueueDelay(delayMs);

    // Add each box to queue
    for (const box of validBoxes) {
        // Determine which refs to use
        let boxRefs = [];
        if (box.refImages && box.refImages.length > 0) {
            boxRefs = [...box.refImages];
            console.log(`[QueueUI] Box "${box.prompt.slice(0, 20)}..." has ${box.refImages.length} custom refs`);
        } else if (shouldUseGlobalRefs) {
            boxRefs = [...refImages];
            console.log(`[QueueUI] Box "${box.prompt.slice(0, 20)}..." using ${refImages.length} global refs`);
        } else {
            console.log(`[QueueUI] Box "${box.prompt.slice(0, 20)}..." has NO refs`);
        }

        // Add to queue with batch name and per-prompt name
        addToQueue([box.prompt], box.variations, config, boxRefs, batchName, [box.name || '']);
    }

    // Close modal
    closeQueueSetup();

    // Clear prompt boxes for next time
    promptBoxes = [];

    // Open queue panel
    toggleQueuePanel(true);

    // Auto-start
    import('./queue.js').then(m => m.startQueue());
}

/**
 * Toggle queue panel visibility
 */
export function toggleQueuePanel(forceOpen = null) {
    const panel = $('queuePanel');
    const overlay = $('queueOverlay');
    const fab = $('queueFab');

    if (!panel) return;

    const shouldOpen = forceOpen !== null ? forceOpen : !panel.classList.contains('open');

    panel.classList.toggle('open', shouldOpen);
    if (overlay) {
        overlay.classList.toggle('open', shouldOpen);
    }

    // Hide FAB when panel is open to avoid overlap
    if (fab) {
        fab.classList.toggle('hidden', shouldOpen);
    }

    if (shouldOpen) {
        renderQueuePanel();
    }
}

/**
 * Render queue panel content
 */
export function renderQueuePanel() {
    const state = getQueueState();
    const stats = getQueueStats();
    const eta = getQueueETA();

    // Update progress bar
    const progressBar = $('queueProgressBar');
    if (progressBar) {
        progressBar.style.width = stats.percentComplete + '%';
    }

    // Update progress text
    const progressText = $('queueProgressText');
    if (progressText) {
        if (stats.total === 0) {
            progressText.textContent = 'No items';
        } else {
            let text = `${stats.completed}/${stats.total} completed`;
            if (stats.failed > 0) {
                text += ` • ${stats.failed} failed`;
            }
            // Add ETA if queue is running and has pending items
            if (state.isRunning && !state.isPaused && eta.totalMs > 0) {
                text += ` • ${eta.formatted} remaining`;
            }
            progressText.textContent = text;
        }
    }

    // Update status
    const statusEl = $('queueStatus');
    if (statusEl) {
        const currentItem = state.items.find(i => i.status === QueueStatus.GENERATING);

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

    // Update control buttons
    const startBtn = $('queueStartBtn');
    const pauseBtn = $('queuePauseBtn');
    const resumeBtn = $('queueResumeBtn');
    const cancelBtn = $('queueCancelBtn');

    if (startBtn) startBtn.classList.toggle('hidden', state.isRunning);
    if (pauseBtn) pauseBtn.classList.toggle('hidden', !state.isRunning || state.isPaused);
    if (resumeBtn) resumeBtn.classList.toggle('hidden', !state.isPaused);
    if (cancelBtn) cancelBtn.disabled = !state.isRunning && stats.total === 0;

    // Show "Edit Settings" button only when paused with pending items
    const editSettingsBtn = $('queueEditSettingsBtn');
    if (editSettingsBtn) {
        editSettingsBtn.classList.toggle('hidden', !(state.isPaused && stats.pending > 0));
    }

    // Hide settings panel if queue is no longer paused
    if (!state.isPaused) {
        const settingsPanel = $('queueSettingsOverride');
        if (settingsPanel) settingsPanel.classList.add('hidden');
    }

    // Render item list
    renderQueueItemList(state.items);
}

/**
 * Render queue item list
 */
function renderQueueItemList(items) {
    const list = $('queueItemList');
    if (!list) return;

    if (items.length === 0) {
        list.innerHTML = '<div class="queue-empty">No items in queue</div>';
        return;
    }

    list.innerHTML = items.map(item => `
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
                ${item.status === 'pending' ? `
                    <button class="queue-item-btn skip-btn" onclick="skipQueueItem('${item.id}')" title="Skip this item">Skip</button>
                    <button class="queue-item-remove" onclick="removeQueueItem('${item.id}')" title="Remove from queue">×</button>
                ` : ''}
                ${item.status === 'failed' || item.status === 'cancelled' ? `
                    <button class="queue-item-btn retry-btn" onclick="retryQueueItem('${item.id}')" title="Retry this item">Retry</button>
                ` : ''}
            </div>
        </div>
    `).join('');
}

/**
 * Get status icon for queue item
 */
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
 * Update directory display in UI
 */
export function updateDirectoryDisplay() {
    const dirInfo = getDirectoryInfo();

    // Update main folder indicator
    const nameEl = $('outputDirName');
    const statusEl = $('outputDirStatus');
    const clearBtn = $('clearDirBtn');
    const selectBtn = $('selectDirBtn');

    if (nameEl) {
        nameEl.textContent = dirInfo.name || 'Not set';
        nameEl.classList.toggle('selected', dirInfo.isSet);
    }

    if (statusEl) {
        statusEl.classList.toggle('active', dirInfo.isSet);
    }

    if (clearBtn) {
        clearBtn.classList.toggle('hidden', !dirInfo.isSet);
    }

    if (selectBtn) {
        selectBtn.textContent = dirInfo.isSet ? 'Change' : 'Select Folder';
    }

    // Update modal folder display
    const modalDirName = $('queueDirName');
    if (modalDirName) {
        modalDirName.textContent = dirInfo.isSet ? dirInfo.name : 'Not set';
        modalDirName.classList.toggle('selected', dirInfo.isSet);
    }
}

/**
 * Select output directory (wrapper)
 */
export async function selectQueueOutputDir() {
    await selectOutputDirectory();
    updateDirectoryDisplay();
}

/**
 * Import batch from folder (expects batch.json + refs/ subfolder)
 * This is the folder-based import for structured batch folders
 */
export async function importBatchFolder() {
    try {
        const dirHandle = await window.showDirectoryPicker();

        // Look for batch.json
        let jsonHandle;
        try {
            jsonHandle = await dirHandle.getFileHandle('batch.json');
        } catch {
            showToast('No batch.json found in folder');
            return;
        }

        const jsonFile = await jsonHandle.getFile();
        await processBatchJson(jsonFile, dirHandle);

    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('Import error:', err);
            showToast('Import failed: ' + err.message);
        }
    }
}

/**
 * Import batch from JSON file directly (prompts only, no refs from file paths)
 * This is the file-based import for simple JSON files
 */
export async function importBatchFile() {
    try {
        const [fileHandle] = await window.showOpenFilePicker({
            types: [{
                description: 'JSON Files',
                accept: { 'application/json': ['.json'] }
            }],
            multiple: false
        });

        const file = await fileHandle.getFile();
        await processBatchJson(file, null);

    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('Import error:', err);
            showToast('Import failed: ' + err.message);
        }
    }
}

/**
 * Attempt to repair common JSON syntax errors
 * @param {string} jsonText - The malformed JSON string
 * @returns {string} - Repaired JSON string
 */
function repairJson(jsonText) {
    let repaired = jsonText;
    let fixes = [];

    // Fix 1: Remove trailing commas before ] or }
    // e.g., {"a": 1,} or [1, 2,]
    const trailingCommaRegex = /,(\s*[}\]])/g;
    if (trailingCommaRegex.test(repaired)) {
        repaired = repaired.replace(trailingCommaRegex, '$1');
        fixes.push('trailing commas');
    }

    // Fix 2: Remove stray ] or } that don't belong
    // Common: "variations": 3 ] } should be "variations": 3 }
    // Look for pattern: number/string/true/false/null followed by ] then , or }
    const strayBracketRegex = /(\d+|"[^"]*"|true|false|null)\s*\]\s*([,}])/g;
    if (strayBracketRegex.test(repaired)) {
        repaired = repaired.replace(strayBracketRegex, '$1$2');
        fixes.push('stray brackets');
    }

    // Fix 3: Add missing commas between objects in array
    // e.g., } { should be }, {
    const missingCommaRegex = /}\s*{/g;
    if (missingCommaRegex.test(repaired)) {
        repaired = repaired.replace(missingCommaRegex, '}, {');
        fixes.push('missing commas between objects');
    }

    // Fix 4: Single quotes to double quotes (common mistake)
    // Only for keys and simple string values, not inside existing strings
    const singleQuoteKeyRegex = /'([^']+)'(\s*:)/g;
    if (singleQuoteKeyRegex.test(repaired)) {
        repaired = repaired.replace(singleQuoteKeyRegex, '"$1"$2');
        fixes.push('single-quoted keys');
    }

    // Fix 5: Unquoted keys (JavaScript style)
    // e.g., { prompt: "text" } should be { "prompt": "text" }
    const unquotedKeyRegex = /([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g;
    if (unquotedKeyRegex.test(repaired)) {
        repaired = repaired.replace(unquotedKeyRegex, '$1"$2"$3');
        fixes.push('unquoted keys');
    }

    // Fix 6: Missing closing bracket/brace at end
    // Count brackets and add missing ones
    const openBraces = (repaired.match(/{/g) || []).length;
    const closeBraces = (repaired.match(/}/g) || []).length;
    const openBrackets = (repaired.match(/\[/g) || []).length;
    const closeBrackets = (repaired.match(/]/g) || []).length;

    if (openBraces > closeBraces) {
        repaired = repaired.trimEnd() + '}'.repeat(openBraces - closeBraces);
        fixes.push('missing closing braces');
    }
    if (openBrackets > closeBrackets) {
        // Insert before final }
        const lastBrace = repaired.lastIndexOf('}');
        if (lastBrace > 0) {
            repaired = repaired.slice(0, lastBrace) + ']'.repeat(openBrackets - closeBrackets) + repaired.slice(lastBrace);
        } else {
            repaired = repaired + ']'.repeat(openBrackets - closeBrackets);
        }
        fixes.push('missing closing brackets');
    }

    if (fixes.length > 0) {
        console.log('[JSON Repair] Applied fixes:', fixes.join(', '));
    }

    return repaired;
}

/**
 * Process batch JSON file
 * @param {File} jsonFile - The JSON file to process
 * @param {FileSystemDirectoryHandle|null} dirHandle - Optional directory handle for loading refs
 */
async function processBatchJson(jsonFile, dirHandle) {
    const jsonText = await jsonFile.text();

    let batch;
    try {
        batch = JSON.parse(jsonText);
    } catch (parseError) {
        // Try to repair common JSON errors
        console.log('[JSON Repair] Initial parse failed, attempting repair...');
        console.log('[JSON Repair] Error was:', parseError.message);

        try {
            const repairedJson = repairJson(jsonText);
            batch = JSON.parse(repairedJson);
            showToast('JSON repaired and imported');
        } catch (repairError) {
            console.error('[JSON Repair] Repair failed:', repairError);
            showToast('Invalid JSON: ' + parseError.message);
            return;
        }
    }

    if (!batch.prompts || !Array.isArray(batch.prompts)) {
        showToast('Invalid batch.json format');
        return;
    }

    // Clear existing prompt boxes
    promptBoxes = [];

    // Process each prompt
    for (const item of batch.prompts) {
        if (!item.prompt) continue;

        const box = {
            id: generateBoxId(),
            prompt: item.prompt,
            name: item.name || '',
            variations: item.variations || 1,
            refImages: null
        };

        // Load refs if specified AND we have a directory handle
        if (item.refs && Array.isArray(item.refs) && item.refs.length > 0 && dirHandle) {
            box.refImages = [];
            for (const refPath of item.refs) {
                try {
                    // Handle nested paths (e.g., "refs/image.png")
                    const pathParts = refPath.split('/');
                    let fileHandle = dirHandle;

                    for (let i = 0; i < pathParts.length - 1; i++) {
                        fileHandle = await fileHandle.getDirectoryHandle(pathParts[i]);
                    }
                    fileHandle = await fileHandle.getFileHandle(pathParts[pathParts.length - 1]);

                    const file = await fileHandle.getFile();
                    const dataUrl = await fileToDataUrl(file);
                    const compressed = await compressImage(dataUrl);
                    box.refImages.push({ id: Date.now() + Math.random(), data: compressed });
                } catch (err) {
                    console.warn('Could not load ref:', refPath, err);
                }
            }
            if (box.refImages.length === 0) {
                box.refImages = null;
            }
        }

        promptBoxes.push(box);
    }

    // Set delay if specified
    if (batch.delay && $('queueDelaySelect')) {
        $('queueDelaySelect').value = batch.delay.toString();
    }

    renderPromptBoxes();
    updateTotalCount();

    const totalImages = promptBoxes.reduce((sum, b) => sum + b.variations, 0);
    const refsNote = dirHandle ? '' : ' (refs ignored - use Import Folder for refs)';
    showToast(`Imported ${promptBoxes.length} prompts (${totalImages} images)${refsNote}`);
}

/**
 * Export current prompt boxes to JSON
 */
export async function exportBatchJson() {
    if (promptBoxes.length === 0) {
        showToast('No prompts to export');
        return;
    }

    const batch = {
        delay: parseInt($('queueDelaySelect')?.value) || DEFAULT_QUEUE_DELAY_MS,
        prompts: promptBoxes.map(box => {
            const item = {
                prompt: box.prompt,
                variations: box.variations
            };
            if (box.name && box.name.trim()) {
                item.name = box.name.trim();
            }
            // Note: We don't export ref image data, just indicate if custom refs were set
            if (box.refImages && box.refImages.length > 0) {
                item.refs = box.refImages.map((_, i) => `refs/prompt_${box.id}_ref_${i}.png`);
            }
            return item;
        })
    };

    const jsonStr = JSON.stringify(batch, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'batch.json';
    a.click();

    URL.revokeObjectURL(url);
    showToast('Exported batch.json');
}

/**
 * Export completed queue items with prompt data
 */
export function exportQueueResults() {
    const state = getQueueState();
    const completedItems = state.items.filter(i => i.status === QueueStatus.COMPLETED);
    const failedItems = state.items.filter(i => i.status === QueueStatus.FAILED || i.status === QueueStatus.CANCELLED);

    if (completedItems.length === 0 && failedItems.length === 0) {
        showToast('No results to export');
        return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    // Export successful items
    if (completedItems.length > 0) {
        const successReport = {
            exportedAt: new Date().toISOString(),
            batchName: completedItems[0]?.batchName || '',
            totalItems: completedItems.length,
            items: completedItems.map(item => ({
                prompt: item.prompt,
                filename: item.filename,
                model: item.config?.model,
                config: {
                    ratio: item.config?.ratio,
                    resolution: item.config?.resolution,
                    thinkingBudget: item.config?.thinkingBudget
                },
                generationTimeMs: item.completedAt - item.startedAt,
                completedAt: new Date(item.completedAt).toISOString()
            }))
        };

        downloadJson(successReport, `batch_success_${timestamp}.json`);
    }

    // Export failed items
    if (failedItems.length > 0) {
        const failedReport = {
            exportedAt: new Date().toISOString(),
            batchName: failedItems[0]?.batchName || '',
            failedItems: failedItems.length,
            items: failedItems.map(item => ({
                prompt: item.prompt,
                error: item.error,
                model: item.config?.model,
                config: {
                    ratio: item.config?.ratio,
                    resolution: item.config?.resolution,
                    thinkingBudget: item.config?.thinkingBudget
                },
                attemptedAt: item.startedAt ? new Date(item.startedAt).toISOString() : null
            })),
            _instructions: 'To retry these prompts, import this file using "Import File" in Batch Setup',
            // Include prompts array for direct re-import
            prompts: failedItems.map(item => ({
                prompt: item.prompt,
                variations: 1
            }))
        };

        downloadJson(failedReport, `batch_failed_${timestamp}.json`);
    }

    const msg = [];
    if (completedItems.length > 0) msg.push(`${completedItems.length} success`);
    if (failedItems.length > 0) msg.push(`${failedItems.length} failed`);
    showToast(`Exported: ${msg.join(', ')}`);
}

/**
 * Helper to download JSON file
 */
function downloadJson(data, filename) {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Convert File to data URL
 */
function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * Escape HTML for safe rendering
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Download a sample batch.json template
 */
export function downloadBatchTemplate() {
    const template = {
        _comment: 'Batch import template for NBPI',
        _instructions: 'Place this file in a folder with a refs/ subfolder containing your reference images',
        delay: 3000,
        prompts: [
            {
                prompt: 'Your first prompt goes here...',
                name: 'elf-archer',
                variations: 2,
                refs: ['refs/example1.png', 'refs/example2.png']
            },
            {
                prompt: 'Second prompt (no custom refs - uses global)',
                variations: 1
            }
        ]
    };

    const jsonStr = JSON.stringify(template, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'batch-template.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Template downloaded');
}

/**
 * Smart batch button handler - opens progress panel if queue active, setup modal if idle
 */
export function handleBatchButtonClick() {
    const state = getQueueState();
    const hasItems = state.items && state.items.length > 0;
    const isActive = state.isRunning || hasItems;

    if (isActive) {
        toggleQueuePanel(true);
    } else {
        openQueueSetup();
    }
}

/**
 * Update the floating queue indicator (FAB)
 */
export function updateQueueFab() {
    const fab = $('queueFab');
    const fabText = $('queueFabText');
    const fabProgress = $('queueFabProgress');

    if (!fab) return;

    const state = getQueueState();
    const stats = getQueueStats();

    // Show/hide FAB based on queue state
    const shouldShow = state.isRunning || stats.total > 0;
    fab.classList.toggle('hidden', !shouldShow);

    if (!shouldShow) return;

    // Determine if queue just finished (not running, nothing pending/generating)
    const isComplete = !state.isRunning && !state.isPaused && stats.pending === 0 && stats.inProgress === 0;

    // Update text — show checkmark when done, counter when active
    if (fabText) {
        fabText.textContent = isComplete ? '✓' : `${stats.completed}/${stats.total}`;
    }

    // Update progress bar
    if (fabProgress) {
        fabProgress.style.height = stats.percentComplete + '%';
    }

    // Add/remove generating animation
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

    // Populate from first pending item's config when opening
    if (isHidden) {
        const state = getQueueState();
        const firstPending = state.items.find(i => i.status === QueueStatus.PENDING);
        if (firstPending && firstPending.config) {
            const c = firstPending.config;
            const qRatio = $('queueRatio');
            const qRes = $('queueResolution');
            const qThinking = $('queueThinking');
            const qSearch = $('queueSearch');

            if (qRatio) qRatio.value = c.ratio || '';
            if (qRes) qRes.value = c.resolution || '2K';
            if (qThinking) {
                // Find closest option
                const budget = c.thinkingBudget !== undefined ? c.thinkingBudget : -1;
                const options = Array.from(qThinking.options).map(o => parseInt(o.value));
                const closest = options.reduce((prev, curr) =>
                    Math.abs(curr - budget) < Math.abs(prev - budget) ? curr : prev
                );
                qThinking.value = closest.toString();
            }
            if (qSearch) qSearch.checked = !!c.searchEnabled;

            // Reset safety dropdowns to "Keep" (don't override unless user explicitly picks)
            ['queueSafetyHarassment', 'queueSafetyHate', 'queueSafetySexual', 'queueSafetyDangerous'].forEach(id => {
                const el = $(id);
                if (el) el.value = '';
            });
        }
    }
}

/**
 * Apply settings from the override panel to all pending queue items
 */
export function applySettingsToRemaining() {
    const newConfig = {};

    const qRatio = $('queueRatio');
    const qRes = $('queueResolution');
    const qThinking = $('queueThinking');
    const qSearch = $('queueSearch');

    if (qRatio) newConfig.ratio = qRatio.value;
    if (qRes) newConfig.resolution = qRes.value;
    if (qThinking) newConfig.thinkingBudget = parseInt(qThinking.value);
    if (qSearch) newConfig.searchEnabled = qSearch.checked;

    // Build safety settings — only include categories the user explicitly changed
    const safetyMap = [
        { id: 'queueSafetyHarassment', category: 'HARM_CATEGORY_HARASSMENT' },
        { id: 'queueSafetyHate', category: 'HARM_CATEGORY_HATE_SPEECH' },
        { id: 'queueSafetySexual', category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT' },
        { id: 'queueSafetyDangerous', category: 'HARM_CATEGORY_DANGEROUS_CONTENT' }
    ];

    const safetyOverrides = [];
    safetyMap.forEach(({ id, category }) => {
        const el = $(id);
        if (el && el.value) {
            safetyOverrides.push({ category, threshold: el.value });
        }
    });

    // If any safety overrides were set, merge them with existing settings
    if (safetyOverrides.length > 0) {
        // We need to handle this per-item since each might have different existing safety
        // For simplicity, just set the full array (user can set all 4 if they want granular control)
        const state = getQueueState();
        const firstPending = state.items.find(i => i.status === QueueStatus.PENDING);
        const existingSafety = firstPending?.config?.safetySettings || [];

        // Merge: override categories that user changed, keep others
        const mergedSafety = [...existingSafety];
        safetyOverrides.forEach(override => {
            const idx = mergedSafety.findIndex(s => s.category === override.category);
            if (idx >= 0) {
                mergedSafety[idx] = override;
            } else {
                mergedSafety.push(override);
            }
        });
        newConfig.safetySettings = mergedSafety;
    }

    const count = updateQueueItemConfig(newConfig);

    // Hide the settings panel
    const panel = $('queueSettingsOverride');
    if (panel) panel.classList.add('hidden');

    showToast(`Settings applied to ${count} remaining item${count !== 1 ? 's' : ''}`);
}

/**
 * Set the last-focused prompt box (called from textarea onfocus)
 */
export function setLastFocusedBox(boxId) {
    lastFocusedBoxId = boxId;
}

/**
 * Set the active drop target (for paste routing + visual indicator)
 */
export function setActiveDropTarget(boxId) {
    lastFocusedBoxId = boxId;
    if (activeDropTargetId === boxId) return;

    // Remove previous indicator
    if (activeDropTargetId) {
        const prevZone = document.querySelector(`.box-drop-zone[data-box-id="${activeDropTargetId}"]`);
        if (prevZone) prevZone.classList.remove('paste-target');
    }

    activeDropTargetId = boxId;

    // Add indicator to new target
    const zone = document.querySelector(`.box-drop-zone[data-box-id="${boxId}"]`);
    if (zone) zone.classList.add('paste-target');
}

/**
 * Get the active drop target box ID (for paste routing from references.js)
 */
export function getActiveDropTarget() {
    return activeDropTargetId;
}

/**
 * Setup drag-and-drop handlers on each box's drop zone
 * Called after every renderPromptBoxes since zones are recreated
 */
function setupBoxDropZones() {
    const zones = document.querySelectorAll('.box-drop-zone');

    zones.forEach(zone => {
        const boxId = zone.dataset.boxId;

        // Click to open file picker (only when clicking the placeholder or the zone itself, not child buttons)
        zone.addEventListener('click', e => {
            if (e.target === zone || e.target.classList.contains('box-drop-zone-placeholder')) {
                setActiveDropTarget(boxId);
                openBoxRefPicker(boxId);
            }
        });

        // Set as paste target on any interaction
        zone.addEventListener('mousedown', () => {
            setActiveDropTarget(boxId);
        });

        // Drag enter/over — accept image files
        zone.addEventListener('dragenter', e => {
            // Ignore box reorder drags (they set text/plain with box ID)
            if (draggedBoxId) return;
            e.preventDefault();
            e.stopPropagation();
            zone.classList.add('drag-over');
            setActiveDropTarget(boxId);
        });

        zone.addEventListener('dragover', e => {
            if (draggedBoxId) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
        });

        zone.addEventListener('dragleave', e => {
            // Only remove if leaving the zone itself (not entering a child)
            if (!zone.contains(e.relatedTarget)) {
                zone.classList.remove('drag-over');
            }
        });

        // Drop — process image files
        zone.addEventListener('drop', async e => {
            zone.classList.remove('drag-over');

            // Ignore box reorder drags
            if (draggedBoxId) return;

            const files = e.dataTransfer?.files;
            if (!files || files.length === 0) return;

            e.preventDefault();
            e.stopPropagation();

            const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
            if (imageFiles.length === 0) return;

            const box = promptBoxes.find(b => b.id === boxId);
            if (!box) return;

            if (!box.refImages) box.refImages = [];

            let addedCount = 0;
            for (const file of imageFiles) {
                if (box.refImages.length >= MAX_REFS) {
                    showToast(`Maximum ${MAX_REFS} reference images reached`);
                    break;
                }
                try {
                    const dataUrl = await fileToDataUrl(file);
                    const compressed = await compressImage(dataUrl);
                    box.refImages.push({ id: Date.now() + Math.random(), data: compressed });
                    addedCount++;
                } catch (err) {
                    console.error('Error processing dropped file:', err);
                }
            }

            if (addedCount > 0) {
                renderPromptBoxes();
                const idx = promptBoxes.findIndex(b => b.id === boxId) + 1;
                showToast(`${addedCount} image${addedCount > 1 ? 's' : ''} added to Prompt ${idx}`);
            }
        });
    });
}

/**
 * Check if the batch setup modal is currently open
 */
export function isBatchModalOpen() {
    return $('queueSetupModal')?.classList.contains('open') || false;
}

/**
 * Paste reference images from clipboard into prompt box(es)
 * Called by the global paste handler when batch modal is open
 * @param {File[]} imageFiles - Array of image files from clipboard
 */
export async function pasteRefsToBox(imageFiles) {
    // Determine target boxes — priority: activeDropTarget > selected > lastFocused > first
    let targetBoxIds = [];
    if (activeDropTargetId && promptBoxes.find(b => b.id === activeDropTargetId)) {
        targetBoxIds = [activeDropTargetId];
    } else if (selectedBoxIds.size > 0) {
        targetBoxIds = [...selectedBoxIds];
    } else if (lastFocusedBoxId && promptBoxes.find(b => b.id === lastFocusedBoxId)) {
        targetBoxIds = [lastFocusedBoxId];
    } else if (promptBoxes.length > 0) {
        targetBoxIds = [promptBoxes[0].id];
    } else {
        return;
    }

    // Compress images
    const newRefs = [];
    for (const file of imageFiles) {
        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = ev => resolve(ev.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            const compressed = await compressImage(dataUrl);
            newRefs.push({ data: compressed });
        } catch (err) {
            console.error('Error processing pasted image:', err);
        }
    }

    if (newRefs.length === 0) return;

    // Add to target boxes
    for (const boxId of targetBoxIds) {
        const box = promptBoxes.find(b => b.id === boxId);
        if (!box) continue;
        if (!box.refImages) box.refImages = [];

        for (const ref of newRefs) {
            if (box.refImages.length >= MAX_REFS) break;
            box.refImages.push({ id: Date.now() + Math.random(), data: ref.data });
        }
    }

    renderPromptBoxes();

    const label = targetBoxIds.length === 1
        ? `Prompt ${promptBoxes.findIndex(b => b.id === targetBoxIds[0]) + 1}`
        : `${targetBoxIds.length} prompts`;
    showToast(`${newRefs.length} image${newRefs.length > 1 ? 's' : ''} pasted to ${label}`);
}

// Make functions globally available
window.openQueueSetup = openQueueSetup;
window.closeQueueSetup = closeQueueSetup;
window.confirmAndStartQueue = confirmAndStartQueue;
window.toggleQueuePanel = toggleQueuePanel;
window.selectQueueOutputDir = selectQueueOutputDir;
window.addPromptBox = addPromptBox;
window.removePromptBox = removePromptBox;
window.updateBoxPrompt = updateBoxPrompt;
window.updateBoxName = updateBoxName;
window.setBoxVariations = setBoxVariations;
window.openBoxRefPicker = openBoxRefPicker;
window.clearBoxRefs = clearBoxRefs;
window.removeBoxRef = removeBoxRef;
window.importBatchFolder = importBatchFolder;
window.importBatchFile = importBatchFile;
window.exportBatchJson = exportBatchJson;
window.exportQueueResults = exportQueueResults;
window.downloadBatchTemplate = downloadBatchTemplate;
window.toggleBoxSelection = toggleBoxSelection;
window.selectAllBoxes = selectAllBoxes;
window.deselectAllBoxes = deselectAllBoxes;
window.openBulkRefPicker = openBulkRefPicker;
window.clearSelectedBoxRefs = clearSelectedBoxRefs;
window.handleBatchButtonClick = handleBatchButtonClick;
window.duplicatePromptBox = duplicatePromptBox;
window.toggleQueueSettings = toggleQueueSettings;
window.applySettingsToRemaining = applySettingsToRemaining;
window.setLastFocusedBox = setLastFocusedBox;
window.setActiveDropTarget = setActiveDropTarget;
window.openBoxSavedPromptPicker = openBoxSavedPromptPicker;
window.fillBoxFromSaved = fillBoxFromSaved;
window.openBulkSavedPromptPicker = openBulkSavedPromptPicker;
window.confirmBulkSavedPrompts = confirmBulkSavedPrompts;
window.closeBulkSavedPromptPicker = closeBulkSavedPromptPicker;
