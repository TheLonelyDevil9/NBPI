/**
 * Main Application Entry Point
 * Initialization and event setup
 */

import { $, debounce, restoreCollapsibleStates, updateCharCounter, updateAspectPreview, updateThinkingLabel, openPromptEditor, closePromptEditor, updatePromptEditorCounter, showToast, restoreTheme } from './ui.js';
import { restoreAllInputs, setupInputPersistence, updateThinkingNote, saveLastModel } from './persistence.js';
import { refreshModels } from './models.js';
import { loadRefImages, setupRefDragDrop, setupClipboardPaste, setupRefPreviewSwipe } from './references.js';
import { initDB } from './history.js';
import { setupZoomHandlers } from './zoom.js';
import { generate, queueAnother } from './generation.js';
import { loadSavedPrompts, isDropdownOpen, closePromptsDropdown, saveCurrentPrompt } from './prompts.js';
import { isFileSystemSupported, restoreDirectoryHandle } from './filesystem.js';
import { restoreQueueState, hasResumableQueue } from './queue.js';
import { initQueueUI, handleBatchButtonClick, toggleQueuePanel, closeQueueSetup } from './queueUI.js';
import { saveProfile, loadProfile, listProfiles, deleteProfile, exportProfile, importProfile, getActiveProfile } from './profiles.js';

// Initialize application
async function init() {
    // Restore theme first (before any rendering)
    restoreTheme();

    // Restore credentials from localStorage
    $('apiKey').value = localStorage.getItem('gemini_api_key') || '';

    // Restore all inputs and UI state
    restoreAllInputs();
    restoreCollapsibleStates();
    setupInputPersistence();

    // Load reference images
    loadRefImages();

    // Initialize UI elements
    updateCharCounter();
    updateAspectPreview();

    // API key change handler
    $('apiKey').addEventListener('input', debounce(() => {
        localStorage.setItem('gemini_api_key', $('apiKey').value);
        if ($('apiKey').value.length > 20) refreshModels();
    }, 500));

    // Thinking toggle handler
    $('thinkingToggle').addEventListener('change', () => {
        $('thinkingRow').style.display = $('thinkingToggle').checked ? 'block' : 'none';
    });

    // Model select handler
    $('modelSelect').addEventListener('change', () => {
        saveLastModel();
        updateThinkingNote();
    });

    // Thinking budget handler
    $('thinkingBudget').addEventListener('input', updateThinkingLabel);

    // Thinking budget number input -> sync to slider
    $('thinkingBudgetNum').addEventListener('input', () => {
        let v = parseInt($('thinkingBudgetNum').value);
        if (isNaN(v)) return;
        v = Math.max(-1, Math.min(24576, v));
        if (v > 0 && v < 128) v = 128;
        $('thinkingBudget').value = v;
        updateThinkingLabel();
    });

    $('thinkingBudgetNum').addEventListener('blur', () => {
        let v = parseInt($('thinkingBudgetNum').value);
        if (isNaN(v)) v = -1;
        v = Math.max(-1, Math.min(24576, v));
        if (v > 0 && v < 128) v = 128;
        $('thinkingBudget').value = v;
        $('thinkingBudgetNum').value = v;
        updateThinkingLabel();
    });

    // Prompt character counter
    $('prompt').addEventListener('input', updateCharCounter);

    // Aspect ratio preview
    $('ratio').addEventListener('change', updateAspectPreview);

    // Ctrl+Enter to generate
    $('prompt').addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.ctrlKey) generate();
    });

    // Setup drag and drop
    setupRefDragDrop();
    setupClipboardPaste();
    setupRefPreviewSwipe();

    // Setup zoom handlers
    setupZoomHandlers();

    // Initialize database
    await initDB();
    loadSavedPrompts();

    // Initialize filesystem module
    if (isFileSystemSupported()) {
        const restored = await restoreDirectoryHandle();
        if (restored === 'needs-permission') {
            // Handle permission request on user gesture
            console.log('Directory handle restored, needs permission on next action');
        }
    } else {
        // Show warning that File System Access is not supported
        const warningEl = $('fsSupportWarning');
        if (warningEl) {
            warningEl.style.display = 'block';
        }
    }

    // Restore queue state (async - loads refs from IndexedDB)
    const savedQueue = await restoreQueueState();

    // Initialize queue UI
    initQueueUI();

    // Initialize profile UI
    updateProfileDropdown();

    // Check for resumable queue
    if (savedQueue && hasResumableQueue()) {
        showToast('Previous queue found. Open Batch Queue to resume.');
    }

    // Click outside to close prompts dropdown
    document.addEventListener('click', e => {
        if (isDropdownOpen() && !e.target.closest('.dropdown-container') && !e.target.closest('.dropdown')) {
            closePromptsDropdown();
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
        // Don't trigger shortcuts when typing in inputs/textareas (except Escape)
        const isTyping = e.target.matches('input, textarea, [contenteditable]');

        // Escape - close any open modal/panel
        if (e.key === 'Escape') {
            e.preventDefault();
            closeAllModals();
            return;
        }

        // Skip other shortcuts if typing
        if (isTyping) return;

        // Ctrl+Enter - Generate image
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            const generateBtn = $('generateBtn');
            if (generateBtn && !generateBtn.disabled) {
                generateBtn.click();
            }
            return;
        }

        // Ctrl+Shift+F - Open fullscreen prompt editor
        if (e.ctrlKey && e.shiftKey && e.key === 'F') {
            e.preventDefault();
            openPromptEditor();
            return;
        }

        // Ctrl+B - Open batch setup
        if (e.ctrlKey && e.key === 'b') {
            e.preventDefault();
            handleBatchButtonClick();
            return;
        }

        // Ctrl+S - Save current prompt (if prompts dropdown exists)
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            if (typeof saveCurrentPrompt === 'function') {
                saveCurrentPrompt();
            }
            return;
        }
    });

    // Prompt editor textarea input handler
    $('promptEditorTextarea')?.addEventListener('input', updatePromptEditorCounter);

    // Load models if API key exists
    if ($('apiKey').value.length > 20) {
        refreshModels();
    }

    console.log('🍌 NBPI initialized');
}

