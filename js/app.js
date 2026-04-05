/**
 * Main Application Entry Point
 * Initialization and event setup
 */

import {
    $,
    debounce,
    restoreCollapsibleStates,
    updateCharCounter,
    updateAspectPreview,
    updateThinkingLabel,
    openPromptEditor,
    closePromptEditor,
    updatePromptEditorCounter,
    showToast,
    restoreTheme
} from './ui.js';
import { restoreAllInputs, setupInputPersistence, updateThinkingNote, saveLastModel } from './persistence.js';
import { refreshModels } from './models.js';
import { loadRefImages, renderRefs, setupRefDragDrop, setupClipboardPaste, setupRefPreviewSwipe } from './references.js';
import { initDB } from './history.js';
import { setupZoomHandlers } from './zoom.js';
import { clearAll, deleteCurrentImage, generate, getCurrentHistoryId, iterate } from './generation.js';
import { loadSavedPrompts, isDropdownOpen, closePromptsDropdown, saveCurrentPrompt } from './prompts.js';
import {
    clearDirectorySelection,
    isFileSystemSupported,
    restoreDirectoryHandle,
    selectOutputDirectory,
    updateFileSystemSupportUI
} from './filesystem.js';
import { restoreQueueState, hasResumableQueue } from './queue.js';
import { initQueueUI, handleBatchButtonClick, toggleQueuePanel, closeQueueSetup } from './queueUI.js';
import {
    initProfiles,
    saveProfile,
    loadProfile,
    listProfiles,
    deleteProfile,
    exportProfile,
    importProfile,
    getActiveProfile
} from './profiles.js';
import {
    getCurrentProvider,
    persistProviderState,
    persistCurrentProviderState,
    providerSupports,
    restoreProviderState,
    switchProvider
} from './providers/index.js';

function bindClick(id, handler) {
    $(id)?.addEventListener('click', handler);
}

function bindProfileControls() {
    bindClick('saveProfileBtn', saveCurrentProfile);
    bindClick('loadProfileBtn', loadSelectedProfile);
    bindClick('deleteProfileBtn', deleteSelectedProfile);
    bindClick('exportProfileBtn', exportSelectedProfile);
    $('profileImportInput')?.addEventListener('change', importProfileFile);
}

function bindMainControls() {
    bindClick('refreshBtn', () => refreshModels(true));
    bindClick('generateBtn', generate);
    bindClick('batchBtn', handleBatchButtonClick);
    bindClick('clearAllBtn', clearAll);
    bindClick('iterateBtn', iterate);
    bindClick('deleteBtn', deleteCurrentImage);
    bindClick('selectDirBtn', selectOutputDirectory);
    bindClick('clearDirBtn', clearDirectorySelection);
    bindClick('infoBtn', async () => {
        const historyId = getCurrentHistoryId();
        if (!historyId) return;
        const { openGenerationDetails } = await import('./queueUI.js');
        openGenerationDetails(historyId);
    });
}

function bindProviderControls() {
    $('providerSelect')?.addEventListener('change', async (event) => {
        const nextProviderId = event.target.value;
        const previousProviderId = localStorage.getItem('provider_id') || getCurrentProvider().id;
        persistProviderState(previousProviderId, { setActiveProvider: false });
        switchProvider(nextProviderId);
        renderRefs();
        updateThinkingNote();

        if (getCurrentProvider().features.modelListing && $('apiKey').value.length > 20) {
            await refreshModels(true);
        }
    });

    $('apiKey')?.addEventListener('input', debounce(() => {
        persistCurrentProviderState();
        if (getCurrentProvider().features.modelListing && $('apiKey').value.length > 20) {
            refreshModels();
        }
    }, 500));

    $('providerBaseUrl')?.addEventListener('input', debounce(persistCurrentProviderState, 300));
    $('providerModelInput')?.addEventListener('input', debounce(persistCurrentProviderState, 300));
    $('modelSelect')?.addEventListener('change', () => {
        saveLastModel();
        updateThinkingNote();
    });

    window.addEventListener('nbpi:provider-change', () => {
        renderRefs();
        updateThinkingNote();
    });
}

function bindInputEnhancements() {
    $('thinkingToggle')?.addEventListener('change', () => {
        $('thinkingRow').style.display = providerSupports('thinking') && $('thinkingToggle').checked ? 'block' : 'none';
    });

    $('thinkingBudget')?.addEventListener('input', updateThinkingLabel);

    $('thinkingBudgetNum')?.addEventListener('input', () => {
        let value = parseInt($('thinkingBudgetNum').value, 10);
        if (Number.isNaN(value)) return;
        value = Math.max(-1, Math.min(24576, value));
        if (value > 0 && value < 128) value = 128;
        $('thinkingBudget').value = value;
        updateThinkingLabel();
    });

    $('thinkingBudgetNum')?.addEventListener('blur', () => {
        let value = parseInt($('thinkingBudgetNum').value, 10);
        if (Number.isNaN(value)) value = -1;
        value = Math.max(-1, Math.min(24576, value));
        if (value > 0 && value < 128) value = 128;
        $('thinkingBudget').value = value;
        $('thinkingBudgetNum').value = value;
        updateThinkingLabel();
    });

    $('prompt')?.addEventListener('input', updateCharCounter);
    $('ratio')?.addEventListener('change', updateAspectPreview);
    $('promptEditorTextarea')?.addEventListener('input', updatePromptEditorCounter);

    $('prompt')?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            generate();
        }
    });
}

// Initialize application
async function init() {
    restoreTheme();
    restoreProviderState();
    restoreAllInputs();
    restoreCollapsibleStates();
    setupInputPersistence();

    await initDB();
    await initProfiles();

    await loadRefImages();
    await loadSavedPrompts();

    updateCharCounter();
    updateAspectPreview();
    $('thinkingRow').style.display = providerSupports('thinking') && $('thinkingToggle').checked ? 'block' : 'none';
    bindProviderControls();
    bindInputEnhancements();
    bindMainControls();
    bindProfileControls();

    setupRefDragDrop();
    setupClipboardPaste();
    setupRefPreviewSwipe();
    setupZoomHandlers();

    updateFileSystemSupportUI();
    if (isFileSystemSupported()) {
        const restored = await restoreDirectoryHandle();
        if (restored === 'needs-permission') {
            console.log('Directory handle restored, needs permission on next action');
        }
    }

    const savedQueue = await restoreQueueState();
    initQueueUI();
    await updateProfileDropdown();

    if (savedQueue && hasResumableQueue()) {
        showToast('Previous queue found. Open Batch Queue to resume.');
    }

    document.addEventListener('click', e => {
        if (isDropdownOpen() && !e.target.closest('.dropdown-container') && !e.target.closest('.dropdown')) {
            closePromptsDropdown();
        }
    });

    document.addEventListener('keydown', e => {
        const isTyping = e.target.matches('input, textarea, [contenteditable]');

        if (e.key === 'Escape') {
            e.preventDefault();
            closeAllModals();
            return;
        }

        if (isTyping) return;

        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            $('generateBtn')?.click();
            return;
        }

        if (e.ctrlKey && e.shiftKey && e.key === 'F') {
            e.preventDefault();
            openPromptEditor();
            return;
        }

        if (e.ctrlKey && e.key === 'b') {
            e.preventDefault();
            handleBatchButtonClick();
            return;
        }

        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            saveCurrentPrompt();
        }
    });

    if (getCurrentProvider().features.modelListing && $('apiKey').value.length > 20) {
        refreshModels();
    }

    console.log('NBPI initialized');
}

/**
 * Update profile dropdown with available profiles
 */
async function updateProfileDropdown() {
    const select = $('profileSelect');
    if (!select) return;

    const profiles = await listProfiles();
    const activeProfile = getActiveProfile();

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

async function saveCurrentProfile() {
    const nameInput = $('profileName');
    const name = nameInput.value.trim();

    if (!name) {
        showToast('Enter a profile name');
        return;
    }

    if (await saveProfile(name)) {
        nameInput.value = '';
        await updateProfileDropdown();
    }
}

async function loadSelectedProfile() {
    const name = $('profileSelect')?.value;
    if (!name) {
        showToast('Select a profile to load');
        return;
    }

    if (await loadProfile(name)) {
        location.reload();
    }
}

async function deleteSelectedProfile() {
    const name = $('profileSelect')?.value;
    if (!name) {
        showToast('Select a profile to delete');
        return;
    }

    if (confirm(`Delete profile "${name}"?`)) {
        if (await deleteProfile(name)) {
            await updateProfileDropdown();
        }
    }
}

async function exportSelectedProfile() {
    const name = $('profileSelect')?.value;
    if (!name) {
        showToast('Select a profile to export');
        return;
    }

    await exportProfile(name);
}

async function importProfileFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (await importProfile(file)) {
        await updateProfileDropdown();
    }

    event.target.value = '';
}

/**
 * Close all open modals and panels
 */
function closeAllModals() {
    if ($('queueSetupModal')?.classList.contains('open')) {
        closeQueueSetup();
        return;
    }

    if ($('queuePanel')?.classList.contains('open')) {
        toggleQueuePanel(false);
        return;
    }

    if ($('historyPanel')?.classList.contains('open')) {
        import('./queueUI.js').then(m => m.toggleHistoryPanel(false));
        return;
    }

    if ($('promptEditorModal')?.classList.contains('open')) {
        closePromptEditor();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