/**
 * Update profile dropdown with available profiles
 */
function updateProfileDropdown() {
    const select = $('profileSelect');
    if (!select) return;

    const profiles = listProfiles();
    const activeProfile = getActiveProfile();

    // Clear and rebuild options
    select.innerHTML = '<option value="">None</option>';
    profiles.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        if (name === activeProfile) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

/**
 * Save current settings as profile
 */
window.saveCurrentProfile = function() {
    const nameInput = $('profileName');
    const name = nameInput.value.trim();

    if (!name) {
        showToast('Enter a profile name');
        return;
    }

    if (saveProfile(name)) {
        nameInput.value = '';
        updateProfileDropdown();
    }
};

/**
 * Load selected profile
 */
window.loadSelectedProfile = function() {
    const select = $('profileSelect');
    const name = select.value;

    if (!name) {
        showToast('Select a profile to load');
        return;
    }

    if (loadProfile(name)) {
        // Reload the page to apply all settings
        location.reload();
    }
};

/**
 * Delete selected profile
 */
window.deleteSelectedProfile = function() {
    const select = $('profileSelect');
    const name = select.value;

    if (!name) {
        showToast('Select a profile to delete');
        return;
    }

    if (confirm(`Delete profile "${name}"?`)) {
        if (deleteProfile(name)) {
            updateProfileDropdown();
        }
    }
};

/**
 * Export selected profile
 */
window.exportSelectedProfile = function() {
    const select = $('profileSelect');
    const name = select.value;

    if (!name) {
        showToast('Select a profile to export');
        return;
    }

    exportProfile(name);
};

/**
 * Import profile from file
 */
window.importProfileFile = async function(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (await importProfile(file)) {
        updateProfileDropdown();
    }

    // Clear file input
    event.target.value = '';
};

/**
 * Close all open modals and panels
 */
function closeAllModals() {
    // Close queue setup modal
    const queueSetupModal = $('queueSetupModal');
    if (queueSetupModal?.classList.contains('open')) {
        closeQueueSetup();
        return;
    }

    // Close queue panel
    const queuePanel = $('queuePanel');
    if (queuePanel?.classList.contains('open')) {
        toggleQueuePanel(false);
        return;
    }

    // Close prompt editor
    const promptEditor = $('promptEditorModal');
    if (promptEditor?.classList.contains('open')) {
        closePromptEditor();
        return;
    }
}

// Start app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
